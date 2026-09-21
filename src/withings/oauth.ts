import { and, eq, gt } from "drizzle-orm";
import { buildAuthorizationUrl, exchangeCodeForToken, generateState } from "withings-cli";
import { ConfigurationError } from "../configuration";
import type { AppDatabase } from "../db/client";
import { withingsAuthorization } from "./schema";
import { WithingsTokenStore } from "./token-store";

const AUTHORIZATION_ID = 1;
const AUTHORIZATION_TTL_MS = 5 * 60_000;

type WithingsOAuthConfig = {
  appUrl?: string;
  clientId?: string;
  clientSecret?: string;
  encryptionKey?: string;
};

function required(value: string | undefined, message: string) {
  if (!value) throw new ConfigurationError(message);
  return value;
}

function redirectUri(config: WithingsOAuthConfig) {
  const appUrl = new URL(required(config.appUrl, "Application URL is not configured."));
  if (appUrl.protocol !== "https:") {
    throw new ConfigurationError("Application URL must use HTTPS.");
  }
  return new URL("/oauth/withings/callback", appUrl).toString();
}

async function hashState(state: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function startWithingsAuthorization(db: AppDatabase, config: WithingsOAuthConfig) {
  const clientId = required(config.clientId, "Withings client ID is not configured.");
  const callbackUrl = redirectUri(config);
  const state = generateState();
  const stateHash = await hashState(state);
  const now = Date.now();
  await db
    .insert(withingsAuthorization)
    .values({
      id: AUTHORIZATION_ID,
      stateHash,
      status: "pending",
      expiresAt: now + AUTHORIZATION_TTL_MS,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: withingsAuthorization.id,
      set: {
        stateHash,
        status: "pending",
        expiresAt: now + AUTHORIZATION_TTL_MS,
        error: null,
        updatedAt: now,
      },
    });

  return {
    authorizationUrl: buildAuthorizationUrl({
      clientId,
      redirectUri: callbackUrl,
      scope: "user.metrics",
      state,
    }),
    state,
  };
}

export async function getWithingsAuthorizationStatus(db: AppDatabase, state: string) {
  const [authorization] = await db
    .select({
      expiresAt: withingsAuthorization.expiresAt,
      status: withingsAuthorization.status,
    })
    .from(withingsAuthorization)
    .where(eq(withingsAuthorization.stateHash, await hashState(state)))
    .limit(1);
  if (!authorization) return "unknown" as const;
  if (
    (authorization.status === "pending" || authorization.status === "exchanging") &&
    authorization.expiresAt <= Date.now()
  ) {
    return "expired" as const;
  }
  return authorization.status;
}

export async function failWithingsAuthorization(db: AppDatabase, state: string) {
  const now = Date.now();
  const failed = await db
    .update(withingsAuthorization)
    .set({ error: "Authorization denied.", status: "failed", updatedAt: now })
    .where(
      and(
        eq(withingsAuthorization.id, AUTHORIZATION_ID),
        eq(withingsAuthorization.stateHash, await hashState(state)),
        eq(withingsAuthorization.status, "pending"),
        gt(withingsAuthorization.expiresAt, now),
      ),
    )
    .returning({ id: withingsAuthorization.id });
  return failed.length === 0 ? { kind: "invalid" as const } : { kind: "failed" as const };
}

export async function completeWithingsAuthorization(
  db: AppDatabase,
  config: WithingsOAuthConfig,
  input: { code: string; state: string },
) {
  const clientId = required(config.clientId, "Withings client ID is not configured.");
  const clientSecret = required(config.clientSecret, "Withings client secret is not configured.");
  const encryptionKey = required(config.encryptionKey, "Token encryption key is not configured.");
  const callbackUrl = redirectUri(config);
  const stateHash = await hashState(input.state);
  const now = Date.now();
  const claimed = await db
    .update(withingsAuthorization)
    .set({ status: "exchanging", updatedAt: now })
    .where(
      and(
        eq(withingsAuthorization.id, AUTHORIZATION_ID),
        eq(withingsAuthorization.stateHash, stateHash),
        eq(withingsAuthorization.status, "pending"),
        gt(withingsAuthorization.expiresAt, now),
      ),
    )
    .returning({ id: withingsAuthorization.id });
  if (claimed.length === 0) return { kind: "invalid" as const };

  try {
    const token = await exchangeCodeForToken({
      clientId,
      clientSecret,
      code: input.code,
      redirectUri: callbackUrl,
    });
    const store = new WithingsTokenStore(db, encryptionKey);
    await store.save(token);
    await db
      .update(withingsAuthorization)
      .set({ error: null, status: "succeeded", updatedAt: Date.now() })
      .where(
        and(
          eq(withingsAuthorization.id, AUTHORIZATION_ID),
          eq(withingsAuthorization.stateHash, stateHash),
          eq(withingsAuthorization.status, "exchanging"),
        ),
      );
    return { kind: "succeeded" as const };
  } catch {
    await db
      .update(withingsAuthorization)
      .set({ error: "Token exchange failed.", status: "failed", updatedAt: Date.now() })
      .where(
        and(
          eq(withingsAuthorization.id, AUTHORIZATION_ID),
          eq(withingsAuthorization.stateHash, stateHash),
        ),
      );
    return { kind: "failed" as const };
  }
}
