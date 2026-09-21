import { check, index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const measurements = sqliteTable(
  "measurements",
  {
    grpid: integer("grpid").primaryKey(),
    timestamp: integer("timestamp").notNull(),
    weightKg: real("weight_kg"),
    fatRatioPercent: real("fat_ratio_percent"),
    fatMassKg: real("fat_mass_kg"),
    fatFreeMassKg: real("fat_free_mass_kg"),
    muscleMassKg: real("muscle_mass_kg"),
    hydrationKg: real("hydration_kg"),
    boneMassKg: real("bone_mass_kg"),
    raw: text("raw_json", { mode: "json" }).$type<unknown>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("measurements_timestamp_grpid_idx").on(table.timestamp, table.grpid),
    check("measurements_raw_json_check", sql`json_valid(${table.raw})`),
  ],
);
