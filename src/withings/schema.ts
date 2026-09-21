import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const withingsConnection = sqliteTable(
  "withings_connection",
  {
    id: integer("id").primaryKey().default(1),
    tokenJson: text("token_json").notNull(),
    expiresAt: integer("expires_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [check("withings_connection_singleton_check", sql`${table.id} = 1`)],
);

export const withingsRefreshLease = sqliteTable(
  "withings_refresh_lease",
  {
    id: integer("id").primaryKey().default(1),
    owner: text("owner").notNull(),
    expiresAt: integer("expires_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [check("withings_refresh_lease_singleton_check", sql`${table.id} = 1`)],
);

export const withingsAuthorization = sqliteTable(
  "withings_authorization",
  {
    id: integer("id").primaryKey().default(1),
    stateHash: text("state_hash").notNull(),
    status: text("status", {
      enum: ["pending", "exchanging", "succeeded", "failed"],
    }).notNull(),
    expiresAt: integer("expires_at").notNull(),
    error: text("error"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check("withings_authorization_singleton_check", sql`${table.id} = 1`),
    check(
      "withings_authorization_status_check",
      sql`${table.status} in ('pending', 'exchanging', 'succeeded', 'failed')`,
    ),
  ],
);

export const withingsNotifications = sqliteTable(
  "withings_notifications",
  {
    eventKey: text("event_key").primaryKey(),
    status: text("status", { enum: ["received", "processed", "failed"] }).notNull(),
    error: text("error"),
    receivedAt: integer("received_at").notNull(),
    processedAt: integer("processed_at"),
  },
  (table) => [
    index("withings_notifications_received_at_idx").on(table.receivedAt),
    check(
      "withings_notifications_status_check",
      sql`${table.status} in ('received', 'processed', 'failed')`,
    ),
  ],
);
