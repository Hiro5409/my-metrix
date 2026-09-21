import { expect, test } from "bun:test";
import { hc } from "hono/client";
import { createTestApiKey, testBetterAuthEnv } from "../auth/test-support";
import { measurements } from "./schema";
import { createTestDatabase } from "../db/test-support";
import app, { type AppType } from "../index";

test("accepts an x-api-key header and requires an API key", async () => {
  const testDb = await createTestDatabase();
  const key = await createTestApiKey(testDb);

  try {
    const env = { ...testBetterAuthEnv, DB: testDb.client };
    const accepted = await app.request(
      "/api/measurements/latest",
      { headers: { "x-api-key": key } },
      env,
    );
    const rejected = await app.request("/api/measurements/latest", {}, env);

    expect(accepted.status).toBe(200);
    expect((await accepted.json()) as { latest: null }).toEqual({ latest: null });
    expect(rejected.status).toBe(401);
  } finally {
    await testDb.cleanup();
  }
});

test("reads latest, recent, and trend measurements through the typed RPC client", async () => {
  const testDb = await createTestDatabase();
  const key = await createTestApiKey(testDb);
  const latestTimestamp = 1_720_000_000;

  try {
    await testDb.db.insert(measurements).values([
      {
        grpid: 1,
        timestamp: latestTimestamp - 31 * 86_400,
        weightKg: 92,
        raw: {},
        updatedAt: 1,
      },
      {
        grpid: 2,
        timestamp: latestTimestamp - 30 * 86_400,
        weightKg: 90,
        raw: {},
        updatedAt: 1,
      },
      {
        grpid: 3,
        timestamp: latestTimestamp - 1 * 86_400,
        weightKg: 82,
        raw: {},
        updatedAt: 1,
      },
      {
        grpid: 4,
        timestamp: latestTimestamp,
        weightKg: 80,
        raw: {},
        updatedAt: 1,
      },
      {
        grpid: 5,
        timestamp: latestTimestamp - 2 * 86_400,
        raw: {},
        updatedAt: 1,
      },
    ]);

    const env = { ...testBetterAuthEnv, DB: testDb.client };
    const client = hc<AppType>("http://localhost", {
      headers: { Authorization: `Bearer ${key}` },
      fetch: (input: Request | string | URL, init?: RequestInit) => app.request(input, init, env),
    });
    const latestRes = await client.api.measurements.latest.$get();
    if (latestRes.status !== 200) throw new Error("Latest measurements request failed.");
    const latest = await latestRes.json();

    expect(latest.latest).toEqual({
      grpid: 4,
      timestamp: latestTimestamp,
      weightKg: 80,
      fatRatioPercent: null,
      fatMassKg: null,
      fatFreeMassKg: null,
      muscleMassKg: null,
      hydrationKg: null,
      boneMassKg: null,
    });

    const recentRes = await client.api.measurements.recent.$get({ query: { limit: "2" } });
    if (recentRes.status !== 200) throw new Error("Recent measurements request failed.");
    const recent = await recentRes.json();
    expect(recent.measurements.map((measurement) => measurement.grpid)).toEqual([4, 3]);

    const trendRes = await client.api.measurements.trend.$get();
    if (trendRes.status !== 200) throw new Error("Measurement trend request failed.");
    const trend = await trendRes.json();
    expect(trend.trend.current?.weightKgAverage).toBe(81);
    expect(trend.trend.current?.count).toBe(3);
    expect(trend.trend.previous?.weightKgAverage).toBe(91);
    expect(trend.trend.delta?.weightKgAverage).toBe(-10);
  } finally {
    await testDb.cleanup();
  }
});

test("returns explicit nulls for missing measurements and unavailable trend averages", async () => {
  const testDb = await createTestDatabase();
  try {
    const key = await createTestApiKey(testDb);
    const env = { ...testBetterAuthEnv, DB: testDb.client };
    const client = hc<AppType>("http://localhost", {
      headers: { "x-api-key": key },
      fetch: (input: Request | string | URL, init?: RequestInit) => app.request(input, init, env),
    });
    const emptyRes = await client.api.measurements.trend.$get();
    expect(await emptyRes.json()).toEqual({
      trend: { latest: null, current: null, previous: null, delta: null },
    });

    await testDb.db.insert(measurements).values({
      grpid: 1,
      timestamp: 1_720_000_000,
      raw: { measures: [], source: "計測" },
      updatedAt: 1,
    });
    const response = await client.api.measurements.trend.$get();
    if (response.status !== 200) throw new Error("Measurement trend request failed.");
    const { trend } = await response.json();
    expect(trend.latest?.grpid).toBe(1);
    expect(trend.latest).toMatchObject({ weightKg: null });
    expect(trend.latest).not.toHaveProperty("date");
    expect(trend.latest).not.toHaveProperty("raw");
    expect(trend.latest).not.toHaveProperty("updatedAt");
    expect(trend.current).toMatchObject({ count: 1, weightKgAverage: null });
    expect(trend.previous).toMatchObject({ count: 0, weightKgAverage: null });
    expect(trend.delta).toBeNull();
  } finally {
    await testDb.cleanup();
  }
});
