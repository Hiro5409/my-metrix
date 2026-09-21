import { and, eq, gt, lte, sql } from "drizzle-orm";
import { AsyncLocalStorage } from "node:async_hooks";
import { parseTokenSet, type TokenSet, type TokenStore } from "withings-cli";
import type { AppDatabase } from "../db/client";
import { decryptTokenJson, encryptTokenJson } from "./encryption";
import { withingsConnection, withingsRefreshLease } from "./schema";

const LOCK_TTL_MS = 10_000;
const LOCK_RENEW_MS = 3_000;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_MS = 50;
const TOKEN_ID = 1;
const databaseNow = sql<number>`cast(unixepoch('subsecond') * 1000 as integer)`;

type RefreshLease = { owner: string; lost: boolean };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseStoredToken(tokenJson: string): TokenSet | undefined {
  try {
    return parseTokenSet(JSON.parse(tokenJson));
  } catch {
    return undefined;
  }
}

export class WithingsTokenStore implements TokenStore {
  // Ownership follows the refresh callback, not the shared store instance.
  private readonly refreshLease = new AsyncLocalStorage<RefreshLease>();

  constructor(
    private readonly db: AppDatabase,
    private readonly encryptionKey: string,
  ) {}

  async load(): Promise<TokenSet | undefined> {
    const rows = await this.db
      .select({ tokenJson: withingsConnection.tokenJson })
      .from(withingsConnection)
      .where(eq(withingsConnection.id, TOKEN_ID))
      .limit(1);

    const row = rows[0];
    if (!row) return undefined;
    const tokenJson = await decryptTokenJson(row.tokenJson, this.encryptionKey);
    if (!tokenJson) return undefined;
    return parseStoredToken(tokenJson);
  }

  async save(tokenSet: TokenSet): Promise<void> {
    const now = Date.now();
    const tokenJson = await encryptTokenJson(JSON.stringify(tokenSet), this.encryptionKey);
    const lease = this.refreshLease.getStore();
    if (lease) {
      if (lease.lost) throw new Error("Withings token refresh lease was lost.");
      const rows = await this.db.all<{ id: number }>(sql`
        UPDATE ${withingsConnection}
        SET token_json = ${tokenJson},
            expires_at = ${tokenSet.expiresAt},
            updated_at = ${now}
        WHERE ${withingsConnection.id} = ${TOKEN_ID}
          AND EXISTS (
            SELECT 1
            FROM ${withingsRefreshLease}
            WHERE ${withingsRefreshLease.id} = ${TOKEN_ID}
              AND ${withingsRefreshLease.owner} = ${lease.owner}
              AND ${withingsRefreshLease.expiresAt} > ${databaseNow}
          )
        RETURNING id
      `);
      if (lease.lost || rows.length === 0) {
        throw new Error("Withings token refresh lease was lost.");
      }
      return;
    }

    const saveGrant = this.db
      .insert(withingsConnection)
      .values({
        id: TOKEN_ID,
        tokenJson,
        expiresAt: tokenSet.expiresAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: withingsConnection.id,
        set: {
          tokenJson,
          expiresAt: tokenSet.expiresAt,
          updatedAt: now,
        },
      });
    await this.db.batch([
      saveGrant,
      this.db.delete(withingsRefreshLease).where(eq(withingsRefreshLease.id, TOKEN_ID)),
    ]);
  }

  async withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
    const owner = crypto.randomUUID();
    await this.acquireLock(owner);
    const lease: RefreshLease = { owner, lost: false };
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let renewal = Promise.resolve();

    const scheduleRenewal = () => {
      timer = setTimeout(() => {
        renewal = this.renewLock(owner).then(
          () => {
            if (!stopped) scheduleRenewal();
          },
          () => {
            lease.lost = true;
          },
        );
      }, LOCK_RENEW_MS);
    };
    scheduleRenewal();

    try {
      return await this.refreshLease.run(lease, async () => {
        await this.assertLease(lease);
        const result = await fn();
        await renewal;
        await this.assertLease(lease);
        return result;
      });
    } finally {
      stopped = true;
      lease.lost = true;
      if (timer !== undefined) clearTimeout(timer);
      await renewal;
      await this.releaseLock(owner);
    }
  }

  private async acquireLock(owner: string): Promise<void> {
    const deadline = performance.now() + LOCK_TIMEOUT_MS;
    let lastError: unknown;

    while (performance.now() < deadline) {
      try {
        if (await this.tryAcquireLock(owner)) return;
      } catch (error) {
        lastError = error;
      }
      await sleep(LOCK_RETRY_MS);
    }

    throw new Error("Timed out acquiring Withings token refresh lock.", {
      cause: lastError,
    });
  }

  private async tryAcquireLock(owner: string): Promise<boolean> {
    const expiresAt = sql<number>`${databaseNow} + ${LOCK_TTL_MS}`;
    const rows = await this.db
      .insert(withingsRefreshLease)
      .values({
        id: TOKEN_ID,
        owner,
        expiresAt,
        updatedAt: databaseNow,
      })
      .onConflictDoUpdate({
        target: withingsRefreshLease.id,
        set: {
          owner,
          expiresAt,
          updatedAt: databaseNow,
        },
        setWhere: lte(withingsRefreshLease.expiresAt, databaseNow),
      })
      .returning({ owner: withingsRefreshLease.owner });

    return rows.length > 0;
  }

  private async renewLock(owner: string): Promise<void> {
    const rows = await this.db
      .update(withingsRefreshLease)
      .set({
        expiresAt: sql`${databaseNow} + ${LOCK_TTL_MS}`,
        updatedAt: databaseNow,
      })
      .where(and(this.ownedLock(owner), gt(withingsRefreshLease.expiresAt, databaseNow)))
      .returning({ owner: withingsRefreshLease.owner });
    if (rows.length === 0) throw new Error("Withings token refresh lease was lost.");
  }

  private async assertLease(lease: RefreshLease) {
    if (lease.lost) throw new Error("Withings token refresh lease was lost.");
    const rows = await this.db
      .select({ owner: withingsRefreshLease.owner })
      .from(withingsRefreshLease)
      .where(and(this.ownedLock(lease.owner), gt(withingsRefreshLease.expiresAt, databaseNow)));
    if (lease.lost || rows.length === 0) throw new Error("Withings token refresh lease was lost.");
  }

  private ownedLock(owner: string) {
    return and(eq(withingsRefreshLease.id, TOKEN_ID), eq(withingsRefreshLease.owner, owner));
  }

  private async releaseLock(owner: string): Promise<void> {
    await this.db.delete(withingsRefreshLease).where(this.ownedLock(owner));
  }
}
