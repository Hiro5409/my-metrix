import { expect, test } from "bun:test";
import { buildWithingsWebhookUrl, ensureWithingsMeasurementSubscription } from "./subscription";

test("builds an HTTPS Withings webhook URL with one encoded secret segment", () => {
  expect(
    buildWithingsWebhookUrl({
      appUrl: "https://example.com/deployment/path",
      secret: "secret/value",
    }),
  ).toBe("https://example.com/webhooks/withings/secret%2Fvalue");
});

test("rejects a non-HTTPS Withings webhook URL", () => {
  expect(() =>
    buildWithingsWebhookUrl({
      appUrl: "http://example.com",
      secret: "secret",
    }),
  ).toThrow("Application URL must use HTTPS.");
});

test("reuses an existing Withings measurement subscription", async () => {
  let subscribeCalls = 0;
  const callbackUrl = "https://example.com/webhooks/withings/secret";
  const result = await ensureWithingsMeasurementSubscription(
    {
      listNotifications: async () => [{ callbackurl: callbackUrl }],
      subscribeNotification: async () => {
        subscribeCalls += 1;
      },
    },
    callbackUrl,
  );

  expect(result).toBe("existing");
  expect(subscribeCalls).toBe(0);
});

test("creates a missing Withings measurement subscription", async () => {
  let subscribed: { appli: number; callbackurl: string; comment?: string } | undefined;
  const callbackUrl = "https://example.com/webhooks/withings/secret";
  const result = await ensureWithingsMeasurementSubscription(
    {
      listNotifications: async () => [],
      subscribeNotification: async (options) => {
        subscribed = options;
      },
    },
    callbackUrl,
  );

  expect(result).toBe("created");
  expect(subscribed).toEqual({
    appli: 1,
    callbackurl: callbackUrl,
    comment: "MyMetrix body measurements",
  });
});
