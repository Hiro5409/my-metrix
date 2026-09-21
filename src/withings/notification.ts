import { parseNotificationPayload } from "withings-cli";

type WithingsPayload = ReturnType<typeof parseNotificationPayload>;

export type MeasurementSelection =
  | Readonly<{ kind: "latest" }>
  | Readonly<{ kind: "period"; startTimestamp: number; endTimestamp: number }>;

type Notification =
  | Readonly<{ kind: "measurements"; userId: number | null; selection: MeasurementSelection }>
  | Readonly<{ kind: "other"; userId: number | null }>;

export type NotificationPlan =
  | Readonly<{ kind: "ignore"; reason: "missing_user" }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "acknowledge"; userId: number }>
  | Readonly<{ kind: "sync"; userId: number; selection: MeasurementSelection }>;

function measurementSelection(payload: WithingsPayload): MeasurementSelection {
  const startTimestamp = payload.startdate ?? payload.enddate;
  if (startTimestamp !== undefined) {
    return {
      kind: "period",
      startTimestamp,
      endTimestamp: payload.enddate ?? startTimestamp,
    };
  }
  if (typeof payload.date === "number") {
    return { kind: "period", startTimestamp: payload.date, endTimestamp: payload.date };
  }
  if (typeof payload.date === "string") {
    const startTimestamp = Date.parse(`${payload.date}T00:00:00.000Z`) / 1000;
    return { kind: "period", startTimestamp, endTimestamp: startTimestamp + 86_399 };
  }
  return { kind: "latest" };
}

export function parseWithingsNotification(input: unknown) {
  const payload = parseNotificationPayload(input);
  const userId = payload.userid ?? null;
  const notification: Notification =
    payload.appli === 1
      ? { kind: "measurements", userId, selection: measurementSelection(payload) }
      : { kind: "other", userId };

  return {
    notification,
    receipt: {
      eventKey: [
        "withings",
        payload.userid,
        String(payload.appli),
        String(payload.startdate ?? ""),
        String(payload.enddate ?? ""),
        String(payload.date ?? ""),
      ].join(":"),
    },
  };
}

export type ReceivedNotification = ReturnType<typeof parseWithingsNotification>;

export function planNotification(notification: Notification): NotificationPlan {
  if (notification.userId === null) {
    return notification.kind === "measurements"
      ? { kind: "invalid" }
      : { kind: "ignore", reason: "missing_user" };
  }
  return notification.kind === "measurements"
    ? { kind: "sync", userId: notification.userId, selection: notification.selection }
    : { kind: "acknowledge", userId: notification.userId };
}
