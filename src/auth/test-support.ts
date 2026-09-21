import { createAuth, ensureApiKeyOwner, type ApiKeyPermissions } from "./api-key";
import type { createTestDatabase } from "../db/test-support";

export const testBetterAuthEnv = {
  BETTER_AUTH_SECRET: "test-better-auth-secret-with-enough-entropy",
} as const;

export async function createTestApiKey(
  testDb: Awaited<ReturnType<typeof createTestDatabase>>,
  permissions?: ApiKeyPermissions,
) {
  const env = {
    ...testBetterAuthEnv,
    DB: testDb.client,
  };
  const owner = await ensureApiKeyOwner(env, {
    email: "api-owner@example.test",
    name: "API Owner",
    userId: "api-owner",
  });
  const apiKey = await createAuth(env).api.createApiKey({
    body: {
      name: "test-key",
      permissions,
      userId: owner.userId,
    },
  });
  return apiKey.key;
}
