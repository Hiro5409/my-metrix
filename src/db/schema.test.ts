import { expect, test } from "bun:test";
import { createTestDatabase } from "./test-support";

test.each([
  [
    "measurements without a timestamp",
    "INSERT INTO measurements (grpid, raw_json, updated_at) VALUES (1, '{}', 1)",
  ],
  [
    "measurements with malformed raw JSON",
    "INSERT INTO measurements (grpid, timestamp, raw_json, updated_at) VALUES (1, 1720000000, 'invalid', 1)",
  ],
  [
    "unknown notification states",
    "INSERT INTO withings_notifications (event_key, status, received_at) VALUES ('event', 'unknown', 1)",
  ],
])("database rejects %s", async (_description, statement) => {
  const testDb = await createTestDatabase();
  try {
    await expect(testDb.client.prepare(statement).run()).rejects.toThrow(/constraint/i);
  } finally {
    await testDb.cleanup();
  }
});
