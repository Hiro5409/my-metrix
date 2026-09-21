import { expect, test } from "bun:test";
import app from "../index";

test("allows callback URL probes only with the configured path secret", async () => {
  const okRes = await app.request(
    "/webhooks/withings/webhook-secret",
    {},
    { WEBHOOK_SECRET: "webhook-secret" },
  );
  const wrongRes = await app.request(
    "/webhooks/withings/wrong",
    {},
    { WEBHOOK_SECRET: "webhook-secret" },
  );

  expect(okRes.status).toBe(200);
  expect((await okRes.json()) as { ok: boolean }).toEqual({ ok: true });
  expect(wrongRes.status).toBe(404);
});

test("rejects webhook requests with a wrong path secret", async () => {
  const res = await app.request(
    "/webhooks/withings/wrong",
    {
      body: new URLSearchParams({ appli: "1", userid: "1" }),
      method: "POST",
    },
    { WEBHOOK_SECRET: "right" },
  );

  expect(res.status).toBe(404);
});

test("checks the path secret before parsing the webhook payload", async () => {
  const res = await app.request(
    "/webhooks/withings/wrong",
    {
      body: new URLSearchParams({ appli: "invalid", userid: "1" }),
      method: "POST",
    },
    { WEBHOOK_SECRET: "right" },
  );

  expect(res.status).toBe(404);
});

test("validates webhook payloads after the path secret passes", async () => {
  const res = await app.request(
    "/webhooks/withings/right",
    {
      body: new URLSearchParams({ appli: "invalid", userid: "1" }),
      method: "POST",
    },
    { WEBHOOK_SECRET: "right" },
  );

  expect(res.status).toBe(400);
});
