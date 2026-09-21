import { vValidator } from "@hono/valibot-validator";
import { Hono } from "hono";
import * as v from "valibot";
import { createDatabase } from "../db/client";
import type { AppEnv } from "../http";
import { completeWithingsAuthorization, failWithingsAuthorization } from "./oauth";

const callbackQuery = vValidator(
  "query",
  v.union([
    v.object({
      code: v.pipe(v.string(), v.nonEmpty()),
      state: v.pipe(v.string(), v.nonEmpty()),
    }),
    v.object({
      error: v.pipe(v.string(), v.nonEmpty()),
      state: v.pipe(v.string(), v.nonEmpty()),
    }),
  ]),
  (result, c) => {
    if (!result.success) return c.text("Invalid Withings authorization callback.", 400);
  },
);

export const withingsOAuthRoutes = new Hono<AppEnv>().get("/callback", callbackQuery, async (c) => {
  const input = c.req.valid("query");
  const db = createDatabase(c.env);
  if ("error" in input) {
    const result = await failWithingsAuthorization(db, input.state);
    if (result.kind === "invalid") return c.text("Invalid or expired authorization.", 400);
    return c.text("Withings authorization was not completed.", 400);
  }
  const result = await completeWithingsAuthorization(
    db,
    {
      appUrl: c.env.APP_URL,
      clientId: c.env.WITHINGS_CLIENT_ID,
      clientSecret: c.env.WITHINGS_CLIENT_SECRET,
      encryptionKey: c.env.TOKEN_ENCRYPTION_KEY,
    },
    input,
  );
  if (result.kind === "invalid") return c.text("Invalid or expired authorization.", 400);
  if (result.kind === "failed") return c.text("Withings authorization failed.", 502);
  return c.text("MyMetrix is connected to Withings. You can close this window.", 200);
});
