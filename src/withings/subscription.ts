import { ConfigurationError } from "../configuration";

export function buildWithingsWebhookUrl(options: { appUrl: string; secret: string }) {
  if (!options.appUrl) throw new ConfigurationError("Application URL is not configured.");
  if (!options.secret) throw new ConfigurationError("Webhook secret is not configured.");
  const appUrl = new URL(options.appUrl);
  if (appUrl.protocol !== "https:") {
    throw new ConfigurationError("Application URL must use HTTPS.");
  }
  return new URL(`/webhooks/withings/${encodeURIComponent(options.secret)}`, appUrl).toString();
}

type WithingsNotificationClient = {
  listNotifications(options: { appli?: number }): Promise<ReadonlyArray<{ callbackurl?: string }>>;
  subscribeNotification(options: {
    appli: number;
    callbackurl: string;
    comment?: string;
  }): Promise<void>;
};

export async function ensureWithingsMeasurementSubscription(
  client: WithingsNotificationClient,
  callbackUrl: string,
) {
  const subscriptions = await client.listNotifications({ appli: 1 });
  if (subscriptions.some((subscription) => subscription.callbackurl === callbackUrl)) {
    return "existing" as const;
  }

  await client.subscribeNotification({
    appli: 1,
    callbackurl: callbackUrl,
    comment: "MyMetrix body measurements",
  });
  return "created" as const;
}
