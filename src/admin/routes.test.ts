import { expect, test } from "bun:test";
import { createTestDatabase } from "../db/test-support";
import app from "../index";

const adminToken = "test-admin-token-with-enough-entropy";

test("admin manages client API keys without database access", async () => {
  const testDb = await createTestDatabase();
  const env = {
    ADMIN_TOKEN: adminToken,
    BETTER_AUTH_SECRET: "test-better-auth-secret-with-enough-entropy",
    DB: testDb.client,
  };

  try {
    const unauthorized = await app.request("/api/admin/keys", { method: "POST" }, env);
    expect(unauthorized.status).toBe(401);

    const created = await app.request(
      "/api/admin/keys",
      {
        body: JSON.stringify({ name: "phone" }),
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      },
      env,
    );
    expect(created.status).toBe(201);
    const key = (await created.json()) as { id: string; key: string };
    expect(key.key).toStartWith("mym_");

    const listed = await app.request(
      "/api/admin/keys",
      { headers: { Authorization: `Bearer ${adminToken}` } },
      env,
    );
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as { apiKeys: Array<{ id: string; key?: string }> };
    expect(listBody.apiKeys).toHaveLength(1);
    expect(listBody.apiKeys[0]?.id).toBe(key.id);
    expect(listBody.apiKeys[0]?.key).toBeUndefined();

    const revoked = await app.request(
      `/api/admin/keys/${key.id}`,
      { headers: { Authorization: `Bearer ${adminToken}` }, method: "DELETE" },
      env,
    );
    expect(revoked.status).toBe(200);

    const protectedResponse = await app.request(
      "/api/measurements/latest",
      { headers: { Authorization: `Bearer ${key.key}` } },
      env,
    );
    expect(protectedResponse.status).toBe(401);
  } finally {
    await testDb.cleanup();
  }
});

test("admin receives not found when revoking an unknown API key", async () => {
  const testDb = await createTestDatabase();
  const env = {
    ADMIN_TOKEN: adminToken,
    BETTER_AUTH_SECRET: "test-better-auth-secret-with-enough-entropy",
    DB: testDb.client,
  };

  try {
    const response = await app.request(
      "/api/admin/keys/unknown",
      { headers: { Authorization: `Bearer ${adminToken}` }, method: "DELETE" },
      env,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ message: "API Key not found" });
  } finally {
    await testDb.cleanup();
  }
});
