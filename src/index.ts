import type { ApplyGlobalResponse } from "hono/client";
import { adminRoutes } from "./admin/routes";
import { createHttpApp, type HttpErrorBody } from "./http";
import { measurementRoutes } from "./measurements/routes";
import { withingsRoutes } from "./withings/routes";
import { withingsOAuthRoutes } from "./withings/oauth-routes";
import { withingsWebhookRoutes } from "./withings/webhook-routes";

const app = createHttpApp()
  .get("/", (c) => c.json({ name: "MyMetrix", status: "ok" }, 200))
  .get("/api/health", (c) => c.json({ ok: true }, 200))
  .route("/api/admin", adminRoutes)
  .route("/api/measurements", measurementRoutes)
  .route("/api/withings", withingsRoutes)
  .route("/oauth/withings", withingsOAuthRoutes)
  .route("/webhooks/withings", withingsWebhookRoutes);

export type AppType = ApplyGlobalResponse<
  typeof app,
  {
    401: { json: HttpErrorBody };
    404: { json: HttpErrorBody };
    500: { json: HttpErrorBody };
    503: { json: HttpErrorBody };
  }
>;

export default app;
