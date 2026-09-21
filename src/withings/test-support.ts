import type { createTestDatabase } from "../db/test-support";
import { WithingsTokenStore } from "./token-store";

export const TEST_TOKEN_ENCRYPTION_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";

function testToken(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    accessToken: "access",
    clientId: "client",
    clientSecret: "secret",
    expiresAt: Date.now() + 60_000,
    refreshToken: "refresh",
    scope: "user.metrics",
    userid: 1,
    ...overrides,
  };
}

export async function saveTestToken(
  testDb: Awaited<ReturnType<typeof createTestDatabase>>,
  overrides: Partial<Record<string, unknown>> = {},
) {
  const store = new WithingsTokenStore(testDb.db, TEST_TOKEN_ENCRYPTION_KEY);
  await store.save(testToken(overrides));
}
