import { expect, mock, test } from "bun:test";
import { createTestApiKey, testBetterAuthEnv } from "../auth/test-support";
import { createTestDatabase } from "../db/test-support";
import app from "../index";
import { saveTestToken, TEST_TOKEN_ENCRYPTION_KEY } from "./test-support";

const adminToken = "test-admin-token-with-enough-entropy";

test("admin connects Withings through the hosted OAuth callback", async () => {
  const originalFetch = globalThis.fetch;
  const testDb = await createTestDatabase();
  const apiKey = await createTestApiKey(testDb);
  const env = {
    ...testBetterAuthEnv,
    ADMIN_TOKEN: adminToken,
    APP_URL: "https://metrics.example.test",
    DB: testDb.client,
    TOKEN_ENCRYPTION_KEY: TEST_TOKEN_ENCRYPTION_KEY,
    WITHINGS_CLIENT_ID: "withings-client",
    WITHINGS_CLIENT_SECRET: "withings-secret",
  };
  const fetchMock = mock(() =>
    Promise.resolve(
      Response.json({
        body: {
          access_token: "access",
          expires_in: 10_800,
          refresh_token: "refresh",
          scope: "user.metrics",
          token_type: "Bearer",
          userid: 123,
        },
        status: 0,
      }),
    ),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  try {
    const started = await app.request(
      "/api/admin/withings/authorization",
      { headers: { Authorization: `Bearer ${adminToken}` }, method: "POST" },
      env,
    );
    expect(started.status).toBe(200);
    const { authorizationUrl, state } = (await started.json()) as {
      authorizationUrl: string;
      state: string;
    };
    const url = new URL(authorizationUrl);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://metrics.example.test/oauth/withings/callback",
    );
    expect(url.searchParams.get("state")).toBe(state);

    const callback = await app.request(
      `/oauth/withings/callback?code=authorization-code&state=${encodeURIComponent(state)}`,
      {},
      env,
    );
    expect(callback.status).toBe(200);
    expect(await callback.text()).not.toContain("authorization-code");

    const status = await app.request(
      "/api/admin/withings/authorization/status",
      {
        body: JSON.stringify({ state }),
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      },
      env,
    );
    expect((await status.json()) as { status: string }).toEqual({ status: "succeeded" });

    const connection = await app.request(
      "/api/withings/status",
      { headers: { Authorization: `Bearer ${apiKey}` } },
      env,
    );
    expect(await connection.json()).toMatchObject({ authenticated: true, isValid: true });

    const replayed = await app.request(
      `/oauth/withings/callback?code=replayed&state=${encodeURIComponent(state)}`,
      {},
      env,
    );
    expect(replayed.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    globalThis.fetch = originalFetch;
    await testDb.cleanup();
  }
});

test("admin sees a failed authorization when Withings access is denied", async () => {
  const originalFetch = globalThis.fetch;
  const testDb = await createTestDatabase();
  const env = {
    ...testBetterAuthEnv,
    ADMIN_TOKEN: adminToken,
    APP_URL: "https://metrics.example.test",
    DB: testDb.client,
    TOKEN_ENCRYPTION_KEY: TEST_TOKEN_ENCRYPTION_KEY,
    WITHINGS_CLIENT_ID: "withings-client",
    WITHINGS_CLIENT_SECRET: "withings-secret",
  };
  const fetchMock = mock(() => {
    throw new Error("token exchange should not run after access is denied");
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  try {
    const started = await app.request(
      "/api/admin/withings/authorization",
      { headers: { Authorization: `Bearer ${adminToken}` }, method: "POST" },
      env,
    );
    const { state } = (await started.json()) as { state: string };

    const callback = await app.request(
      `/oauth/withings/callback?error=access_denied&state=${encodeURIComponent(state)}`,
      {},
      env,
    );
    expect(callback.status).toBe(400);

    const status = await app.request(
      "/api/admin/withings/authorization/status",
      {
        body: JSON.stringify({ state }),
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      },
      env,
    );
    expect((await status.json()) as { status: string }).toEqual({ status: "failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    globalThis.fetch = originalFetch;
    await testDb.cleanup();
  }
});

test("admin sees an interrupted token exchange expire", async () => {
  const testDb = await createTestDatabase();
  const env = {
    ...testBetterAuthEnv,
    ADMIN_TOKEN: adminToken,
    APP_URL: "https://metrics.example.test",
    DB: testDb.client,
    WITHINGS_CLIENT_ID: "withings-client",
  };

  try {
    const started = await app.request(
      "/api/admin/withings/authorization",
      { headers: { Authorization: `Bearer ${adminToken}` }, method: "POST" },
      env,
    );
    const { state } = (await started.json()) as { state: string };
    await testDb.client
      .prepare("update withings_authorization set status = 'exchanging', expires_at = 0")
      .run();

    const status = await app.request(
      "/api/admin/withings/authorization/status",
      {
        body: JSON.stringify({ state }),
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      },
      env,
    );
    expect((await status.json()) as { status: string }).toEqual({ status: "expired" });
  } finally {
    await testDb.cleanup();
  }
});

test("admin registers the Withings measurement callback through the service", async () => {
  const originalFetch = globalThis.fetch;
  const testDb = await createTestDatabase();
  await saveTestToken(testDb);
  const responses = [
    Response.json({ body: { profiles: [] }, status: 0 }),
    Response.json({ body: {}, status: 0 }),
  ];
  const fetchMock = mock((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(responses.shift() ?? Response.json({ status: 0 })),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  try {
    const response = await app.request(
      "/api/admin/withings/subscription",
      { headers: { Authorization: `Bearer ${adminToken}` }, method: "POST" },
      {
        ADMIN_TOKEN: adminToken,
        APP_URL: "https://metrics.example.test",
        DB: testDb.client,
        TOKEN_ENCRYPTION_KEY: TEST_TOKEN_ENCRYPTION_KEY,
        WEBHOOK_SECRET: "webhook-secret",
      },
    );

    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toEqual({
      category: "body-measurements",
      status: "created",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const subscribeBody = new URLSearchParams(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(subscribeBody.get("callbackurl")).toBe(
      "https://metrics.example.test/webhooks/withings/webhook-secret",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await testDb.cleanup();
  }
});
