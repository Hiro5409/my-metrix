import { and, eq, lte, or } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { measurements } from "../measurements/schema";
import type { createWithingsConnection } from "./client";
import { planNotification, type NotificationPlan, type ReceivedNotification } from "./notification";
import { withingsNotifications } from "./schema";

// Leave the first quick Withings retry to an active attempt before reclaiming its work.
const STALE_RECEIVED_MS = 60_000;

type WithingsGateway = Pick<
  ReturnType<typeof createWithingsConnection>,
  "loadUserId" | "fetchMeasures"
>;

type NotificationClaim =
  | { action: "process"; claimStartedAt: number; eventKey: string }
  | { action: "acknowledge" | "retry"; eventKey: string };

export type SyncOutcome =
  | Readonly<{ kind: "ignored"; reason: "missing_user" | "unexpected_user" }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "retry" }>
  | Readonly<{ kind: "processed"; eventKey: string }>;

export async function syncNotification(
  db: AppDatabase,
  received: ReceivedNotification,
  connection: WithingsGateway,
): Promise<SyncOutcome> {
  const plan = planNotification(received.notification);
  if (plan.kind === "ignore") return { kind: "ignored", reason: plan.reason };
  if (plan.kind === "invalid") return plan;
  if (plan.userId !== (await connection.loadUserId())) {
    return { kind: "ignored", reason: "unexpected_user" };
  }
  const claim = await claimNotification(db, received.receipt);
  if (claim.action === "retry") return { kind: "retry" };
  if (claim.action === "process") await processNotification(db, plan, claim, connection);
  return { kind: "processed", eventKey: claim.eventKey };
}

async function claimNotification(
  db: AppDatabase,
  receipt: ReceivedNotification["receipt"],
): Promise<NotificationClaim> {
  const now = Date.now();
  const key = receipt.eventKey;

  const insertedRows = await db
    .insert(withingsNotifications)
    .values({
      eventKey: key,
      receivedAt: now,
      status: "received",
    })
    .onConflictDoNothing({ target: withingsNotifications.eventKey })
    .returning({ eventKey: withingsNotifications.eventKey });
  const inserted = insertedRows.length > 0;

  if (inserted) {
    return {
      action: "process",
      claimStartedAt: now,
      eventKey: key,
    };
  }

  const claimedRows = await db
    .update(withingsNotifications)
    .set({ error: null, processedAt: null, receivedAt: now, status: "received" })
    .where(
      and(
        eq(withingsNotifications.eventKey, key),
        or(
          eq(withingsNotifications.status, "failed"),
          and(
            eq(withingsNotifications.status, "received"),
            lte(withingsNotifications.receivedAt, now - STALE_RECEIVED_MS),
          ),
        ),
      ),
    )
    .returning({ eventKey: withingsNotifications.eventKey });
  if (claimedRows.length > 0) {
    return {
      action: "process",
      claimStartedAt: now,
      eventKey: key,
    };
  }

  const rows = await db
    .select({ status: withingsNotifications.status })
    .from(withingsNotifications)
    .where(eq(withingsNotifications.eventKey, key))
    .limit(1);

  return {
    action: rows[0]?.status === "received" ? "retry" : "acknowledge",
    eventKey: key,
  };
}

function markEventProcessed(db: AppDatabase, key: string, claimStartedAt: number) {
  return db
    .update(withingsNotifications)
    .set({ error: null, processedAt: Date.now(), status: "processed" })
    .where(
      and(
        eq(withingsNotifications.eventKey, key),
        eq(withingsNotifications.receivedAt, claimStartedAt),
        eq(withingsNotifications.status, "received"),
      ),
    );
}

async function markEventFailed(
  db: AppDatabase,
  key: string,
  claimStartedAt: number,
  error: unknown,
) {
  await db
    .update(withingsNotifications)
    .set({
      error: error instanceof Error ? error.message : String(error),
      processedAt: Date.now(),
      status: "failed",
    })
    .where(
      and(
        eq(withingsNotifications.eventKey, key),
        eq(withingsNotifications.receivedAt, claimStartedAt),
        eq(withingsNotifications.status, "received"),
      ),
    );
}

async function processNotification(
  db: AppDatabase,
  plan: Extract<NotificationPlan, { kind: "sync" | "acknowledge" }>,
  claim: Extract<NotificationClaim, { action: "process" }>,
  connection: WithingsGateway,
) {
  const { eventKey: key, claimStartedAt } = claim;
  try {
    if (plan.kind === "acknowledge") {
      await markEventProcessed(db, key, claimStartedAt);
      return;
    }

    const measures = await connection.fetchMeasures(plan.selection);
    const now = Date.now();
    const writes = measures.map((measure) => {
      const values = {
        boneMassKg: measure.boneMassKg ?? null,
        fatFreeMassKg: measure.fatFreeMassKg ?? null,
        fatMassKg: measure.fatMassKg ?? null,
        fatRatioPercent: measure.fatRatioPercent ?? null,
        hydrationKg: measure.hydrationKg ?? null,
        muscleMassKg: measure.muscleMassKg ?? null,
        raw: measure.raw,
        timestamp: measure.timestamp,
        updatedAt: now,
        weightKg: measure.weightKg ?? null,
      };
      return db
        .insert(measurements)
        .values({ grpid: measure.grpid, ...values })
        .onConflictDoUpdate({ target: measurements.grpid, set: values });
    });

    await db.batch([markEventProcessed(db, key, claimStartedAt), ...writes]);
  } catch (error) {
    await markEventFailed(db, key, claimStartedAt, error);
    throw error;
  }
}
