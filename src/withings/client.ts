import { createWithingsClient, getTokenStatus } from "withings-cli";
import { ConfigurationError } from "../configuration";
import type { AppDatabase } from "../db/client";
import { WithingsTokenStore } from "./token-store";
import type { MeasurementSelection } from "./notification";
import { ensureWithingsMeasurementSubscription } from "./subscription";

export function createWithingsConnection(db: AppDatabase, encryptionKey: string | undefined) {
  if (!encryptionKey) throw new ConfigurationError("Token encryption key is not configured.");
  const store = new WithingsTokenStore(db, encryptionKey);
  const client = createWithingsClient({ store });

  async function loadToken() {
    const token = await store.load();
    if (!token) throw new ConfigurationError("Withings token store is not configured.");
    return token;
  }

  return {
    async getStatus() {
      const token = await store.load();
      if (!token) return { authenticated: false as const };
      const status = getTokenStatus(token);
      return {
        authenticated: true as const,
        expiresAt: status.expiresAt.toISOString(),
        isValid: status.isValid,
        scope: token.scope,
      };
    },
    async loadUserId() {
      const token = await loadToken();
      if (token.userid === undefined)
        throw new ConfigurationError("Withings user is not configured.");
      return token.userid;
    },
    async fetchMeasures(selection: MeasurementSelection) {
      await loadToken();
      const query =
        selection.kind === "latest"
          ? { limit: 1 }
          : { startdate: selection.startTimestamp, enddate: selection.endTimestamp };
      const result = await client.fetchMeasures({ query });
      return result.measures.flatMap((measure) => {
        if (measure.grpid === undefined || measure.timestamp === undefined) return [];
        return [{ ...measure, grpid: measure.grpid, timestamp: measure.timestamp }];
      });
    },
    async ensureMeasurementSubscription(callbackUrl: string) {
      return ensureWithingsMeasurementSubscription(client, callbackUrl);
    },
  };
}
