import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { ConfigurationError } from "../configuration";

export type AppDatabase = DrizzleD1Database;

export type DatabaseBindings = {
  DB?: D1Database;
};

export function createDatabase(env: DatabaseBindings | undefined): AppDatabase {
  if (!env?.DB) throw new ConfigurationError("Database access is not configured.");
  return drizzle(env.DB);
}
