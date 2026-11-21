# WhatsApp Order Bot SaaS — MVP PRD
Nov 21, 2026 · @GhostScript

## 1. Summary
A multi-tenant SaaS that gives small businesses an AI sales assistant on their own WhatsApp number. A business signs up, scans a QR code to connect WhatsApp, adds its products with photos, and the bot answers customers, shows products, takes orders and saves them to a dashboard. The owner gets an alert for every new order and updates its status from the dashboard; the customer is notified automatically.
MVP only: one shared OpenWA gateway, one WhatsApp number per tenant, orders without online payment.

## 2. Goals and non-goals
Goals (MVP)
1. A business can go from sign-up to a live bot answering customers in under 15 minutes.
2. The bot can take a complete order (items, quantities, name, delivery address) and save it without human help.
3. Owners manage products (with images) and orders from a simple web dashboard, on phone or laptop.
4. Tenant data is fully isolated: no tenant can ever see or affect another tenant's data, chats or WhatsApp session.

Non-goals: online payments, subscription billing; WhatsApp Catalog sync, broadcasts; voice notes, image understanding, non-English; multiple numbers per tenant, roles beyond Owner/Staff; delivery integrations, inventory, analytics beyond basic counts; official WhatsApp Cloud API.

## 3. Users
- Business owner (tenant admin): signs up, connects WhatsApp, manages products, settings and staff, sees all orders.
- Staff: manages orders and conversations; cannot change settings or the WhatsApp connection.
- Customer: chats on WhatsApp. Never logs in.
- Platform admin: sees all tenants, can suspend a tenant, view system health. Internal page only.

## 4. Tech stack
Next.js App Router + TypeScript (UI + Route Handlers under /app/api); Tailwind + shadcn/ui (mobile-first); PostgreSQL (shared DB, tenantId on every tenant row); Prisma (client extension enforces tenant scoping); Redis + BullMQ (webhook job queue, dedupe, per-chat locks, rate limits, memory cache); separate worker process in /worker (route handlers never run long AI jobs); OpenWA gateway (self-hosted, one session per tenant, REST API + signed webhooks); LLM provider interface (Groq first; Claude/OpenAI pluggable, tool-calling); Auth.js email+password (session holds userId + active tenantId); S3-compatible storage (R2/MinIO) with public URLs so OpenWA can send images; Zod for every API input and webhook payload.

## 5. Core user flows
5.1 Onboarding: owner signs up (name, email, password, business name, WhatsApp number) → app creates Tenant + User + Membership(OWNER) + unique slug → setup checklist: Connect WhatsApp, Add products, Set business details, Test the bot.

5.2 Connect WhatsApp: Owner clicks Connect → API creates OpenWA session `t_<tenantId>` and registers webhook URL /api/webhooks/openwa with a per-tenant secret. Dashboard polls GET /api/whatsapp/status and shows the QR (or pairing code) until ready. Status: Connected / Disconnected / Needs re-scan. A session.disconnected webhook flips status and emails the owner.

5.3 Customer orders: customer messages the business number → OpenWA posts to /api/webhooks/openwa → route verifies HMAC, resolves tenant from session id, dedupes on idempotencyKey in Redis, enqueues a job, returns 200 immediately → worker takes per-chat Redis lock, loads tenant settings, customer and last N messages, runs AI agent with tools → agent replies (text and product images) via OpenWA; inbound+outbound messages stored → on explicit confirmation create_order writes Order + OrderItems with server-side prices and number like ORD-1042 → owner gets WhatsApp alert on personal number; order appears in dashboard.

5.4 Order handling: staff opens Orders (new first), changes status: New, Confirmed, Out for delivery, Delivered (or Cancelled). Each change sends the customer a WhatsApp update from an owner-editable template.

5.5 Human takeover: customer types "agent" or bot can't help → conversation flagged needs_human, owner alerted. Staff opens conversation, toggles Bot paused, replies from dashboard (sent via OpenWA). Bot resumes when toggled back, or automatically after 12 hours with no staff reply.

## 6. Feature requirements
6.1 Auth/tenancy: email+password sign-up/login, password reset by email. A user can belong to many tenants (Membership); tenant switcher in header. Roles OWNER, STAFF; owner invites staff by email. Every API route resolves tenantId from the session, never the body.
6.2 WhatsApp: connect, show QR / request pairing code, status, disconnect, reconnect. Store session id, status, last-seen per tenant. Webhook secret per tenant, encrypted.
6.3 Products: CRUD (name, description, price, category, available toggle, sort order). Up to 5 images per product via presigned URL upload; first image is the cover. Categories list per tenant. Prices integer kobo; currency per tenant (default NGN). CSV bulk import (name, price, description, category, image URL).
6.4 AI bot: per-tenant settings: bot name, tone, greeting, business hours, flat delivery fee, delivery areas, payment instructions, extra FAQ text. Memory: last 20 messages (cached in Redis). Prices/totals always server-side. Replies only in 1:1 chats; ignores groups, status, broadcasts, own messages. Outside hours still takes orders and says they'll be processed when open. Guardrails: never invent products/prices, never collect card/bank details, hand off when unsure.
6.5 Orders: list with filters (status, date), search by order number or phone. Detail: items, totals, customer, address, notes, status history, link to conversation. Status change triggers customer notification. New-order alert to owner's personal WhatsApp (from settings). CSV export.
6.6 Customers/conversations: customers auto-created from WhatsApp (phone, display name, first/last seen, order count). Conversation view: history, Bot paused toggle, reply box, needs_human flag.
6.7 Dashboard home: today's order count, revenue, new conversations, conversations needing a human; WhatsApp status and setup checklist.
6.8 Platform admin: list tenants with status, WhatsApp status, orders last 7 days. Suspend/unsuspend (suspended tenant's webhooks acknowledged and ignored).

## 7. AI agent design
One LLM request per inbound message: system prompt from tenant settings + recent messages + new message, with tools:
| Tool | Input | Does |
|---|---|---|
| list_products | optional query, category | available products: id, name, price, short description, hasImage |
| send_product_images | productIds (max 5) | sends each cover image with caption "name — price" via OpenWA |
| create_order | items[productId, quantity], customerName, deliveryAddress, notes | validates, computes subtotal + delivery fee, creates Order, returns number and total |
| get_order_status | optional orderNumber | this customer's recent orders and statuses (scoped to their phone) |
| request_human | reason | flags needs_human, pauses bot, alerts owner |
Rules: create_order only after explicit confirmation of a summary. Max 5 tool iterations per message; on failure send a polite fallback and flag for a human. Provider interface `generate({ system, messages, tools })` swappable via env.

## 8. Data model — see prisma/schema.prisma. Tenancy: every tenant model has tenantId + index starting with tenantId; `forTenant(tenantId)` extension; raw client only in auth, webhook routing, admin. Order numbers from atomic increment of Tenant.orderCounter inside the order transaction.

## 9. API routes
/api/auth/* (Auth.js); POST /api/tenants (sign-up); POST /api/whatsapp/connect; GET /api/whatsapp/status; POST /api/whatsapp/pairing-code; POST /api/whatsapp/disconnect; GET,POST /api/products; GET,PATCH,DELETE /api/products/[id] (soft delete); POST /api/products/import; POST /api/uploads/presign; GET,POST,PATCH,DELETE /api/categories; GET /api/orders; GET,PATCH /api/orders/[id]; GET /api/orders/export; GET /api/conversations (filter needsHuman); GET,PATCH /api/conversations/[id]; POST /api/conversations/[id]/messages (staff reply); GET,PUT /api/settings/bot; POST /api/team/invite; POST /api/webhooks/openwa (public, HMAC); GET,PATCH /api/admin/tenants. JSON everywhere; errors `{ error: { code, message } }`; Zod on all inputs.

## 10. Message pipeline
```
OpenWA --POST--> /api/webhooks/openwa
  1. verify X-OpenWA-Signature (HMAC-SHA256, tenant secret)
  2. resolve tenant by sessionId; drop if suspended
  3. SET NX dedupe:{idempotencyKey} (24h) -> drop duplicates
  4. keep: message.received, 1:1 chat, not fromMe, text/image/voice/sticker/location (non-text acknowledged naturally)
  5. enqueue BullMQ job "inbound-message" -> 200 OK (< 300 ms)
Worker --> lock:{tenantId}:{chatId} (Redis, 60 s)
  upsert Customer + Conversation, store inbound Message
  if botPaused -> stop
  run agent (tools) -> send replies via OpenWA -> store outbound Messages
  release lock; failed jobs retry 3x with backoff, then flag needs_human
```
Session events (session.status, session.disconnected, session.qr) go to a separate queue that updates WhatsAppSession.

## 11. Non-functional
Webhook ack < 300 ms; bot reply within 10 s for 95%. Isolation tests prove tenant A cannot read tenant B's products, orders, conversations. HMAC on webhooks, secrets AES-256-GCM, rate limits per tenant and per chat (Redis), no payment data, argon2 passwords. Idempotent webhooks, retries, per-chat locking. Structured logs with tenantId/jobId, Sentry, /api/health checks Postgres, Redis, OpenWA. Scale: 100 tenants, 10k inbound msgs/day on one app server, one worker, one OpenWA.

## 12. Env
DATABASE_URL, REDIS_URL, OPENWA_BASE_URL, OPENWA_API_KEY, APP_URL (public https; OpenWA rejects localhost webhook URLs — use a tunnel in dev), ENCRYPTION_KEY, AUTH_SECRET, LLM_PROVIDER, GROQ_API_KEY, S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_PUBLIC_URL, SENTRY_DSN.

## 15. Open questions
Hosting (single VPS vs Vercel + VPS); OpenWA engine (Baileys vs whatsapp-web.js); pricing model; bank-transfer proof-of-payment in MVP or fully offline.
