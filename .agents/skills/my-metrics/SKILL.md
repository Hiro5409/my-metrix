---
name: my-metrics
description: Use in Hiro5409/my-metrix for Withings, D1, authentication, measurements, or body-composition work.
---

# MyMetrix

## Boundaries

- Keep the product single-user. Add account or tenant abstractions only for a real
  multi-user requirement.
- D1 owns runtime persistence. The CLI reaches production through Hono RPC and
  never receives direct database access or Withings OAuth credentials.
- Static server credentials and encryption keys belong in Cloudflare Worker
  secrets. Store body data, encrypted OAuth tokens, and API-key records in D1.
- Withings refresh tokens rotate. Serialize refresh work across requests.

## Security

- Protect API-key and Withings connection management with `ADMIN_TOKEN`. Protect
  measurement and Withings reads with scoped Better Auth API keys.
- Use synthetic measurements in tests and documentation. Keep real body data,
  `.dev.vars`, `.setup.env`, credentials, token rows, and OAuth callback query
  strings out of logs, commits, and public reports.
- Withings callbacks cannot supply custom auth headers, so their URLs contain
  `WEBHOOK_SECRET`. Treat these URLs as credentials, including in platform logs
  and live-tail output. Keep request logging allowlisted and invocation logs
  disabled. If exposed, rotate the secret and update the registered callback URL.

## Body-Composition Interpretation

Distinguish measured weight from noisy BIA estimates of fat, muscle, bone, and
hydration. Interpret same-condition trends and moving averages rather than drawing
health conclusions from one body-fat reading. Weight loss is not unconditionally
a positive outcome.
