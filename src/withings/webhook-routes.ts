import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { timingSafeEqual } from "node:crypto";
import { createDatabase } from "../db/client";
import type { AppEnv } from "../http";
import { logWithingsWebhookIgnored } from "../logging";
import { createWithingsConnection } from "./client";
import { parseWithingsNotification } from "./notification";
import { syncNotification } from "./sync";

const withingsWebhookValidator = validator("form", (value, c) => {
  try {
    return parseWithingsNotification(value);
  } catch {
    return c.json({ message: "Invalid Withings webhook payload." }, 400);
  }
});

async function hashSecret(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function timingSafeEqualSecret(actualSecret: string | undefined, expectedSecret: string) {
  if (actualSecret === undefined) return false;

  const [actualHash, expectedHash] = await Promise.all([
    hashSecret(actualSecret),
    hashSecret(expectedSecret),
  ]);
  return timingSafeEqual(actualHash, expectedHash);
}

async function requireWithingsWebhookSecret(
  actualSecret: string | undefined,
  env: AppEnv["Bindings"] | undefined,
) {
  const expectedSecret = env?.WEBHOOK_SECRET;
  if (!expectedSecret) {
    throw new HTTPException(503, {
      message: "Webhook access is not configured.",
    });
  }

  if (!(await timingSafeEqualSecret(actualSecret, expectedSecret))) {
    throw new HTTPException(404, {
      message: "Not found.",
    });
  }
}

export const withingsWebhookRoutes = new Hono<AppEnv>()
  .use("/:secret", async (c, next) => {
    await requireWithingsWebhookSecret(c.req.param("secret"), c.env);
    await next();
  })
  .get("/:secret", (c) => c.json({ ok: true }, 200))
  .post("/:secret", withingsWebhookValidator, async (c) => {
    const db = createDatabase(c.env);
    const connection = createWithingsConnection(db, c.env.TOKEN_ENCRYPTION_KEY);
    const outcome = await syncNotification(db, c.req.valid("form"), connection);
    switch (outcome.kind) {
      case "ignored":
        logWithingsWebhookIgnored({ reason: outcome.reason, requestId: c.get("requestId") });
        return c.json({ ok: true, ignored: true }, 200);
      case "invalid":
        return c.json({ message: "Invalid Withings webhook payload." }, 400);
      case "retry":
        return c.json({ message: "Webhook event is still being processed." }, 503);
      case "processed":
        return c.json({ ok: true, eventKey: outcome.eventKey }, 200);
    }
  });
