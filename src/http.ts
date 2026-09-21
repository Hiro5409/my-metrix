import { isAPIError } from "better-auth/api";
import { Hono, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { RequestIdVariables } from "hono/request-id";
import { routePath } from "hono/route";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { verifyApiKey, type ApiKeyPermissions, type BetterAuthBindings } from "./auth/api-key";
import { ConfigurationError } from "./configuration";
import { logRequest, logUnhandledRequestError } from "./logging";

export type AppEnv = {
  Bindings: BetterAuthBindings & {
    ADMIN_TOKEN?: string;
    APP_URL?: string;
    TOKEN_ENCRYPTION_KEY?: string;
    WEBHOOK_SECRET?: string;
    WITHINGS_CLIENT_ID?: string;
    WITHINGS_CLIENT_SECRET?: string;
  };
  Variables: RequestIdVariables;
};

export type HttpErrorBody = { message: string; requestId: string };

export function createHttpApp() {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      const id = crypto.randomUUID();
      c.set("requestId", id);
      c.header("X-Request-Id", id);
      await next();
    })
    .use("*", secureHeaders())
    .use("*", requestLog())
    .notFound((c) => c.json({ message: "Not found.", requestId: c.get("requestId") }, 404))
    .onError((err, c) => {
      const requestId = c.get("requestId");
      if (err instanceof HTTPException) {
        return c.json({ message: err.message, requestId }, err.status);
      }
      if (err instanceof ConfigurationError) {
        return c.json({ message: err.message, requestId }, 503);
      }
      if (isAPIError(err) && err.statusCode >= 400 && err.statusCode < 600) {
        const status = err.statusCode as ContentfulStatusCode;
        if (status < 500) return c.json({ message: err.message, requestId }, status);
      }
      logUnhandledRequestError({ error: err.name, requestId });
      return c.json({ message: "Internal Server Error", requestId }, 500);
    });
}

export function requireApiKey(permissions: ApiKeyPermissions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.header("Cache-Control", "no-store");
    const apiKey = extractApiKey(c.req.raw.headers);
    if (!apiKey) throw new HTTPException(401, { message: "Unauthorized." });
    const result = await verifyApiKey(c.env, apiKey, permissions);
    if (!result.valid || !result.key) throw new HTTPException(401, { message: "Unauthorized." });
    await next();
  };
}

function extractApiKey(headers: Headers) {
  const headerKey = headers.get("x-api-key");
  if (headerKey) return headerKey;
  const [scheme, value] = headers.get("authorization")?.split(" ", 2) ?? [];
  return scheme?.toLowerCase() === "bearer" && value ? value : undefined;
}

function requestLog(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const startedAt = performance.now();
    await next();
    logRequest({
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      method: c.req.method,
      requestId: c.get("requestId"),
      route: requestRouteLabel(c),
      status: c.res.status,
    });
  };
}

function requestRouteLabel(c: Parameters<typeof routePath>[0]) {
  const path = routePath(c);
  return path === "" || path === "*" || path === "/*" ? "unmatched" : path;
}
