import { vValidator } from "@hono/valibot-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { timingSafeEqual } from "node:crypto";
import * as v from "valibot";
import {
  apiKeyOwnerFromEnv,
  createAuth,
  ensureApiKeyOwner,
  listApiKeys,
  revokeApiKey,
} from "../auth/api-key";
import { ConfigurationError } from "../configuration";
import { createDatabase } from "../db/client";
import type { AppEnv } from "../http";
import { getWithingsAuthorizationStatus, startWithingsAuthorization } from "../withings/oauth";
import { createWithingsConnection } from "../withings/client";
import { buildWithingsWebhookUrl } from "../withings/subscription";

const createKeyInput = vValidator(
  "json",
  v.object({
    expiresInDays: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3650))),
    name: v.pipe(v.string(), v.nonEmpty(), v.maxLength(80)),
  }),
  (result, c) => {
    if (!result.success) return c.json({ message: "Invalid API key request." }, 400);
  },
);

const authorizationStatusInput = vValidator(
  "json",
  v.object({ state: v.pipe(v.string(), v.nonEmpty()) }),
  (result, c) => {
    if (!result.success) return c.json({ message: "Invalid authorization status request." }, 400);
  },
);

async function hash(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function requireAdminToken(actual: string | undefined, expected: string | undefined) {
  if (!expected) throw new ConfigurationError("Administrative access is not configured.");
  if (!actual) throw new HTTPException(401, { message: "Unauthorized." });
  const [actualHash, expectedHash] = await Promise.all([hash(actual), hash(expected)]);
  if (!timingSafeEqual(actualHash, expectedHash)) {
    throw new HTTPException(401, { message: "Unauthorized." });
  }
}

export const adminRoutes = new Hono<AppEnv>()
  .use("*", async (c, next) => {
    const [scheme, token] = c.req.header("authorization")?.split(" ", 2) ?? [];
    await requireAdminToken(
      scheme?.toLowerCase() === "bearer" ? token : undefined,
      c.env.ADMIN_TOKEN,
    );
    c.header("Cache-Control", "no-store");
    await next();
  })
  .post("/keys", createKeyInput, async (c) => {
    const input = c.req.valid("json");
    const owner = await ensureApiKeyOwner(c.env, apiKeyOwnerFromEnv(c.env));
    const key = await createAuth(c.env).api.createApiKey({
      body: {
        expiresIn: input.expiresInDays === undefined ? null : input.expiresInDays * 24 * 60 * 60,
        name: input.name,
        userId: owner.userId,
      },
    });
    return c.json(
      {
        id: key.id,
        key: key.key,
        name: key.name,
        prefix: key.prefix,
        start: key.start,
      },
      201,
    );
  })
  .get("/keys", async (c) => {
    const owner = apiKeyOwnerFromEnv(c.env);
    return c.json({ apiKeys: await listApiKeys(c.env, owner.userId) }, 200);
  })
  .delete("/keys/:id", async (c) => {
    const owner = apiKeyOwnerFromEnv(c.env);
    await revokeApiKey(c.env, c.req.param("id"), owner.userId);
    return c.json({ id: c.req.param("id"), revoked: true }, 200);
  })
  .post("/withings/authorization", async (c) => {
    const authorization = await startWithingsAuthorization(createDatabase(c.env), {
      appUrl: c.env.APP_URL,
      clientId: c.env.WITHINGS_CLIENT_ID,
    });
    return c.json(authorization, 200);
  })
  .post("/withings/authorization/status", authorizationStatusInput, async (c) => {
    const status = await getWithingsAuthorizationStatus(
      createDatabase(c.env),
      c.req.valid("json").state,
    );
    return c.json({ status }, 200);
  })
  .post("/withings/subscription", async (c) => {
    const callbackUrl = buildWithingsWebhookUrl({
      appUrl: c.env.APP_URL ?? "",
      secret: c.env.WEBHOOK_SECRET ?? "",
    });
    const status = await createWithingsConnection(
      createDatabase(c.env),
      c.env.TOKEN_ENCRYPTION_KEY,
    ).ensureMeasurementSubscription(callbackUrl);
    return c.json({ category: "body-measurements", status }, 200);
  });
