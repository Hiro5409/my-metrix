import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/d1";
import type { AppDatabase } from "../db/client";
import { createTestDatabase } from "../db/test-support";
import { encryptTokenJson } from "./encryption";
import { TEST_TOKEN_ENCRYPTION_KEY } from "./test-support";
import { WithingsTokenStore } from "./token-store";

function createStore(db: AppDatabase) {
  return new WithingsTokenStore(db, TEST_TOKEN_ENCRYPTION_KEY);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seedTokenJson(testDb: Awaited<ReturnType<typeof createTestDatabase>>, json: string) {
  const encrypted = await encryptTokenJson(json, TEST_TOKEN_ENCRYPTION_KEY);
  await testDb.client
    .prepare(
      "insert into withings_connection (id, token_json, expires_at, updated_at) values (?, ?, ?, ?)",
    )
    .bind(1, encrypted, 1, 1)
    .run();
}

test("WithingsTokenStore saves and loads token sets", async () => {
  const testDb = await createTestDatabase();
  const store = createStore(testDb.db);

  try {
    await store.save({
      accessToken: "access",
      clientId: "client",
      clientSecret: "secret",
      expiresAt: 1,
      refreshToken: "refresh",
    });

    expect(await store.load()).toEqual({
      accessToken: "access",
      clientId: "client",
      clientSecret: "secret",
      expiresAt: 1,
      refreshToken: "refresh",
    });

    const row = await testDb.client
      .prepare("select token_json from withings_connection limit 1")
      .first<{ token_json: string }>();
    expect(row?.token_json.startsWith("enc:v1:")).toBe(true);
    expect(row?.token_json).not.toContain("refresh");
  } finally {
    await testDb.cleanup();
  }
});

test("WithingsTokenStore preserves optional token metadata and drops unknown stored fields", async () => {
  const testDb = await createTestDatabase();
  const store = createStore(testDb.db);
  const token = {
    accessToken: "access",
    clientId: "client",
    clientSecret: "secret",
    expiresAt: 1,
    refreshToken: "refresh",
    userid: 123,
    scope: "user.metrics",
    tokenType: "Bearer",
    csrfToken: "csrf",
  };

  try {
    await seedTokenJson(
      testDb,
      JSON.stringify({ ...token, unrelated: "ignored", userid: String(token.userid) }),
    );
    expect(await store.load()).toEqual(token);
  } finally {
    await testDb.cleanup();
  }
});

test.each([
  ["malformed JSON", "not-json"],
  ["missing credentials", "{}"],
  [
    "an invalid optional field",
    '{"clientId":"client","clientSecret":"secret","accessToken":"access","refreshToken":"refresh","expiresAt":1,"scope":42}',
  ],
  [
    "a non-finite expiration",
    '{"clientId":"client","clientSecret":"secret","accessToken":"access","refreshToken":"refresh","expiresAt":1e400}',
  ],
])("WithingsTokenStore treats %s as an unavailable token", async (_name, json) => {
  const testDb = await createTestDatabase();
  const store = createStore(testDb.db);

  try {
    await seedTokenJson(testDb, json);

    await expect(store.load()).resolves.toBeUndefined();
  } finally {
    await testDb.cleanup();
  }
});

test("WithingsTokenStore keeps slow refresh work serialized across separate store instances", async () => {
  const testDb = await createTestDatabase();
  const firstStore = createStore(testDb.db);
  const secondStore = createStore(drizzle(testDb.client));
  const entered: string[] = [];
  const firstEntered = Promise.withResolvers<void>();
  const releaseFirst = Promise.withResolvers<void>();
  let first: Promise<string> | undefined;
  let second: Promise<string> | undefined;

  try {
    first = firstStore.withRefreshLock(async () => {
      entered.push("first");
      firstEntered.resolve();
      await releaseFirst.promise;
      return "first";
    });

    await firstEntered.promise;
    await sleep(11_000);

    second = secondStore.withRefreshLock(async () => {
      entered.push("second");
      return "second";
    });

    await sleep(75);
    expect(entered).toEqual(["first"]);

    releaseFirst.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(entered).toEqual(["first", "second"]);
  } finally {
    releaseFirst.resolve();
    await Promise.allSettled([first, second]);
    await testDb.cleanup();
  }
}, 20_000);

test.each(["another connection", "the same store"])(
  "WithingsTokenStore rejects stale refresh saves after %s reclaims the lease",
  async (contender) => {
    const testDb = await createTestDatabase();
    const firstStore = createStore(testDb.db);
    const secondStore =
      contender === "the same store" ? firstStore : createStore(drizzle(testDb.client));
    const firstEntered = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    const token = {
      clientId: "client",
      clientSecret: "secret",
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: 1,
    };
    let first: Promise<void> | undefined;

    try {
      await firstStore.save(token);
      first = firstStore.withRefreshLock(async () => {
        firstEntered.resolve();
        await releaseFirst.promise;
        await firstStore.save({ ...token, accessToken: "stale", refreshToken: "stale" });
      });
      const firstOutcome = first.then(
        () => "saved",
        () => "rejected",
      );
      await firstEntered.promise;

      await testDb.client.prepare("update withings_refresh_lease set expires_at = 0").run();
      await secondStore.withRefreshLock(async () => {
        await secondStore.save({ ...token, accessToken: "fresh", refreshToken: "fresh" });
      });

      releaseFirst.resolve();
      expect(await firstOutcome).toBe("rejected");
      expect((await secondStore.load())?.refreshToken).toBe("fresh");
    } finally {
      releaseFirst.resolve();
      await Promise.allSettled([first]);
      await testDb.cleanup();
    }
  },
);

test("WithingsTokenStore keeps a new authorization grant over an in-flight refresh", async () => {
  const testDb = await createTestDatabase();
  const refreshStore = createStore(testDb.db);
  const authorizationStore = createStore(drizzle(testDb.client));
  const refreshEntered = Promise.withResolvers<void>();
  const releaseRefresh = Promise.withResolvers<void>();
  const token = {
    accessToken: "access",
    clientId: "client",
    clientSecret: "secret",
    expiresAt: 1,
    refreshToken: "refresh",
  };
  let refresh: Promise<void> | undefined;

  try {
    await refreshStore.save(token);
    refresh = refreshStore.withRefreshLock(async () => {
      refreshEntered.resolve();
      await releaseRefresh.promise;
      await refreshStore.save({ ...token, accessToken: "stale", refreshToken: "stale" });
    });
    await refreshEntered.promise;

    await authorizationStore.save({
      ...token,
      accessToken: "authorized",
      refreshToken: "authorized",
    });
    releaseRefresh.resolve();

    await expect(refresh).rejects.toThrow("lease was lost");
    expect((await authorizationStore.load())?.refreshToken).toBe("authorized");
  } finally {
    releaseRefresh.resolve();
    await Promise.allSettled([refresh]);
    await testDb.cleanup();
  }
});

test("WithingsTokenStore rejects a refresh result when its lease has expired", async () => {
  const testDb = await createTestDatabase();
  const store = createStore(testDb.db);

  try {
    await expect(
      store.withRefreshLock(async () => {
        await testDb.client.prepare("update withings_refresh_lease set expires_at = 0").run();
        return "stale result";
      }),
    ).rejects.toThrow("lease was lost");
  } finally {
    await testDb.cleanup();
  }
});

test("WithingsTokenStore releases the lease when refresh work fails", async () => {
  const testDb = await createTestDatabase();
  const store = createStore(testDb.db);
  const failure = new Error("Refresh failed.");

  try {
    await expect(
      store.withRefreshLock(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    await expect(store.withRefreshLock(async () => "retried")).resolves.toBe("retried");
  } finally {
    await testDb.cleanup();
  }
});
