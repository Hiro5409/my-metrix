import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import * as v from "valibot";
import { createDatabase } from "../db/client";
import { requireApiKey, type AppEnv } from "../http";
import { getLatestMeasurement, getMeasurementTrend, getRecentMeasurements } from "./queries";

const recentQuery = vValidator(
  "query",
  v.object({
    limit: v.optional(
      v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(1), v.maxValue(31)),
      "7",
    ),
  }),
  (result, c) => {
    if (!result.success) return c.json({ message: "Invalid measurements query." }, 400);
  },
);

export const measurementRoutes = new Hono<AppEnv>()
  .use("*", requireApiKey({ measurements: ["read"] }))
  .get("/latest", async (c) => {
    const latest = await getLatestMeasurement(createDatabase(c.env));
    return c.json({ latest: latest ?? null }, 200);
  })
  .get("/recent", recentQuery, async (c) => {
    const measurements = await getRecentMeasurements(
      createDatabase(c.env),
      c.req.valid("query").limit,
    );
    return c.json({ measurements }, 200);
  })
  .get("/trend", async (c) => {
    const trend = await getMeasurementTrend(createDatabase(c.env));
    return c.json({ trend }, 200);
  });
