import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth/minimal";
import { eq } from "drizzle-orm";
import { ConfigurationError } from "../configuration";
import { createDatabase, type DatabaseBindings } from "../db/client";
import * as schema from "./schema";

const DEFAULT_API_KEY_PREFIX = "mym_";
const DEFAULT_OWNER_USER_ID = "personal";
const DEFAULT_OWNER_EMAIL = "personal@example.local";
const DEFAULT_OWNER_NAME = "Personal API Owner";

export type BetterAuthBindings = DatabaseBindings & {
  API_KEY_OWNER_EMAIL?: string;
  API_KEY_OWNER_NAME?: string;
  API_KEY_OWNER_USER_ID?: string;
  APP_URL?: string;
  BETTER_AUTH_SECRET?: string;
};

export type ApiKeyOwnerInput = {
  email?: string;
  name?: string;
  userId?: string;
};

export type ApiKeyPermissions = Record<string, string[]>;

export function apiKeyOwnerFromEnv(env: BetterAuthBindings): Required<ApiKeyOwnerInput> {
  return {
    email: env.API_KEY_OWNER_EMAIL ?? DEFAULT_OWNER_EMAIL,
    name: env.API_KEY_OWNER_NAME ?? DEFAULT_OWNER_NAME,
    userId: env.API_KEY_OWNER_USER_ID ?? DEFAULT_OWNER_USER_ID,
  };
}

export function createAuth(env: BetterAuthBindings | undefined) {
  if (!env?.BETTER_AUTH_SECRET) {
    throw new ConfigurationError("API key access is not configured.");
  }

  return betterAuth({
    baseURL: env.APP_URL ?? "http://localhost",
    database: drizzleAdapter(createDatabase(env), {
      provider: "sqlite",
      schema,
    }),
    plugins: [
      apiKey({
        defaultPrefix: DEFAULT_API_KEY_PREFIX,
        enableMetadata: true,
        keyExpiration: {
          defaultExpiresIn: null,
          maxExpiresIn: 3650,
        },
        rateLimit: {
          enabled: false,
        },
        permissions: {
          defaultPermissions: {
            measurements: ["read"],
            withings: ["read"],
          },
        },
        references: "user",
        requireName: true,
      }),
    ],
    secret: env.BETTER_AUTH_SECRET,
  });
}

export async function verifyApiKey(
  env: BetterAuthBindings | undefined,
  key: string,
  permissions?: ApiKeyPermissions,
) {
  return createAuth(env).api.verifyApiKey({
    body: { key, permissions },
  });
}

export async function ensureApiKeyOwner(
  env: BetterAuthBindings | undefined,
  input: ApiKeyOwnerInput,
) {
  const owner = {
    email: input.email ?? DEFAULT_OWNER_EMAIL,
    name: input.name ?? DEFAULT_OWNER_NAME,
    userId: input.userId ?? DEFAULT_OWNER_USER_ID,
  };
  const now = new Date();
  const db = createDatabase(env);
  const existingRows = await db
    .select({
      email: schema.user.email,
      id: schema.user.id,
    })
    .from(schema.user)
    .where(eq(schema.user.id, owner.userId))
    .limit(1);
  const existing = existingRows[0];

  if (existing) {
    if (existing.email !== owner.email) {
      throw new Error(
        `API key owner ${owner.userId} already exists with a different email address.`,
      );
    }
    return owner;
  }

  await db
    .insert(schema.user)
    .values({
      createdAt: now,
      email: owner.email,
      emailVerified: true,
      id: owner.userId,
      name: owner.name,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: schema.user.id });

  return owner;
}

export async function revokeApiKey(
  env: BetterAuthBindings | undefined,
  keyId: string,
  ownerUserId: string,
) {
  return createAuth(env).api.updateApiKey({
    body: { enabled: false, keyId, userId: ownerUserId },
  });
}

export function listApiKeys(env: BetterAuthBindings | undefined, ownerUserId: string) {
  return createDatabase(env)
    .select({
      createdAt: schema.apikey.createdAt,
      enabled: schema.apikey.enabled,
      expiresAt: schema.apikey.expiresAt,
      id: schema.apikey.id,
      lastRequest: schema.apikey.lastRequest,
      name: schema.apikey.name,
      prefix: schema.apikey.prefix,
      start: schema.apikey.start,
    })
    .from(schema.apikey)
    .where(eq(schema.apikey.referenceId, ownerUserId));
}
