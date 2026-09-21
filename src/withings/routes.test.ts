import { expect, test } from "bun:test";
import { createTestApiKey, testBetterAuthEnv } from "../auth/test-support";
import { createTestDatabase } from "../db/test-support";
import app from "../index";
import { saveTestToken, TEST_TOKEN_ENCRYPTION_KEY } from "./test-support";

type WithingsStatusResponse = {
  authenticated: boolean;
  isValid?: boolean;
};

test("reports missing Withings token without exposing secrets", async () => {
  const testDb = await createTestDatabase();
  const key = await createTestApiKey(testDb);

  try {
    const res = await app.request(
      "/api/withings/status",
      { headers: { Authorization: `Bearer ${key}` } },
      {
        ...testBetterAuthEnv,
        DB: testDb.client,
        TOKEN_ENCRYPTION_KEY: TEST_TOKEN_ENCRYPTION_KEY,
      },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect((await res.json()) as WithingsStatusResponse).toEqual({
      authenticated: false,
    });
  } finally {
    await testDb.cleanup();
  }
});

test("reports configured Withings token status without exposing secrets", async () => {
  const testDb = await createTestDatabase();
  const key = await createTestApiKey(testDb);
  await saveTestToken(testDb);

  try {
    const res = await app.request(
      "/api/withings/status",
      { headers: { Authorization: `Bearer ${key}` } },
      {
        ...testBetterAuthEnv,
        DB: testDb.client,
        TOKEN_ENCRYPTION_KEY: TEST_TOKEN_ENCRYPTION_KEY,
      },
    );
    const body = (await res.json()) as WithingsStatusResponse;

    expect(res.status).toBe(200);
    expect(body.authenticated).toBe(true);
    expect(body.isValid).toBe(true);
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(JSON.stringify(body)).not.toContain("access");
    expect(JSON.stringify(body)).not.toContain("refresh");
  } finally {
    await testDb.cleanup();
  }
});

test("requires a Better Auth API key", async () => {
  const testDb = await createTestDatabase();
  const key = await createTestApiKey(testDb);
  const env = {
    ...testBetterAuthEnv,
    DB: testDb.client,
    TOKEN_ENCRYPTION_KEY: TEST_TOKEN_ENCRYPTION_KEY,
  };

  try {
    const rejected = await app.request("/api/withings/status", {}, env);
    const accepted = await app.request(
      "/api/withings/status",
      { headers: { Authorization: `Bearer ${key}` } },
      env,
    );

    expect(rejected.status).toBe(401);
    expect(accepted.status).toBe(200);
    expect((await accepted.json()) as WithingsStatusResponse).toEqual({
      authenticated: false,
    });
  } finally {
    await testDb.cleanup();
  }
});
