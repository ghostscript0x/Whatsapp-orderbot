# OrderBot

A multi-tenant SaaS that gives small businesses an AI sales assistant on their own WhatsApp number.
A business signs up, scans a QR code to connect WhatsApp, adds products with photos, and the bot answers
customers, shows products, takes orders and saves them to a dashboard. The owner gets an alert for every new
order and updates its status; the customer is notified automatically.

Product spec: [`docs/PRD.md`](docs/PRD.md) · Deploying: [`docs/DEPLOY.md`](docs/DEPLOY.md) · OpenWA notes: [`docs/OPENWA.md`](docs/OPENWA.md)

## Architecture

```
Customer ──WhatsApp──► OpenWA gateway ──signed webhook──► Next.js app  /api/webhooks/openwa
                           ▲                               │  verify HMAC, dedupe, enqueue (fast 200)
                           │                               ▼
                           │                            Redis (BullMQ queues, locks, rate limits, cache)
                           │                               │
                           └──── send text / images ──── Worker (AI agent + tools, notifications, maintenance)
                                                           │
Owner/staff ──browser──► Next.js dashboard + API ──────► SQLite now, Postgres later (Prisma; every tenant row has tenantId)
                                                  └────► S3-compatible storage (product images, public read)
```

- **Next.js 15 App Router** (`app/`): dashboard pages, JSON API routes, webhook receiver. Route handlers never run long AI jobs.
- **Worker** (`worker/`): separate Node process consuming BullMQ queues: inbound messages (AI agent), session events, notifications, plus a maintenance loop.
- **Tenancy**: `forTenant(tenantId)` (in `lib/tenant.ts`) is a Prisma extension that forces `tenantId` into every query. The active tenant comes from the session + `active_tenant` cookie, never from request bodies.
- **LLM**: provider interface in `lib/llm/` (Groq default; Anthropic/OpenAI pluggable via `LLM_PROVIDER`).
- **Observability**: pino JSON logs, Sentry (when `SENTRY_DSN` is set), `GET /api/health` (database, Redis, OpenWA, worker heartbeat).

## Run locally

Prerequisites: Node 22, Redis (Docker is easiest), an OpenWA gateway, an LLM API key, and S3-compatible storage
for product images. The database is **SQLite** (`prisma/dev.db`), so there is no database server to run.

1. **Install and configure**
   ```bash
   npm install
   cp .env.example .env
   ```
   Fill in `.env`: generate `AUTH_SECRET` and `ENCRYPTION_KEY` with `openssl rand -base64 32`, add `GROQ_API_KEY`,
   `OPENWA_BASE_URL` / `OPENWA_API_KEY`, and the `S3_*` values. `DATABASE_URL=file:./dev.db` is already set.

2. **Start Redis** (and, if you want local image storage, the S3 server)
   ```bash
   docker compose up -d redis s3
   ```
   The `postgres` service in `docker-compose.yml` is not needed while the app runs on SQLite.

3. **Public URL for webhooks.** OpenWA rejects `localhost`, so run a tunnel and put its **https** URL in `APP_URL`:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

4. **Database**
   ```bash
   npm run db:deploy     # creates prisma/dev.db and applies migrations
   npm run db:seed       # demo business "Mama's Kitchen", owner demo@example.com (password: SEED_PASSWORD or the seed default)
   ```

5. **Run the app and the worker together**
   ```bash
   npm run dev:all
   ```
   This starts `next dev` and the worker (`tsx watch worker/index.ts`) with `[web]` / `[worker]` prefixed output.
   Ctrl+C stops both; if one crashes the other is stopped too. Prefer two terminals? `npm run dev` and `npm run worker:dev`.

   **The worker is required for the bot.** The web app only receives WhatsApp webhooks and queues them; the worker
   runs the AI agent, sends replies and order notifications. Without it, messages pile up in Redis unanswered and
   the dashboard home shows a "bot worker isn't running" banner.

   Open http://localhost:3000, sign in, then follow the setup checklist on the dashboard home.

6. **Make yourself platform admin** (for `/admin`: all tenants, suspend/unsuspend):
   ```bash
   echo "UPDATE \"User\" SET \"isPlatformAdmin\" = true WHERE email = 'you@example.com';"      | npx prisma db execute --schema prisma/schema.prisma --stdin
   ```

Check everything is wired up: `curl http://localhost:3000/api/health` returns 200 when the database, Redis and
OpenWA respond **and** the worker heartbeat is fresh; otherwise 503 with the failing check named.

## Troubleshooting

**The bot doesn't reply on WhatsApp**
1. *Is the worker running?* Look for `[worker] ... worker started` in the `dev:all` output, or check
   `curl -s localhost:3000/api/health` → `checks.worker.ok`. The worker writes a heartbeat every 15 s; the
   dashboard flags it as offline about 45 s after it stops.
2. *Is `APP_URL` a public https tunnel?* OpenWA can only deliver webhooks to https. After changing `APP_URL`
   (tunnel URLs change on restart), restart the app and click **Connect** on the WhatsApp page again so the new
   webhook URL is registered.
3. *Is Redis reachable?* `checks.redis` in `/api/health`. Both the app (queueing) and the worker (consuming)
   need the same `REDIS_URL`.
4. *Is the chat paused?* A conversation flagged "needs a human" pauses the bot for that chat until staff resume
   it (or 12 h pass without a staff reply). Check the Conversations page.
5. Worker logs show `job failed` with the reason (LLM key, OpenWA errors, ...).

**Customers don't get order updates / owner gets no alerts:** WhatsApp must be connected (notifications are
skipped, with a log line, when it isn't), and owner alerts go to the "owner alert phone" in Settings.

**Emails (invites, password reset) never arrive:** without `SMTP_URL` they are written to the log instead,
links included.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev:all` | Next.js dev server + worker in one terminal (prefixed output) |
| `npm run dev` / `npm run build` / `npm start` | Next.js only |
| `npm run worker:dev` / `npm run worker` | Worker only (watch mode / once) |
| `npm run db:migrate` | Create + apply a migration in development |
| `npm run db:deploy` | Apply pending migrations |
| `npm run db:seed` | Seed demo data |
| `npm run typecheck` | `tsc --noEmit` |
| `npx vitest run --config vitest.unit.config.ts` | Pure unit tests (no DB, no Redis) |
| `npx vitest run tests/integration` | Integration tests against the SQLite test DB (`TEST_DATABASE_URL`, migrated automatically; Redis and WhatsApp are mocked) |

## Project layout

```
app/            pages (dashboard, admin, auth) and API routes (app/api/**)
components/     UI, one folder per area; shared primitives in components/ui
lib/            server modules: api helpers, tenancy, openwa client, orders, products, agent, llm, redis, queues
worker/         BullMQ worker entry point and job processors
prisma/         schema, migrations, seed
tests/          unit/ (pure) and integration/ (real DB)
docs/           PRD, build contracts, OpenWA notes, deploy guide
```
