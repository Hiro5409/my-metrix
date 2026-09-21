import { Hono } from "hono";
import { createDatabase } from "../db/client";
import { requireApiKey, type AppEnv } from "../http";
import { createWithingsConnection } from "./client";

export const withingsRoutes = new Hono<AppEnv>()
  .use("*", requireApiKey({ withings: ["read"] }))
  .get("/status", async (c) => {
    const connection = createWithingsConnection(createDatabase(c.env), c.env.TOKEN_ENCRYPTION_KEY);
    return c.json(await connection.getStatus(), 200);
  });
