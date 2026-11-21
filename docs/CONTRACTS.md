# Build contracts (for parallel agents)

Source of truth for product requirements: `docs/PRD.md`. This file fixes the **shared interfaces and file ownership**
so several agents can build at the same time without colliding. If you need a contract changed, do not change it
silently: implement against it as written and report the needed change in your final summary.

## Ground rules (all agents)

- **Write code only.** Do NOT run docker, start Postgres/Redis/MinIO/OpenWA, run `prisma migrate dev/deploy`, `db push`,
  seed, or any test that needs a live DB/Redis. The user sets up infrastructure later.
- Allowed checks: `npx tsc --noEmit`, `npx prisma validate`, `npx prisma generate`, and pure unit tests
  (`npx vitest run tests/unit/<file>`) that mock DB/Redis. Integration tests may be written under `tests/integration/`
  but not run.
- **Do not `npm install` anything** without strong need. Installed: next@15 (App Router), react 19, next-auth v5 beta,
  @prisma/client 6, bullmq 5, ioredis 5, zod 3, @node-rs/argon2, @aws-sdk/client-s3 + s3-request-presigner, groq-sdk,
  papaparse, nodemailer, pino, lucide-react, radix (slot, dialog, dropdown-menu, select, switch, label, tabs),
  class-variance-authority, clsx, tailwind-merge, tailwindcss 4, vitest 3, tsx, dotenv, @sentry/nextjs 9.
  If you truly need a package, report it instead of installing (parallel installs corrupt node_modules).
- **Only edit files you own** (below). Read anything. Never edit `prisma/schema.prisma` or the foundation files;
  report needed schema changes.
- Every API route: wrap with `route()` from `lib/api.ts`, validate input with Zod (`parseJson`/`parseQuery`),
  get tenant via `requireTenant()` (never tenantId from body/query), use `ctx.db` (tenant-scoped client).
  Errors: throw `errors.*` / `ApiError`. Response errors are `{ error: { code, message } }`.
- Nested creates are NOT auto-scoped by `forTenant` — pass `tenantId` explicitly on nested `create`s.
- Money is integer kobo. Format with `formatMoney` from `lib/money.ts`; parse user input with `parseToKobo`.
- Next 15: route `params` is a Promise: `async (req, { params }: { params: Promise<{ id: string }> })`.
- UI: Tailwind + components in `components/ui/` (`button.tsx`, `input.tsx` (Input, Textarea, NativeSelect),
  `misc.tsx` (Label, Switch, Badge), `card.tsx`). Mobile-first. Client fetching via `apiFetch` in `lib/fetcher.ts`.
  You may add new shared primitives only inside your own folder, or in `components/<your-area>/`.
- No TODO/FIXME, no fake data in real code paths, no swallowed errors.

## Foundation (already written, owned by lead; read-only for agents)

| File | Exports |
|---|---|
| `lib/env.ts` | `env()`, `requireEnv(key)` |
| `lib/prisma.ts` | `prisma` (RAW unscoped client: auth, webhook routing, admin only) |
| `lib/tenant.ts` | `forTenant(tenantId)`, types `TenantDb`, `TenantTx`, `TENANT_MODELS` |
| `lib/api.ts` | `route`, `ApiError`, `errors`, `jsonError`, `parseJson`, `parseQuery`, `requireTenant({role?})` → `{userId, tenantId, role, db}`, `requirePlatformAdmin()`, `ACTIVE_TENANT_COOKIE` |
| `lib/redis.ts` | `redis()`, `bullConnection()`, `setOnce(key, ttlS)`, `acquireLock(key, ttlMs)` → release fn or null, `rateLimit(key, limit, windowS)` |
| `lib/queues.ts` | `inboundQueue()`, `sessionQueue()`, `notifyQueue()`, job types `InboundMessageJob`, `SessionEventJob`, `NotifyJob`, queue name consts |
| `lib/crypto.ts` | `encrypt`, `decrypt` (AES-256-GCM), `randomToken`, `sha256`, `hmacSha256Hex`, `safeEqual` |
| `lib/money.ts` | `formatMoney(kobo, currency)`, `parseToKobo(str)` |
| `lib/password.ts` | `hashPassword`, `verifyPassword` (argon2) |
| `lib/email.ts` | `sendEmail(to, subject, text)` (logs if SMTP_URL unset) |
| `lib/logger.ts` | `logger` (pino) |
| `lib/utils.ts` | `cn`, `phoneFromChatId`, `chatIdFromPhone`, `slugify` |
| `lib/fetcher.ts` | `apiFetch(url, { method, json })` (client) |
| `auth.ts`, `auth.config.ts`, `middleware.ts` | Auth.js v5 credentials, JWT; `auth()`, `signIn`, `signOut`; session.user.id |
| `worker/index.ts` | imports the four worker modules below |
| `tests/helpers.ts`, `tests/global-setup.ts`, `tests/env-setup.ts` | `createTestTenant()`, `resetDb()` for integration tests |

Active tenant = cookie `active_tenant` (validated against Membership in `requireTenant`). Switching tenant = set that cookie.

## Cross-agent interfaces (implement EXACTLY these signatures)

### `lib/openwa.ts` — owner: **whatsapp** agent
```ts
export type OpenWaSessionState = { status: import("@prisma/client").WaStatus; qr: string | null; phone: string | null };
export const openwa: {
  createSession(sessionId: string, webhook: { url: string; secret: string }): Promise<void>; // idempotent
  getSessionState(sessionId: string): Promise<OpenWaSessionState>;
  requestPairingCode(sessionId: string, phone: string): Promise<string>;
  logout(sessionId: string): Promise<void>;
  sendText(sessionId: string, chatId: string, text: string): Promise<{ messageId: string }>;
  sendImage(sessionId: string, chatId: string, imageUrl: string, caption?: string): Promise<{ messageId: string }>;
};
/** Resolve the tenant's session (raw prisma by tenantId) and send. Throws WhatsAppNotConnectedError if none/not CONNECTED. */
export class WhatsAppNotConnectedError extends Error {}
export function sendTenantText(tenantId: string, chatId: string, text: string): Promise<{ messageId: string }>;
export function sendTenantImage(tenantId: string, chatId: string, imageUrl: string, caption?: string): Promise<{ messageId: string }>;
```
Session convention (verified against the real OpenWA API, see docs/OPENWA.md): session **name** is `t-<tenantId>`
(OpenWA names allow only letters, digits, hyphens); OpenWA assigns a UUID **session id**, stored in
`WhatsAppSession.openwaSessionId`. All `openwa.*` methods except `createSession(name, webhook): Promise<{ sessionId }>`
take that UUID, and `InboundMessageJob.sessionId` / `SessionEventJob.sessionId` carry it.

### `lib/products.ts` — owner: **products** agent
```ts
export type BotProduct = { id: string; name: string; priceKobo: number; description: string; category: string | null; coverImageUrl: string | null };
export function listAvailableProducts(db: TenantDb, opts?: { query?: string; category?: string; limit?: number }): Promise<BotProduct[]>; // available, not deleted
export function getAvailableProductsByIds(db: TenantDb, ids: string[]): Promise<BotProduct[]>;
```

### `lib/storage.ts` — owner: **products** agent
```ts
export function presignUpload(opts: { tenantId: string; contentType: string; size: number }): Promise<{ uploadUrl: string; storageKey: string; publicUrl: string }>;
export function deleteObject(storageKey: string): Promise<void>;
export function publicUrlFor(storageKey: string): string;
```

### `lib/conversations.ts` — owner: **orders** agent
```ts
export function upsertCustomerConversation(db: TenantDb, input: { chatId: string; phone: string; name?: string }): Promise<{ customer: Customer; conversation: Conversation }>; // bumps lastSeenAt
export function storeMessage(db: TenantDb, input: { conversationId: string; direction: MessageDirection; sender: MessageSender; type?: string; body: string; mediaUrl?: string; waMessageId?: string }): Promise<Message>; // bumps lastMessageAt, invalidates memory cache
export function getRecentMessages(db: TenantDb, tenantId: string, conversationId: string, limit?: number /*20*/): Promise<Message[]>; // oldest→newest, cached in Redis `mem:{tenantId}:{conversationId}`
export function flagNeedsHuman(db: TenantDb, tenantId: string, conversationId: string, reason: string): Promise<void>; // needsHuman=true, botPaused=true, botPausedAt=now, enqueue notify owner-needs-human
```

### `lib/orders.ts` — owner: **orders** agent
```ts
export class OrderValidationError extends Error {} // message is safe to show the model/customer
export type CreateOrderInput = { customerId: string; items: { productId: string; quantity: number }[]; customerName: string; deliveryAddress: string; notes?: string };
export function createOrder(tenantId: string, input: CreateOrderInput): Promise<Order & { items: OrderItem[] }>;
// transaction: validate products available+not deleted, qty 1..99, server-side prices, delivery fee from BotSettings,
// atomic Tenant.orderCounter increment → number `ORD-<n>`, OrderStatusEvent(null→NEW), then enqueue notify owner-new-order.
export function changeOrderStatus(tenantId: string, orderId: string, toStatus: OrderStatus, byUserId: string | null): Promise<Order>;
// validates allowed transitions, writes OrderStatusEvent, enqueues notify order-status.
export function getCustomerOrders(db: TenantDb, customerId: string, orderNumber?: string): Promise<(Order & { items: OrderItem[] })[]>; // recent 5
```

### `lib/business-hours.ts` — owner: **bot** agent
```ts
export function isOpenNow(businessHours: unknown, timezone: string, now?: Date): boolean;
```

### Worker modules (each returns a started BullMQ `Worker`)
| File | Export | Owner |
|---|---|---|
| `worker/inbound-message.ts` | `startInboundWorker(): Worker` | bot |
| `worker/session-events.ts` | `startSessionWorker(): Worker` | whatsapp |
| `worker/notifications.ts` | `startNotificationsWorker(): Worker` (handles every `NotifyJob` kind) | orders |
| `worker/maintenance.ts` | `startMaintenance(): () => void` (interval: auto-resume bot after 12h with no staff reply; returns stop fn) | orders |

## File ownership

| Agent | Owns |
|---|---|
| **auth** | `app/page.tsx` (landing), `app/(auth)/**` (login, signup, forgot-password, reset-password, invite/[token]), `app/api/tenants/**`, `app/api/password/**`, `app/api/team/**`, `app/dashboard/layout.tsx`, `components/shell/**` (nav, tenant switcher, sign-out), `app/dashboard/team/**`, `lib/tenants.ts`, `prisma/seed.ts`, `tests/integration/tenant-isolation.test.ts`, `tests/unit/tenant-scope.test.ts` |
| **products** | `lib/products.ts`, `lib/storage.ts`, `app/api/products/**`, `app/api/categories/**`, `app/api/uploads/**`, `app/dashboard/products/**`, `components/products/**`, `tests/unit/products*.test.ts` |
| **whatsapp** | `lib/openwa.ts`, `lib/webhook.ts`, `app/api/whatsapp/**`, `app/api/webhooks/openwa/**`, `worker/session-events.ts`, `app/dashboard/whatsapp/**`, `components/whatsapp/**`, `tests/unit/webhook*.test.ts`, `docs/OPENWA.md` |
| **bot** | `lib/llm/**`, `lib/agent/**`, `lib/business-hours.ts`, `worker/inbound-message.ts`, `app/api/settings/**`, `app/dashboard/settings/**`, `components/settings/**`, `tests/unit/agent*.test.ts`, `tests/unit/business-hours.test.ts`, `tests/unit/llm*.test.ts` |
| **orders** | `lib/orders.ts`, `lib/conversations.ts`, `worker/notifications.ts`, `worker/maintenance.ts`, `app/api/orders/**`, `app/api/conversations/**`, `app/dashboard/orders/**`, `app/dashboard/conversations/**`, `components/orders/**`, `components/conversations/**`, `tests/unit/orders*.test.ts`, `tests/integration/orders.test.ts` |
| **platform** | `app/dashboard/page.tsx` (home: today stats + WhatsApp status + setup checklist), `app/api/dashboard/**`, `app/admin/**`, `app/api/admin/**`, `app/api/health/**`, `sentry.*.config.ts`, `instrumentation.ts`, `Dockerfile`, `Dockerfile.worker`, `docker-compose.prod.yml`, `.dockerignore`, `README.md`, `docs/DEPLOY.md`, `components/home/**`, `components/admin/**` |

Dashboard nav (auth agent builds it; others create the pages): `/dashboard` Home, `/dashboard/orders`, `/dashboard/conversations`,
`/dashboard/products`, `/dashboard/whatsapp`, `/dashboard/settings` (bot + business details), `/dashboard/team`. Platform admin: `/admin`.
