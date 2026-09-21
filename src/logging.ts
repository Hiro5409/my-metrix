type RequestLogFields = {
  durationMs: number;
  method: string;
  requestId: string;
  route: string;
  status: number;
};

type UnhandledRequestErrorLogFields = {
  error: string;
  requestId: string;
};

type WithingsWebhookIgnoredLogFields = {
  reason: "missing_user" | "unexpected_user";
  requestId: string;
};

type LogLevel = "error" | "info" | "warning";

function writeLog(
  level: LogLevel,
  logger: "my-metrix.http" | "my-metrix.withings",
  message: string,
  properties: Record<string, unknown>,
) {
  const entry = { ...properties, level, logger, message };
  if (level === "error") {
    console.error(entry);
    return;
  }
  if (level === "warning") {
    console.warn(entry);
    return;
  }
  console.log(entry);
}

export function logRequest(fields: RequestLogFields) {
  writeLog("info", "my-metrix.http", "request", {
    event: "request",
    ...fields,
  });
}

export function logUnhandledRequestError(fields: UnhandledRequestErrorLogFields) {
  writeLog("error", "my-metrix.http", "unhandled request error", {
    event: "unhandled_request_error",
    ...fields,
  });
}

export function logWithingsWebhookIgnored(fields: WithingsWebhookIgnoredLogFields) {
  writeLog("warning", "my-metrix.withings", "withings webhook ignored", {
    event: "withings_webhook_ignored",
    ...fields,
  });
}
