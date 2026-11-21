# OpenWA integration notes

Gateway: **OpenWA** — https://github.com/rmyndharis/OpenWA (self-hosted, NestJS; engines whatsapp-web.js (default) or Baileys via `ENGINE_TYPE`).
Researched 2026-11-21 from the repo's `HEAD`. Primary sources:

- API reference: https://github.com/rmyndharis/OpenWA/blob/HEAD/docs/06-api-specification.md (§6.1 auth, §6.2 errors, §6.4.1 sessions, §6.4.2 messages, §6.4.8 webhooks, §6.6 webhook events & delivery)
- Signature: https://github.com/rmyndharis/OpenWA/blob/HEAD/docs/examples/webhook-signature-verification.md and `sdk/go/webhook_signature.go`
- Pairing: https://github.com/rmyndharis/OpenWA/blob/HEAD/docs/examples/session-phone-number-pairing.md
- Go SDK types (field names): `sdk/go/sessions.go`, `sdk/go/webhooks.go`, `sdk/go/types_session.go`, `sdk/go/types_webhook.go`, `sdk/go/types_message.go`

Code: `lib/openwa.ts` (REST client), `lib/webhook.ts` (signature + payload parsing), `app/api/webhooks/openwa/route.ts`, `worker/session-events.ts`.

## Verified facts

### REST API
- Base: `${OPENWA_BASE_URL}/api/...` (default port 2785). Auth header **`X-API-Key: <key>`** (or `Authorization: Bearer`); never in the URL. Key needs OPERATOR role and must be **unscoped** (session creation rejects session-scoped keys).
- No response envelope: resources returned raw. Errors: `{ statusCode, message: string | string[], error, code? }`.
- Session ids are **UUIDs assigned by OpenWA**. A session also has a unique `name` (3–50 chars, `[a-zA-Z0-9-]` only — **underscores are rejected**).
- Session status (lowercase): `created | initializing | qr_ready | authenticating | ready | disconnected | action_required | failed`.

| Purpose | Call |
|---|---|
| Find by name | `GET /api/sessions?name=<name>` → array of `{ id, name, status, phone, ... }` |
| Create | `POST /api/sessions` `{ name }` → 201 session (409 if name exists) |
| Start | `POST /api/sessions/:id/start` (400 if already started/starting) |
| Get state | `GET /api/sessions/:id` → `{ id, name, status, phone, pushName, ... }` |
| QR | `GET /api/sessions/:id/qr` → `{ qrCode: "data:image/png;base64,...", status }` (400 when not waiting for a scan) |
| Pairing code | `POST /api/sessions/:id/pairing-code` `{ phoneNumber: "<6-15 digits>" }` → `{ pairingCode: "ABCD1234", status }`; 409 until status is `qr_ready` |
| Logout (unlink) | `POST /api/sessions/:id/logout`; 400 if session not running, 409 on Baileys if nothing linked |
| Stop | `POST /api/sessions/:id/stop` |
| Webhooks | `GET/POST /api/sessions/:id/webhooks`, `PUT /api/sessions/:id/webhooks/:webhookId` body `{ url, events[], secret (min 16 chars), headers?, filters?, retryCount (0-5, default 3) }` |
| Send text | `POST /api/sessions/:id/messages/send-text` `{ chatId, text (≤4096) }` → 201 `{ messageId, timestamp }` |
| Send image | `POST /api/sessions/:id/messages/send-image` `{ chatId, url, caption? (≤1024) }` → 201 `{ messageId, timestamp }`; URL fetched by the gateway (SSRF-guarded, redirects **not** followed) |
| Send text as a reply | `send-text` with optional `quotedMessageId` (also accepted by send-image/video/audio/document/sticker/location/contact/poll). Shorthand: `POST /api/sessions/:id/messages/reply` `{ chatId, quotedMessageId, text }` (stricter: 404 if the quoted id is not in that chat) |
| Typing indicator | `POST /api/sessions/:id/chats/typing` `{ chatId, state: "typing" \| "recording" \| "paused" }` → 200 `{ success: true }` (always true). `paused` clears it. Errors: 400 not started, 404, 409 engine not ready |
| Mark read (blue ticks) | `POST /api/sessions/:id/chats/read` `{ chatId, messageIds?: string[] (1-100) }` → 200 `{ success: boolean }`. whatsapp-web.js: chat-level, ignores `messageIds`. Baileys: acknowledges only the listed ids, or only the newest received message when omitted (so we pass every id of a burst). `success: false` is a real outcome (chat not found / declined) |
| React (not used yet) | `POST /api/sessions/:id/messages/react` `{ chatId, messageId, emoji (≤32; "" removes) }` → 200 `{ success: true }` |
| Location / voice (not used) | `POST .../messages/send-location`; a voice note is `POST .../messages/send-audio` with `ptt: true` (OGG/Opus recommended) |
| Own presence (not used) | `PUT /api/sessions/:id/presence` `{ available: boolean }` — account-wide online/offline, not per chat |

Source for the rows above (verified 2026-11-21): https://github.com/rmyndharis/OpenWA/blob/HEAD/docs/06-api-specification.md — §6.4.1 (`chats/typing`, `chats/read`, `presence`), §6.4.2 (`send-text` + "Quoted sends", `send-image`, `reply`, `react`, "Idempotent sends"), §6.6 event catalog.

- **Quoted ids are engine-specific and not harmonised**: whatsapp-web.js wants the serialized id (`true_/false_<chat>_<hash>`), Baileys the raw key id. The `id` on `message.received` is in the active engine's form, so we quote with the stored `waMessageId`. An id the engine can't resolve **fails the send with 404** (it is never sent unquoted); we then resend without the quote. Upstream gap on whatsapp-web.js: a resolvable but "not replyable" message is sent unquoted with 201.
- **Send idempotency**: single-recipient sends accept an `Idempotency-Key` header (held 24 h). Not used: a retried job re-runs the model, so the body differs and OpenWA would answer 422 `IDEMPOTENCY_KEY_REUSED`.
- **Inbound media on `message.received`**: `type` is one of `text|image|video|audio|voice|document|sticker|location|contact|poll|call|revoked|order|product|masked|unknown`; media messages carry `media{mimetype,filename?,data?,omitted?,sizeBytes?}` (base64 inlined only up to `WEBHOOK_MEDIA_INLINE_MAX_BYTES`, default 1 MiB). Optional extras, present only when the message has them: `quotedMessage{id,body}`, `location{latitude,longitude,description?,address?,url?}`, `isForwarded`, `mentionedIds`.

- Chat ids must be `localpart@host`: `<phone>@c.us`, `<id>@g.us` (group), `<n>@s.whatsapp.net`, `<n>@lid` (privacy id).
- QR is always delivered as a **PNG data URL** (both REST and the `session.qr` webhook) — rendered directly with `<img>`; no QR library needed.

### Webhooks
- Body: `{ event, timestamp (ISO), sessionId (UUID), idempotencyKey, deliveryId, data }`.
- Headers: `X-OpenWA-Event`, `X-OpenWA-Idempotency-Key`, `X-OpenWA-Delivery-Id`, `X-OpenWA-Retry-Count`, `X-OpenWA-Signature`.
- **Signature**: `X-OpenWA-Signature: sha256=<lowercase hex HMAC-SHA256(secret, exact raw body bytes)>`. No timestamp header / no replay window. Header omitted if the webhook has no secret (we always set one).
- `idempotencyKey` is stable across retries, suffixed with `_{webhookId}`. For messages: `msg_{sessionId}_{messageId}_{webhookId}`.
- Delivery is at-least-once. Any non-2xx, timeout (10 s default) or network error is retried with exponential backoff (base 5 s) up to `retryCount` attempts, then recorded in `GET /api/webhooks/delivery-failures` (redrivable). There is no "stop retrying" status code.
- Events we subscribe to: `message.received`, `session.status`, `session.qr`, `session.authenticated`, `session.disconnected`.
  - `message.received` data: `id, from, to, chatId, body, type, timestamp (epoch s), isGroup, kind (individual|group|channel|status|broadcast|unknown), fromMe, contact{name?,pushName?}, media{mimetype,data?(base64),omitted?}, senderPhone? (only with RESOLVE_LID_TO_PHONE=true), isStatusBroadcast?`. Types include `text, image, video, audio, voice, document, sticker, location, contact, poll, ...`.
  - `session.status` `{ sessionId, status }`; `session.qr` `{ sessionId, qr }` (data URL); `session.authenticated` `{ sessionId, phone, pushName }`; `session.disconnected` `{ sessionId, reason }` — fired for engine/phone-side drops only, not for API stop/logout.
- Registration rejects URLs that resolve to private/loopback addresses (SSRF guard) unless whitelisted in `SSRF_ALLOWED_HOSTS` — hence the public https `APP_URL` requirement.

## How we use it

- Session name `t-<tenantId>` (hyphen, because `_` is invalid). The OpenWA UUID is stored in `WhatsAppSession.openwaSessionId`; all calls and webhook routing use the UUID.
- `openwa.createSession(name, webhook)` is idempotent: find by name → create if missing (409 race → re-find) → create or update our webhook (matched by URL) with the tenant secret → start unless already running. Returns `{ sessionId }`.
- Status mapping: `created/initializing/authenticating → STARTING`, `qr_ready → QR_PENDING`, `ready → CONNECTED`, `action_required → NEEDS_RESCAN`, `disconnected/failed → DISCONNECTED`. `session.disconnected` with a reason mentioning logout/unlink/conflict → `NEEDS_RESCAN`, else `DISCONNECTED`. The owner is emailed (notify `owner-disconnected`) only on a transition away from `CONNECTED`.
- Webhook route responses: 400 bad JSON / no sessionId; **404 unknown session** (bounded retries, then visible in OpenWA's delivery-failure log); 401 bad signature; 200 for accepted, duplicate, ignored (filtered message, unrecognised-but-signed payload, suspended tenant); 429 when a tenant exceeds 120 messages/min (OpenWA retries later); 500 if enqueueing fails (dedupe claim released so the retry is accepted).
- BullMQ `jobId` = `sha256(idempotencyKey)` (BullMQ rejects custom ids containing `:`).
- Recommended gateway env: `RESOLVE_LID_TO_PHONE=true` so customers who appear as `@lid` privacy ids still get a phone number.
- Accepted inbound types (`lib/humanize.ts` `INBOUND_TYPES`): text, image, video, voice, audio, sticker, location, document. Media bytes are never forwarded; voice/audio/sticker get an empty body, location becomes `"<description>, <address> (pin: https://maps.google.com/?q=lat,lng)"`. The model gets a bracketed note per type (it can't see/hear media) — see `describeInbound`.
- **Human feel** (`worker/inbound-message.ts` + `lib/humanize.ts`): the webhook stores `chat:lastin:{tenantId}:{chatId}` (epoch ms). Each job stores its message, then `decideBurst` picks one job per burst (the newest message's) and waits ~4 s of quiet (max 10 s from the first message) via `moveToDelayed`. That job marks the burst read (`chats/read` with all ids, 1-3 s after the newest message), shows `typing` while the model runs, splits the reply into 1-3 bubbles and types each for ~35-60 ms/char (1.2-6 s, ≤9 s total). If a new message arrived while replying, the first bubble quotes the message being answered. Typing/read failures are logged and never block a reply.

## Unverified / assumptions

1. **Image message caption field.** The docs list `body` but not a separate `caption` on `message.received`. We read `caption ?? body`, and drop a `body` that looks like a base64 blob (whatsapp-web.js historically put a thumbnail there). Verify against a live image message.
2. **Inbound image URL.** Media arrives inline as base64 (`media.data`) or `omitted`, never as a public URL, so `InboundMessageJob.mediaUrl` is left unset; the caption is passed as `body`. (Image understanding is a PRD non-goal.) Fetching it later would need `GET /api/sessions/:id/messages/:chatId/:messageId/media` with the API key.
3. **`@lid` senders without `senderPhone`** get `phone: ""` (replies still work via the `@lid` chatId).
4. **Disconnect reasons** are free text; the `NEEDS_RESCAN` regex (`logout|unlink|conflict|...`) is a heuristic. The docs only quote `LOGOUT`.
5. **`/start` "already started" detection** matches `/already/i` in the 400 message; the docs describe the case but not the exact text.
6. **Webhook URL validation** accepts `http://`; the https-only rule in `/api/whatsapp/connect` is ours (the SSRF guard blocks localhost/private IPs in practice).
7. **Typing indicator lifetime.** The docs don't say how long `typing` stays visible without a refresh (WhatsApp clients typically drop it after ~25 s). We send it once before the model call and once per bubble; replies are paced well under that, but a very slow model call could let it lapse.
8. **WhatsApp clears "typing" when our message arrives.** Assumed (standard client behaviour, not stated in the OpenWA docs), so we don't send `paused` after each bubble — only when a reply ends without one.
9. **Location / quoted-message field shapes** come from the §6.6 prose list (`location{latitude,longitude,description?,address?,url?}`, `quotedMessage{id,body}`), not from a sample payload. Coordinates are validated (`-90..90`, `-180..180`; strings coerced); anything else is ignored and the location body falls back to the text body. `quotedMessage` on inbound is not used yet.
10. **`voice` vs `audio`.** The type list contains both; we treat both as voice notes (ask the customer to type).

## Sending reliably (verified 2026-11-21, §6.3 "SendMediaMessageDto" and §6.4.2 "Idempotent sends")

- `send-image` accepts `{ base64, mimetype }` instead of `url` (base64 wins when both are given). A `url` goes
  through the gateway's SSRF guard and its own network; a blocked or unreachable URL answers `400 Media fetch failed`.
  `sendTenantImage` therefore downloads the photo in the app (≤ 5 MB, `image/*`) and sends the bytes, falling back
  to the URL only if that download fails.
- Every send carries a fresh `Idempotency-Key` (UUID) and is retried up to 2 times on network errors, timeouts,
  `502/503/504` and `409 IDEMPOTENCY_KEY_IN_PROGRESS`. OpenWA replays the first result for a repeated key, so a retry
  can't double-send. `409 IDEMPOTENCY_OUTCOME_UNKNOWN` is never retried. Typing and read receipts retry once.
- HTML error pages from a proxy in front of the gateway (e.g. Cloudflare 502) are logged by their `<title>` only.
