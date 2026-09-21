# MyMetrix

[日本語](README.ja.md)

Self-hosted, single-user backend for Withings body measurements and weight trends.
It runs on Cloudflare Workers and D1, with typed Hono RPC routes for its CLI and
other personal clients.

## Architecture

- Hono owns the HTTP boundary and RPC contract.
- Drizzle ORM 1.0 RC owns the D1 schema and migrations.
- Better Auth API keys protect measurement and Withings reads.
- A separate administrator token protects key and Withings connection management.
- Withings OAuth tokens are encrypted at rest.
- Withings notifications trigger idempotent measurement synchronization.

The CLI talks only to the deployed HTTP API. It never needs database credentials.

## Requirements

- Bun 1.4.2
- A Cloudflare account authenticated with Wrangler
- A Cloudflare D1 database
- A Withings developer application

Register this callback URL in the Withings application, using the deployed Worker
origin:

```text
https://<worker-origin>/oauth/withings/callback
```

## Setup

Install dependencies and create ignored local and production secret files:

```bash
bun install --frozen-lockfile
cp .dev.vars.example .dev.vars
cp .dev.vars.example .prod.vars
cp .setup.env.example .setup.env
```

When deploying a fork, set `account_id` in `wrangler.jsonc` to the target Cloudflare
account, create the D1 database, then replace `database_id` with the returned ID:

```bash
bunx wrangler d1 create my-metrix
```

Generate separate local and production values for the authentication, encryption,
and webhook secrets in `.dev.vars` and `.prod.vars`:

```bash
openssl rand -hex 32 # ADMIN_TOKEN
openssl rand -hex 32 # BETTER_AUTH_SECRET
openssl rand -base64 32 # TOKEN_ENCRYPTION_KEY
openssl rand -hex 32 # WEBHOOK_SECRET
```

Add the Withings client ID and secret to both files. Set the deployed Worker origin
as `APP_URL` in `wrangler.jsonc`.

Apply the local migration and start the Worker:

```bash
bun run db:migrate:local
bun run dev
```

For production, upload secrets, apply the remote migration, and deploy:

```bash
bunx wrangler secret bulk .prod.vars
bun run db:migrate:remote
bun run deploy
```

Set the deployed URL and administrator token in `.setup.env`, then connect Withings
through the hosted OAuth callback and register the measurement notification:

```bash
bun run cli -- withings connect
bun run cli -- withings subscribe
```

Create a client API key and add it to `.setup.env` as `MY_METRIX_API_KEY`:

```bash
bun run cli -- keys create --name my-client
```

The remaining CLI commands are `keys list`, `keys revoke --id <id>`,
`withings status`, and `measurements latest|recent|trend`.

## HTTP surface

- `GET /api/health` is public.
- `/api/admin/*` requires the administrator bearer token.
- `/api/measurements/*` and `/api/withings/*` require a Better Auth API key.
- `/api/measurements/latest` returns `latest: null` until a measurement notification
  has been synchronized after subscription.
- `/oauth/withings/callback` completes the short-lived hosted OAuth flow.
- `/webhooks/withings/:secret` accepts Withings notifications.

The webhook URL contains a credential. Never include it in documentation, issues,
request logs, or live-tail output.

## Development

Run the complete validation suite:

```bash
bun run check
```

Create schema changes with `bun run db:generate`. Apply generated migrations with
Wrangler; do not edit a migration after it has been applied.

## Operations

- Export or otherwise back up production data before a migration. Investigate
  rejected rows instead of deleting them to satisfy a new constraint.
- Apply migrations before deploying code that depends on them. Wrangler captures a
  D1 backup when it applies a remote migration.
- Withings refresh tokens rotate. A D1 lease serializes persisted refresh results;
  it cannot cancel an already-sent provider request or promise exactly-once work.
- Keep body data, `.dev.vars`, `.setup.env`, API keys, OAuth tokens, and webhook URLs
  out of commits and public reports.

## License

[MIT](LICENSE)
