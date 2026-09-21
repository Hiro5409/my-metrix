import { expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import app from "../index";
import { measurements } from "../measurements/schema";
import { withingsNotifications } from "./schema";
import { createTestDatabase } from "../db/test-support";
import { createWithingsConnection } from "./client";
import { parseWithingsNotification } from "./notification";
import { syncNotification } from "./sync";
import { saveTestToken, TEST_TOKEN_ENCRYPTION_KEY } from "./test-support";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

test("rejects Withings webhook processing when the configured token has no user", async () => {
  const testDb = await createTestDatabase();
  await saveTestToken(testDb, { userid: undefined });

  try {
    const res = await app.request(
      "/webhooks/withings/right",
      {
        body: new URLSearchParams({ appli: "4", userid: "1" }),
        method: "POST",
      },
      {
        DB: testDb.client,
        TOKEN_ENCRYPTION_KEY: TEST_TOKEN_ENCRYPTION_KEY,
        WEBHOOK_SECRET: "right",
      },
    );
    const body = (await res.json()) as { message: string };
    const events = await testDb.db.select().from(withingsNotifications);

    expect(res.status).toBe(503);
    expect(body.message).toBe("Withings user is not configured.");
    expect(events).toEqual([]);
  } finally {
    await testDb.cleanup();
  }
});

test("ignores Withings webhook payloads for a different user before recording events", async () => {
  const originalFetch = globalThis.fetch;
  const testDb = await createTestDatabase();
  await saveTestToken(testDb, { userid: 1 });
  const fetchMock = mock(() => {
    throw new Error("fetch should not be called for a different Withings user");
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  try {
    const res = await app.request(
      "/webhooks/withings/right",
      {
        body: new URLSearchParams({
          appli: "1",
          date: "1720000001",
          userid: "2",
        }),
        method: "POST",
      },
      {
        DB: testDb.client,
        TOKEN_ENCRYPTION_KEY: TEST_TOKEN_ENCRYPTION_KEY,
        WEBHOOK_SECRET: "right",
      },
    );
    const body = (await res.json()) as { ignored?: boolean; ok: boolean };
    const events = await testDb.db.select().from(withingsNotifications);

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, ignored: true });
    expect(events).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    globalThis.fetch = originalFetch;
    await testDb.cleanup();
  }
});

test("ignores Withings webhook payloads without a user for unsupported categories", async () => {
  const originalFetch = globalThis.fetch;
  const testDb = await createTestDatabase();
  const fetchMock = mock(() => {
    throw new Error("fetch should not be called for unsupported Withings categories");
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  try {
    const res = await app.request(
      "/webhooks/withings/right",
      {
        body: new URLSearchParams({
          appli: "53",
        }),
        method: "POST",
      },
      {
        DB: testDb.client,
        TOKEN_ENCRYPTION_KEY: TEST_TOKEN_ENCRYPTION_KEY,
        WEBHOOK_SECRET: "right",
      },
    );
    const body = (await res.json()) as { ignored?: boolean; ok: boolean };
    const events = await testDb.db.select().from(withingsNotifications);

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, ignored: true });
    expect(events).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    globalThis.fetch = originalFetch;
    await testDb.cleanup();
  }
});

test("asks the caller to retry while a matching notification is still being processed", async () => {
  const testDb = await createTestDatabase();
  const received = parseWithingsNotification({
    appli: "1",
    date: "1720000001",
    userid: "1",
  });
  const fetchStarted = deferred<void>();
  const measures = deferred<never[]>();
  const connection = {
    loadUserId: async () => 1,
    fetchMeasures: async () => {
      fetchStarted.resolve();
      return measures.promise;
    },
  };

  try {
    const processing = syncNotification(testDb.db, received, connection);
    await fetchStarted.promise;

    expect(await syncNotification(testDb.db, received, connection)).toEqual({ kind: "retry" });
    measures.resolve([]);
    expect(await processing).toMatchObject({ kind: "processed" });
  } finally {
    await testDb.cleanup();
  }
});

test("keeps a reclaimed webhook processed when its previous attempt fails later", async () => {
  const originalFetch = globalThis.fetch;
  const testDb = await createTestDatabase();
  await saveTestToken(testDb, { userid: 1 });
  let firstFetchStartedResolve!: () => void;
  let firstFetchReject!: (error: Error) => void;
  const firstFetchStarted = new Promise<void>((resolve) => {
    firstFetchStartedResolve = resolve;
  });
  const firstFetch = new Promise<Response>((_resolve, reject) => {
    firstFetchReject = reject;
  });
  let fetchCount = 0;
  globalThis.fetch = mock(() => {
    fetchCount += 1;
    if (fetchCount === 1) {
      firstFetchStartedResolve();
      return firstFetch;
    }
    return Promise.resolve(
      Response.json({
        body: { measuregrps: [], more: 0 },
        status: 0,
      }),
    );
  }) as unknown as typeof fetch;
  const request = {
    body: new URLSearchParams({
      appli: "1",
      date: "1720000001",
      userid: "1",
    }),
    method: "POST",
  };
  const env = {
    DB: testDb.client,
    TOKEN_ENCRYPTION_KEY: TEST_TOKEN_ENCRYPTION_KEY,
    WEBHOOK_SECRET: "right",
  };

  try {
    const previousRequest = app.request("/webhooks/withings/right", request, env);
    await firstFetchStarted;
    await testDb.db.update(withingsNotifications).set({ receivedAt: Date.now() - 70_000 });

    const retryResponse = await app.request("/webhooks/withings/right", request, env);
    firstFetchReject(new Error("Previous attempt stopped."));
    const previousResponse = await previousRequest;
    const [event] = await testDb.db.select().from(withingsNotifications);

    expect(retryResponse.status).toBe(200);
    expect(previousResponse.status).toBe(500);
    expect(event?.status).toBe("processed");
  } finally {
    globalThis.fetch = originalFetch;
    await testDb.cleanup();
  }
});

test("allows failed Withings webhook events to be processed again", async () => {
  const testDb = await createTestDatabase();
  const received = parseWithingsNotification({
    appli: "1",
    date: "1720000001",
    userid: "1",
  });

  try {
    await expect(
      syncNotification(testDb.db, received, {
        loadUserId: async () => 1,
        fetchMeasures: async () => {
          throw new Error("temporary");
        },
      }),
    ).rejects.toThrow("temporary");
    const retry = await syncNotification(testDb.db, received, {
      loadUserId: async () => 1,
      fetchMeasures: async () => [],
    });
    const [webhookEvent] = await testDb.db
      .select()
      .from(withingsNotifications)
      .where(eq(withingsNotifications.eventKey, received.receipt.eventKey))
      .limit(1);

    expect(retry).toEqual({ kind: "processed", eventKey: received.receipt.eventKey });
    expect(webhookEvent?.error).toBeNull();
    expect(webhookEvent?.processedAt).toBeNumber();
    expect(webhookEvent?.status).toBe("processed");
  } finally {
    await testDb.cleanup();
  }
});

test("keeps a webhook unprocessed when its measurement batch fails", async () => {
  const testDb = await createTestDatabase();
  const received = parseWithingsNotification({
    appli: "1",
    date: "1720000001",
    userid: "1",
  });

  try {
    await testDb.client
      .prepare(
        "create trigger reject_measurements before insert on measurements begin select raise(abort, 'rejected measurement'); end",
      )
      .run();

    await expect(
      syncNotification(testDb.db, received, {
        loadUserId: async () => 1,
        fetchMeasures: async () => [
          {
            grpid: 123,
            raw: { grpid: 123 },
            timestamp: 1_720_000_001,
            weightKg: 91.2,
          },
        ],
      }),
    ).rejects.toThrow("rejected measurement");

    const [webhookEvent] = await testDb.db
      .select()
      .from(withingsNotifications)
      .where(eq(withingsNotifications.eventKey, received.receipt.eventKey))
      .limit(1);
    expect(await testDb.db.select().from(measurements)).toEqual([]);
    expect(webhookEvent?.status).toBe("failed");
  } finally {
    await testDb.cleanup();
  }
});

test("grants one retry caller exclusive processing rights for an abandoned event", async () => {
  const testDb = await createTestDatabase();
  const received = parseWithingsNotification({
    appli: "1",
    date: "1720000001",
    userid: "1",
  });
  const originalFetchStarted = deferred<void>();
  const originalMeasures = deferred<never[]>();
  const retryFetchStarted = deferred<void>();
  const retryMeasures = deferred<never[]>();
  let retryFetches = 0;

  try {
    const original = syncNotification(testDb.db, received, {
      loadUserId: async () => 1,
      fetchMeasures: async () => {
        originalFetchStarted.resolve();
        return originalMeasures.promise;
      },
    });
    await originalFetchStarted.promise;
    await testDb.db
      .update(withingsNotifications)
      .set({ receivedAt: Date.now() - 70_000 })
      .where(eq(withingsNotifications.eventKey, received.receipt.eventKey));

    const retries = Array.from({ length: 20 }, () =>
      syncNotification(testDb.db, received, {
        loadUserId: async () => 1,
        fetchMeasures: async () => {
          retryFetches += 1;
          retryFetchStarted.resolve();
          return retryMeasures.promise;
        },
      }),
    );
    await retryFetchStarted.promise;
    retryMeasures.resolve([]);
    const outcomes = await Promise.all(retries);
    originalMeasures.resolve([]);
    await original;

    expect(retryFetches).toBe(1);
    expect(outcomes.some((outcome) => outcome.kind === "processed")).toBe(true);
  } finally {
    await testDb.cleanup();
  }
});

test("marks non-weight Withings webhook events processed without fetching measures", async () => {
  const originalFetch = globalThis.fetch;
  const testDb = await createTestDatabase();
  await saveTestToken(testDb);
  const received = parseWithingsNotification({
    appli: "4",
    date: "1720000001",
    userid: "1",
  });
  const fetchMock = mock(() => {
    throw new Error("fetch should not be called for non-weight webhook events");
  });

  globalThis.fetch = fetchMock as unknown as typeof fetch;

  try {
    const outcome = await syncNotification(
      testDb.db,
      received,
      createWithingsConnection(testDb.db, TEST_TOKEN_ENCRYPTION_KEY),
    );
    if (outcome.kind !== "processed") throw new Error("Webhook was not processed.");

    const [webhookEvent] = await testDb.db
      .select()
      .from(withingsNotifications)
      .where(eq(withingsNotifications.eventKey, outcome.eventKey))
      .limit(1);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(webhookEvent?.status).toBe("processed");
  } finally {
    globalThis.fetch = originalFetch;
    await testDb.cleanup();
  }
});

test.each([
  ["a notified period", "1720000001", "1720000001", 51],
  ["the latest measurement", undefined, null, 1],
] as const)(
  "records and processes %s from Withings",
  async (_description, date, timestamp, count) => {
    const originalFetch = globalThis.fetch;
    const testDb = await createTestDatabase();
    await saveTestToken(testDb);
    const received = parseWithingsNotification({
      appli: "1",
      date,
      userid: "1",
    });

    let requestedForm: URLSearchParams | undefined;
    globalThis.fetch = (async (_input: Request | string | URL, init?: RequestInit) => {
      requestedForm = new URLSearchParams(String(init?.body));
      return Response.json({
        body: {
          measuregrps: Array.from({ length: 51 }, (_, index) => ({
            date: 1_720_000_000 - index,
            grpid: 123 + index,
            measures: [{ type: 1, unit: -3, value: 91234 + index }],
          })),
          more: 0,
        },
        status: 0,
      });
    }) as typeof fetch;

    try {
      const outcome = await syncNotification(
        testDb.db,
        received,
        createWithingsConnection(testDb.db, TEST_TOKEN_ENCRYPTION_KEY),
      );
      if (outcome.kind !== "processed") throw new Error("Webhook was not processed.");

      expect(requestedForm?.get("startdate")).toBe(timestamp);
      expect(requestedForm?.get("enddate")).toBe(timestamp);

      const [webhookEvent] = await testDb.db
        .select()
        .from(withingsNotifications)
        .where(eq(withingsNotifications.eventKey, outcome.eventKey))
        .limit(1);
      const storedMeasurements = await testDb.db
        .select()
        .from(measurements)
        .orderBy(measurements.grpid);
      const [measurement] = storedMeasurements;

      expect(storedMeasurements).toHaveLength(count);
      expect(webhookEvent?.status).toBe("processed");
      expect(measurement?.weightKg).toBeCloseTo(91.234);
      expect(measurement?.fatRatioPercent).toBeNull();
      expect(measurement?.raw).toEqual({
        date: 1_720_000_000,
        grpid: 123,
        measures: [{ type: 1, unit: -3, value: 91234 }],
      });
    } finally {
      globalThis.fetch = originalFetch;
      await testDb.cleanup();
    }
  },
);
