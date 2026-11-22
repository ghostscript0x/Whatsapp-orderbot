# Deploying OrderBot

Three moving parts must run all the time: the **Next.js app** (dashboard + API + webhook receiver), the
**worker** (BullMQ: runs the AI agent, sends WhatsApp messages, notifications, maintenance) and the **OpenWA
gateway** (holds each tenant's WhatsApp session). They share **Postgres** and **Redis**. Product images live in
S3-compatible storage with public read (OpenWA fetches them by URL).

Two supported layouts:

| | A. Single VPS (recommended for MVP) | B. Vercel + VPS |
|---|---|---|
| App | Docker on VPS behind Caddy | Vercel |
| Worker, OpenWA, Redis | VPS | VPS |
| Postgres | VPS container (or managed) | Managed (Neon/Supabase/RDS) reachable from both |
| Cost / ops | One box, one bill | Two platforms, Redis + DB must be reachable from Vercel over the internet |

Storage in both: **Cloudflare R2** (S3 API, no egress fees, public bucket via `r2.dev` or a custom domain).

---

## A. Single VPS with Docker Compose + Caddy

Sizing: 2 vCPU / 4 GB RAM handles the PRD target (100 tenants, 10k msgs/day) if OpenWA uses the Baileys
engine; whatsapp-web.js runs a Chromium per session, so budget roughly 150–250 MB RAM per connected tenant.

### 1. Server

1. Ubuntu 24.04 LTS, non-root sudo user, SSH keys only, `ufw allow 22,80,443/tcp` and `ufw allow 443/udp`, then `ufw enable`.
2. Install Docker Engine + Compose plugin from Docker's apt repo.
3. DNS: an `A` (and `AAAA` if you have IPv6) record for your domain, e.g. `orders.example.com`, pointing at the server.

### 2. Configuration

```bash
git clone <your repo> orderbot && cd orderbot
cp .env.example .env.production
chmod 600 .env.production
```

Fill in `.env.production`:

| Var | Value |
|---|---|
| `APP_DOMAIN` | `orders.example.com` (used by Caddy) |
| `APP_URL` | `https://orders.example.com` (OpenWA webhooks and links in emails) |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` (hex so it is URL-safe inside `DATABASE_URL`) |
| `AUTH_SECRET`, `ENCRYPTION_KEY` | `openssl rand -base64 32` each. **Back up `ENCRYPTION_KEY`**: losing it makes stored webhook secrets unreadable. |
| `OPENWA_BASE_URL`, `OPENWA_API_KEY` | Your gateway (see section 4) |
| `GROQ_API_KEY` (or other provider) | LLM key |
| `S3_*` | R2 values (section 5) |
| `SMTP_URL`, `EMAIL_FROM` | Transactional email (password reset, invites, disconnect alerts) |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Optional error tracking. The public one is baked into the browser bundle at build time. |

`DATABASE_URL` and `REDIS_URL` are set by `docker-compose.prod.yml` from the internal service names.

### 3. Start

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml logs -f migrate app worker
curl -s https://orders.example.com/api/health
```

Order of start-up: `postgres` and `redis` become healthy → `migrate` runs `prisma migrate deploy` and exits 0 →
`app` and `worker` start → `caddy` gets a Let's Encrypt certificate on first request.

Make yourself platform admin after signing up:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U app -d orderbot -c "UPDATE \"User\" SET \"isPlatformAdmin\" = true WHERE email = 'you@example.com';"
```

### 4. OpenWA

Run it on the same box (uncomment the `openwa` service in `docker-compose.prod.yml`, set
`OPENWA_BASE_URL=http://openwa:2785`) or on its own VPS. Either way:

- Never expose its port publicly; if it is on another host, put it behind a firewall rule allowing only the app
  and worker hosts, or a private network (WireGuard/Tailscale).
- Its data volume holds every tenant's WhatsApp login. Back it up; losing it means every business re-scans.
- Create an **unscoped OPERATOR** API key in OpenWA and put it in `OPENWA_API_KEY`.
- `APP_URL` must be public HTTPS: OpenWA rejects localhost webhook URLs.

See `docs/OPENWA.md` for the API details.

### 5. Storage: Cloudflare R2

1. Create a bucket, e.g. `orderbot-products`.
2. Enable public access (Settings → Public access → `r2.dev` subdomain, or connect a custom domain such as `img.example.com`).
3. Create an R2 API token with *Object Read & Write* on that bucket only.
4. Set:
   ```
   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_BUCKET=orderbot-products
   S3_ACCESS_KEY=<token access key id>
   S3_SECRET_KEY=<token secret>
   S3_PUBLIC_URL=https://img.example.com        # or https://pub-xxxx.r2.dev
   ```
5. Add a CORS rule on the bucket allowing `PUT` from `APP_URL` (browsers upload directly with presigned URLs). With Garage, run `ENV_FILE=.env.production ./scripts/configure-garage-cors.sh`; the rule must include `content-type` and `content-length` (both are signed) or the browser's `OPTIONS` preflight is rejected with `403 This CORS request is not allowed`.

### 6. Deploying a new version

```bash
git pull
IMAGE_TAG=$(git rev-parse --short HEAD) docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

`migrate` runs again before the new app/worker start. Keep migrations backward compatible (add columns first,
drop later) so the old containers keep working during the switch.

**Rollback:** check out the previous commit and run the same command with its tag. If the bad release ran a
migration, restore from backup or write a forward fix; Prisma has no automatic down migrations.

### 7. Backups (do not skip)

Nightly Postgres dump, copied off the server (e.g. to a private R2 bucket), keep 14 days:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U app -Fc orderbot > backup-$(date +%F).dump
```

Test a restore into a scratch database at least once:
`pg_restore -U app -d orderbot_restore_test --clean backup-YYYY-MM-DD.dump`.
Also back up `.env.production` (in a password manager) and the OpenWA data volume.

### 8. Monitoring

- Point an external uptime checker (UptimeRobot, Better Stack, Cloudflare Health Checks) at
  `https://<domain>/api/health`. It returns **200** when the database, Redis and OpenWA all respond within 2 s
  and the worker heartbeat is fresh (`checks.worker`, written every 15 s), and **503** with per-check
  `ok/latencyMs/error` otherwise. `system.lastHeartbeatAt` shows when the worker last checked in.
  It never includes secrets or hostnames.
- Sentry receives server, edge and browser errors when `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are set.
- Logs are JSON (pino) on stdout: `docker compose -f docker-compose.prod.yml logs -f --since 1h worker`.
  Configure Docker log rotation (`/etc/docker/daemon.json`: `"log-driver": "local"`).

---

## B. Vercel (app) + VPS (worker, OpenWA, Redis)

1. **Database:** managed Postgres (Neon, Supabase, RDS). Use the pooled URL for the app on Vercel and the
   direct URL for migrations. Run `npx prisma migrate deploy` from CI or your machine on each release.
2. **Redis:** must be reachable from Vercel. Either a managed Redis with TLS (`rediss://...`, e.g. Upstash
   *Redis protocol*, not its REST API; BullMQ needs `noeviction`), or Redis on the VPS with TLS + password and a
   firewall. Never expose an unauthenticated Redis to the internet.
3. **Vercel project:** import the repo, set every env var from `.env.example` (plus `SENTRY_DSN`,
   `NEXT_PUBLIC_SENTRY_DSN`). `APP_URL` = your Vercel production domain.
4. **VPS:** run `worker` (from `Dockerfile.worker`) and OpenWA with the same `DATABASE_URL`, `REDIS_URL`,
   `ENCRYPTION_KEY`, `OPENWA_*`, LLM and S3 vars. The compose file's `app`, `caddy`, `postgres` and `redis`
   services are not needed there: `docker compose -f docker-compose.prod.yml up -d --build worker` after
   pointing the env at the managed services (or trim the file).
5. OpenWA must be reachable from Vercel (the app calls it to connect sessions and send staff replies), so it
   needs a public HTTPS endpoint with its API key; restrict by key and put it behind Caddy.

Trade-off: Vercel functions have execution limits and cold starts. The webhook route only enqueues (fast), so
this is fine, but all long work must stay in the worker.

---

## Local development with a public URL (Cloudflare Tunnel)

OpenWA refuses `localhost` webhook URLs, so expose your dev server:

```bash
# Quick, throwaway URL (changes every run):
cloudflared tunnel --url http://localhost:3000
# → https://<random>.trycloudflare.com
```

Set `APP_URL=https://<random>.trycloudflare.com` in `.env`, restart `npm run dev`, and reconnect WhatsApp so
OpenWA gets the new webhook URL. For a stable hostname, create a named tunnel
(`cloudflared tunnel create orderbot`, route a DNS name to it) and keep that URL in `.env`.

## Local S3 storage

The MinIO images on Docker Hub (`minio/minio`) are no longer published, so pick one of:

- **Cloudflare R2 dev bucket** (simplest, same as production; free tier covers dev use).
- **SeaweedFS** S3 gateway in Docker, e.g. `chrislusf/seaweedfs` with `server -s3` on port 8333; create the
  bucket once, allow anonymous read, and set `S3_ENDPOINT=http://localhost:8333`,
  `S3_PUBLIC_URL=http://localhost:8333/products`.

Note that OpenWA must be able to fetch product image URLs, so a localhost storage URL only works when OpenWA
runs on the same machine/network.
