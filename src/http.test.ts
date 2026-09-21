import { afterEach, expect, test } from "bun:test";
import { hc } from "hono/client";
import { createAuth, revokeApiKey } from "./auth/api-key";
import { createTestApiKey, testBetterAuthEnv } from "./auth/test-support";
import { createTestDatabase } from "./db/test-support";
import app, { type AppType } from "./index";
import { saveTestToken, TEST_TOKEN_ENCRYPTION_KEY } from "./withings/test-support";

const originalConsoleLog = console.log;
const originalConsoleInfo = console.info;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

type RequestLogEntry = {
  durationMs: number;
  event: "request";
  level: string;
  logger: string;
  message: string;
  method: string;
  requestId: string;
  route: string;
  status: number;
};

function captureRequestLogs() {
  const entries: RequestLogEntry[] = [];
  const rawEntries: string[] = [];
  const values: unknown[] = [];

  const capture = (value?: unknown, ...rest: unknown[]) => {
    values.push(value);
    const raw = [value, ...rest]
      .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
      .join(" ");
    rawEntries.push(raw);

    try {
      const parsed = (
        typeof value === "string" ? JSON.parse(value) : value
      ) as Partial<RequestLogEntry>;
      if (parsed.event === "request") entries.push(parsed as RequestLogEntry);
    } catch {
      // Ignore unrelated console output.
    }
  };

  console.log = capture as typeof console.log;
  console.info = capture as typeof console.info;
  console.warn = capture as typeof console.warn;
  console.error = capture as typeof console.error;

  return { entries, rawEntries, values };
}

function expectSingleRequestLog(captured: ReturnType<typeof captureRequestLogs>) {
  expect(captured.entries).toHaveLength(1);
  const entry = captured.entries[0];
  if (!entry) throw new Error("Expected a request log entry.");

  expect(Object.keys(entry).sort()).toEqual(
    [
      "durationMs",
      "event",
      "level",
      "logger",
      "message",
      "method",
      "requestId",
      "route",
      "status",
    ].sort(),
  );
  expect(entry.event).toBe("request");
  expect(entry.level).toBe("info");
  expect(entry.logger).toBe("my-metrix.http");
  expect(entry.message).toBe("request");
  expect(entry.requestId).toBeTruthy();
  expect(typeof entry.durationMs).toBe("number");
  expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  return entry;
}

afterEach(() => {
  console.log = originalConsoleLog;
  console.info = originalConsoleInfo;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
});

test("rejects API requests with an invalid Better Auth API key", async () => {
  const testDb = await createTestDatabase();

  try {
    const res = await app.request(
      "/api/withings/status",
      { headers: { Authorization: "Bearer invalid-key" } },
      { ...testBetterAuthEnv, DB: testDb.client },
    );

    expect(res.status).toBe(401);
  } finally {
    await testDb.cleanup();
  }
});

test("rejects API requests with a revoked Better Auth API key", async () => {
  const testDb = await createTestDatabase();
  const key = await createTestApiKey(testDb);
  const env = { ...testBetterAuthEnv, DB: testDb.client };
  const result = await createAuth(env).api.verifyApiKey({ body: { key } });
  if (!result.key) throw new Error("Expected API key to be created.");

  try {
    await revokeApiKey(env, result.key.id, result.key.referenceId);
    const res = await app.request("/api/withings/status", { headers: { "x-api-key": key } }, env);
    expect(res.status).toBe(401);
  } finally {
    await testDb.cleanup();
  }
});

test("enforces Better Auth API key route permissions", async () => {
  const testDb = await createTestDatabase();
  const key = await createTestApiKey(testDb, { measurements: ["read"] });
  const env = { ...testBetterAuthEnv, DB: testDb.client };

  try {
    const measurementsRes = await app.request(
      "/api/measurements/latest",
      { headers: { Authorization: `Bearer ${key}` } },
      env,
    );
    expect(measurementsRes.status).toBe(200);

    const withingsRes = await app.request(
      "/api/withings/status",
      { headers: { Authorization: `Bearer ${key}` } },
      env,
    );
    expect(withingsRes.status).toBe(401);
  } finally {
    await testDb.cleanup();
  }
});

test("rejects API key requests when Better Auth is not configured", async () => {
  const captured = captureRequestLogs();
  const res = await app.request("/api/withings/status", {
    headers: { Authorization: "Bearer fake-key" },
  });
  const body = (await res.json()) as { message: string; requestId?: string };

  expect(res.status).toBe(503);
  expect(body.message).toBe("API key access is not configured.");
  expect(body.requestId).toBeTruthy();
  const entry = expectSingleRequestLog(captured);
  expect(entry.status).toBe(503);
  expect(body.requestId).toBe(entry.requestId);
  expect(captured.rawEntries.join("\n")).not.toContain("fake-key");
});

test("logs sanitized Withings webhook route labels without the path secret", async () => {
  const captured = captureRequestLogs();
  const res = await app.request(
    "/webhooks/withings/fake-secret",
    {},
    { WEBHOOK_SECRET: "fake-secret" },
  );
  const entry = expectSingleRequestLog(captured);

  expect(res.status).toBe(200);
  expect(entry.method).toBe("GET");
  expect(entry.route).toBe("/webhooks/withings/:secret");
  expect(entry.status).toBe(200);
  expect(captured.rawEntries.join("\n")).not.toContain("fake-secret");
});

test("emits request logs as structured console objects", async () => {
  const captured = captureRequestLogs();
  const res = await app.request("/api/health");
  const entry = expectSingleRequestLog(captured);

  expect(res.status).toBe(200);
  expect(captured.values).toEqual([entry]);
});

test("logs rejected Withings webhook requests without the rejected path secret", async () => {
  const captured = captureRequestLogs();
  const res = await app.request(
    "/webhooks/withings/rejected-secret",
    {},
    { WEBHOOK_SECRET: "right-secret" },
  );
  const entry = expectSingleRequestLog(captured);

  expect(res.status).toBe(404);
  expect(entry.method).toBe("GET");
  expect(entry.route).toBe("/webhooks/withings/:secret");
  expect(entry.status).toBe(404);
  expect(captured.rawEntries.join("\n")).not.toContain("rejected-secret");
  expect(captured.rawEntries.join("\n")).not.toContain("right-secret");
});

test("logs POST Withings webhooks without form body values", async () => {
  const testDb = await createTestDatabase();
  const captured = captureRequestLogs();
  await saveTestToken(testDb);

  try {
    const res = await app.request(
      "/webhooks/withings/post-secret",
      {
        body: new URLSearchParams({
          appli: "4",
          body_secret: "form-body-secret-value",
          date: "1720000001",
          userid: "246813579",
        }),
        method: "POST",
      },
      {
        DB: testDb.client,
        TOKEN_ENCRYPTION_KEY: TEST_TOKEN_ENCRYPTION_KEY,
        WEBHOOK_SECRET: "post-secret",
      },
    );
    const entry = expectSingleRequestLog(captured);
    const rawLogs = captured.rawEntries.join("\n");

    expect(res.status).toBe(200);
    expect(entry.method).toBe("POST");
    expect(entry.route).toBe("/webhooks/withings/:secret");
    expect(entry.status).toBe(200);
    expect(rawLogs).not.toContain("post-secret");
    expect(rawLogs).not.toContain("body_secret");
    expect(rawLogs).not.toContain("form-body-secret-value");
    expect(rawLogs).not.toContain("1720000001");
    expect(rawLogs).not.toContain("246813579");
    expect(rawLogs).not.toContain("userid");
    expect(rawLogs).toContain('"event":"withings_webhook_ignored"');
    expect(rawLogs).toContain('"reason":"unexpected_user"');
  } finally {
    await testDb.cleanup();
  }
});

test("logs registered API route labels without query strings", async () => {
  const captured = captureRequestLogs();
  const res = await app.request("/api/measurements/recent?limit=2", {}, { ...testBetterAuthEnv });
  const entry = expectSingleRequestLog(captured);

  expect(res.status).toBe(401);
  expect(entry.method).toBe("GET");
  expect(entry.route).toBe("/api/measurements/*");
  expect(entry.status).toBe(401);
  expect(captured.rawEntries.join("\n")).not.toContain("limit=2");
});

test("does not trust client supplied request IDs in request logs", async () => {
  const captured = captureRequestLogs();
  const res = await app.request(
    "/api/measurements/recent",
    { headers: { "X-Request-Id": "client-supplied-secret-value" } },
    { ...testBetterAuthEnv },
  );
  const entry = expectSingleRequestLog(captured);
  const rawLogs = captured.rawEntries.join("\n");

  expect(res.status).toBe(401);
  expect(res.headers.get("x-request-id")).toBeTruthy();
  expect(res.headers.get("x-request-id")).not.toBe("client-supplied-secret-value");
  expect(entry.route).toBe("/api/measurements/*");
  expect(entry.requestId).toBeTruthy();
  expect(entry.requestId).not.toBe("client-supplied-secret-value");
  expect(rawLogs).not.toContain("client-supplied-secret-value");
});

test("logs unmatched routes without raw paths", async () => {
  const captured = captureRequestLogs();
  const res = await app.request("/missing/fake-secret");
  const entry = expectSingleRequestLog(captured);

  expect(res.status).toBe(404);
  expect(entry.method).toBe("GET");
  expect(entry.route).toBe("unmatched");
  expect(entry.status).toBe(404);
  expect(captured.rawEntries.join("\n")).not.toContain("/missing/fake-secret");
});

test("returns a correlated JSON error for an unmatched RPC request", async () => {
  const client = hc<AppType>("http://localhost", {
    fetch: (input: Request | string | URL, init?: RequestInit) => app.request(input, init),
  });
  const res = await client.webhooks.withings[":secret"].$get({ param: { secret: "" } });

  expect(res.status).toBe(404);
  if (res.status !== 404) throw new Error("Expected an unmatched route.");
  const body = await res.json();
  expect(body.message).toBe("Not found.");
  expect(body.requestId).toBeTruthy();
  expect(res.headers.get("x-request-id")).toBe(body.requestId);
});

test("prevents caching of protected responses, including authentication and validation errors", async () => {
  const testDb = await createTestDatabase();
  try {
    const key = await createTestApiKey(testDb);
    const env = {
      ...testBetterAuthEnv,
      DB: testDb.client,
      TOKEN_ENCRYPTION_KEY: TEST_TOKEN_ENCRYPTION_KEY,
    };
    for (const [path, apiKey, status] of [
      ["/api/measurements/latest", key, 200],
      ["/api/withings/status", key, 200],
      ["/api/measurements/latest", undefined, 401],
      ["/api/measurements/recent?limit=invalid", key, 400],
    ] as const) {
      const res = await app.request(path, { headers: apiKey ? { "x-api-key": apiKey } : {} }, env);
      expect(res.status).toBe(status);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  } finally {
    await testDb.cleanup();
  }
});
