# Phase 2: Fixed Accounts And Tracking

## Scope

This is a personal/small-group research tool. It uses a small, fixed set of username-password accounts. No Google account, OAuth client, or frontend credential is needed.

The primary product is the public stock screener. Login is optional and only unlocks per-user watchlist persistence.

Each account has an independent watchlist. The Worker verifies password hashes and issues a seven-day HTTP-only session cookie. Recommendation snapshots remain shared, immutable records with a fixed reference close.

## Cloudflare Setup

1. Create a D1 database named `quant-core`.
2. Replace `database_id = "replace-at-deploy"` in `worker/wrangler.toml` with its database ID.
3. Apply migrations:

```powershell
pnpm --filter @a-share/worker exec wrangler login
pnpm --filter @a-share/worker exec wrangler d1 migrations apply quant-core --remote
```

4. Generate one record for every person who may log in. Run this locally once per account. The password is read from an environment variable and is never written to the repository.

```powershell
$env:AUTH_USERNAME = "owner"
$env:AUTH_DISPLAY_NAME = "Owner"
$env:AUTH_PASSWORD = Read-Host "Password"
node worker/scripts/create-fixed-account.mjs
Remove-Item Env:AUTH_PASSWORD
```

Copy each JSON line into a JSON array. For example:

```json
[
  {"username":"owner","displayName":"Owner","salt":"...","passwordHash":"...","iterations":100000},
  {"username":"member","displayName":"Member","salt":"...","passwordHash":"...","iterations":100000}
]
```

5. Store the account array and session signing secret in Worker secrets:

```powershell
pnpm --filter @a-share/worker exec wrangler secret put FIXED_ACCOUNTS
pnpm --filter @a-share/worker exec wrangler secret put SESSION_SECRET
pnpm --filter @a-share/worker exec wrangler secret put PUBLISH_SECRET
```

`SESSION_SECRET` and `PUBLISH_SECRET` must be unrelated random values. Generate one with:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

## GitHub Deployment

The workflow at `.github/workflows/deploy-worker.yml` deploys on a push to `main`. Add these repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

`FIXED_ACCOUNTS` and `SESSION_SECRET` are Cloudflare runtime secrets; do not add them to GitHub or `.env` files.

## Local Development

For local Worker development, create `.dev.vars` in `worker/` with test-only values:

```text
FIXED_ACCOUNTS=[{"username":"owner","displayName":"Owner","salt":"...","passwordHash":"...","iterations":100000}]
SESSION_SECRET=local-development-only-secret
```

`.dev.vars` is ignored by Git. Then run:

```powershell
pnpm install
pnpm build
pnpm --filter @a-share/worker exec wrangler d1 migrations apply quant-core --local
pnpm --filter @a-share/worker dev --local --port 8787
pnpm --filter @a-share/frontend dev --host 127.0.0.1 --port 5173
```

The Vite development server proxies `/api` to the local Worker.

## Screener Data Contract

Before a code can be added to a watchlist, the scheduled research pipeline must upsert it to `stock_latest` with a complete `trade_date` and `close`.

The online screener joins `stock_latest` to `stock_screen_latest`. The latter contains one current row per code for `market`, `industry`, `pct_change`, `turnover_rate`, `ret_5d`, `ret_20d`, `ret_60d`, `ma20_slope`, `volume_ratio_20`, and `volatility_20`. The publisher must replace these rows atomically for a completed data date; it must not publish partial rows as current.

The endpoint is `GET /api/screener`. It supports bounded code/name/market/industry filters, price and technical ranges, score minimums, pagination, and an allowlisted sort column. It returns `asOf` so the UI can show the data date.

Each published recommendation must append an immutable `recommendation_snapshots` row containing `reference_trade_date` and `reference_close`. Tracking always compares the current `stock_latest.close` against that fixed baseline; later data refreshes cannot change the recorded entry price.

## GitHub To Cloudflare Data Publish

The Python publisher at `pipeline/jobs/publish_screener.py` validates a generated JSON package and sends it to the protected Worker endpoint. Configure `PUBLISH_URL` and `PUBLISH_SECRET` only in the GitHub Actions environment:

```powershell
$env:PUBLISH_URL = "https://your-worker.workers.dev/api/internal/publish-screener"
$env:PUBLISH_SECRET = "the-cloudflare-publish-secret"
python -m pipeline.jobs.publish_screener --input reports/screener-publish.json
```

The Worker records each `runId` in `sync_runs`, applies rows in bounded D1 batches, and treats a completed `runId` as idempotent. A failed run is marked `failed` and can be retried with the same package after the underlying problem is fixed.
