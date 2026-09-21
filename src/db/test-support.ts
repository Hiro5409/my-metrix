import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/d1";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../drizzle/20260921111024_baseline/migration.sql",
);
const databaseBindings = Object.fromEntries(
  Array.from({ length: 64 }, (_, index) => [`DB_${index}`, `my-metrix-test-${index}`]),
);

let activeDatabases = 0;
let nextDatabase = 0;
let disposalTimer: ReturnType<typeof setTimeout> | undefined;
let sharedMiniflare: Miniflare | undefined;

function getMiniflare() {
  if (disposalTimer) clearTimeout(disposalTimer);
  if (!sharedMiniflare) {
    sharedMiniflare = new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            name: "test",
            modules: true,
            script: "export default { fetch() { return new Response(); } }",
            d1Databases: databaseBindings,
          },
        ],
      }),
    );
    nextDatabase = 0;
  }
  return sharedMiniflare;
}

async function discardMiniflare(miniflare: Miniflare) {
  if (sharedMiniflare !== miniflare) return;
  sharedMiniflare = undefined;
  nextDatabase = 0;
  await miniflare.dispose().catch(() => undefined);
}

function releaseMiniflare() {
  activeDatabases--;
  if (activeDatabases !== 0) return;
  disposalTimer = setTimeout(() => {
    const miniflare = sharedMiniflare;
    if (!miniflare || activeDatabases !== 0) return;
    sharedMiniflare = undefined;
    nextDatabase = 0;
    void miniflare.dispose();
  }, 250);
}

export async function createTestDatabase() {
  const statements = (await readFile(migrationPath, "utf8"))
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const miniflare = getMiniflare();
    const binding = `DB_${nextDatabase++}`;

    try {
      const client = await miniflare.getD1Database(binding, "test");
      await client.batch(statements.map((statement) => client.prepare(statement)));
      activeDatabases++;
      let released = false;
      return {
        client,
        db: drizzle(client),
        async cleanup() {
          if (released) return;
          released = true;
          releaseMiniflare();
        },
      };
    } catch (error) {
      await discardMiniflare(miniflare);
      if (attempt === 3) throw error;
    }
  }

  throw new Error("D1 test runtime did not start.");
}
