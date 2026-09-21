import { hc, parseResponse } from "hono/client";
import { parseArgs } from "node:util";
import type { AppType } from "../src/index";

type Environment = Record<string, string | undefined>;

function required(env: Environment, name: string) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function client(env: Environment, credential: string) {
  return hc<AppType>(required(env, "MY_METRIX_URL"), {
    headers: { Authorization: `Bearer ${credential}` },
  });
}

function print(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runCli(args: string[], env: Environment) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "expires-in-days": { type: "string" },
      id: { type: "string" },
      limit: { type: "string" },
      name: { type: "string" },
    },
  });
  const [resource, command] = positionals;

  if (resource === "keys") {
    const api = client(env, required(env, "MY_METRIX_ADMIN_TOKEN"));
    if (command === "create") {
      if (!values.name) throw new Error("--name is required.");
      const expiresInDays =
        values["expires-in-days"] === undefined ? undefined : Number(values["expires-in-days"]);
      print(
        await parseResponse(
          api.api.admin.keys.$post({
            json: { name: values.name, ...(expiresInDays === undefined ? {} : { expiresInDays }) },
          }),
        ),
      );
      return;
    }
    if (command === "list") {
      print(await parseResponse(api.api.admin.keys.$get()));
      return;
    }
    if (command === "revoke") {
      if (!values.id) throw new Error("--id is required.");
      print(await parseResponse(api.api.admin.keys[":id"].$delete({ param: { id: values.id } })));
      return;
    }
  }

  if (resource === "withings" && command === "connect") {
    const api = client(env, required(env, "MY_METRIX_ADMIN_TOKEN"));
    const started = await parseResponse(api.api.admin.withings.authorization.$post());
    console.log(`Open this URL to connect Withings:\n${started.authorizationUrl}`);
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      await sleep(1_000);
      const result = await parseResponse(
        api.api.admin.withings.authorization.status.$post({
          json: { state: started.state },
        }),
      );
      if (result.status === "succeeded") {
        print({ connected: true });
        return;
      }
      if (
        result.status === "failed" ||
        result.status === "expired" ||
        result.status === "unknown"
      ) {
        throw new Error(`Withings authorization ${String(result.status)}.`);
      }
    }
    throw new Error("Withings authorization timed out.");
  }

  if (resource === "withings" && command === "subscribe") {
    const api = client(env, required(env, "MY_METRIX_ADMIN_TOKEN"));
    print(await parseResponse(api.api.admin.withings.subscription.$post()));
    return;
  }

  const api = client(env, required(env, "MY_METRIX_API_KEY"));
  if (resource === "withings" && command === "status") {
    print(await parseResponse(api.api.withings.status.$get()));
    return;
  }
  if (resource === "measurements" && command === "latest") {
    print(await parseResponse(api.api.measurements.latest.$get()));
    return;
  }
  if (resource === "measurements" && command === "recent") {
    print(
      await parseResponse(
        api.api.measurements.recent.$get({
          query: { limit: values.limit ?? "7" },
        }),
      ),
    );
    return;
  }
  if (resource === "measurements" && command === "trend") {
    print(await parseResponse(api.api.measurements.trend.$get()));
    return;
  }

  throw new Error(
    "Usage: cli.ts keys <create|list|revoke> | withings <connect|status|subscribe> | measurements <latest|recent|trend>",
  );
}

if (import.meta.main) await runCli(process.argv.slice(2), process.env);
