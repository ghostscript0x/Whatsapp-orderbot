import { createHmac } from "node:crypto";
import { z } from "zod";
import type { InboundMessageJob } from "./queues";
import { safeEqual } from "./crypto";
import { formatLocation, isInboundType, type InboundType } from "./humanize";

/**
 * Pure helpers for OpenWA webhook deliveries. Payload + signature format are documented in
 * docs/OPENWA.md (source: rmyndharis/OpenWA docs/06-api-specification.md §6.6).
 */

export const SIGNATURE_HEADER = "x-openwa-signature";

/**
 * Redis key: epoch ms when the webhook last accepted a customer message for this chat. The worker
 * uses it to keep waiting while a burst is still arriving and to notice messages that came in
 * while it was replying (so it can quote the message it is answering).
 */
export const lastInboundKey = (tenantId: string, chatId: string) => `chat:lastin:${tenantId}:${chatId}`;
export const LAST_INBOUND_TTL_S = 3600;

/**
 * `X-OpenWA-Signature: sha256=<hex HMAC-SHA256 of the exact raw body>`.
 * Returns false for a missing/malformed/wrong signature or an empty secret. Constant-time compare.
 */
export function verifySignature(rawBody: string | Uint8Array, headers: Headers, secret: string): boolean {
  const header = headers.get(SIGNATURE_HEADER);
  if (!header || !secret) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(header.trim().toLowerCase(), expected);
}

// ---- payload schemas ----

const EnvelopeSchema = z.object({
  event: z.string().min(1),
  timestamp: z.string().optional(),
  sessionId: z.string().min(1),
  idempotencyKey: z.string().min(1).max(512),
  deliveryId: z.string().optional(),
  data: z.record(z.unknown()).default({}),
});

const MessageDataSchema = z.object({
  id: z.string().default(""),
  from: z.string().optional(),
  to: z.string().optional(),
  chatId: z.string().min(1),
  body: z.string().nullish(),
  caption: z.string().nullish(),
  type: z.string(),
  timestamp: z.number().optional(), // epoch seconds
  isGroup: z.boolean().optional(),
  kind: z.string().optional(), // individual | group | channel | status | broadcast | unknown
  fromMe: z.boolean().default(false),
  isStatusBroadcast: z.boolean().optional(),
  senderPhone: z.string().nullish(), // only with RESOLVE_LID_TO_PHONE=true on the gateway
  contact: z.object({ name: z.string().nullish(), pushName: z.string().nullish() }).passthrough().nullish(),
  // Only on location messages (§6.6 "A message.received payload also carries ...").
  location: z
    .object({
      latitude: z.coerce.number().min(-90).max(90),
      longitude: z.coerce.number().min(-180).max(180),
      description: z.string().nullish(),
      address: z.string().nullish(),
    })
    .passthrough()
    .nullish()
    .catch(null),
});
export type OpenWaMessage = z.infer<typeof MessageDataSchema>;

const StatusDataSchema = z.object({ status: z.string() });
const QrDataSchema = z.object({ qr: z.string() });
const AuthDataSchema = z.object({ phone: z.string().nullish(), pushName: z.string().nullish() });
const DisconnectedDataSchema = z.object({ reason: z.unknown().optional() });

type Envelope = Omit<z.infer<typeof EnvelopeSchema>, "data" | "event">;

export type WebhookPayload =
  | (Envelope & { event: "message.received"; data: OpenWaMessage })
  | (Envelope & { event: "session.status"; data: z.infer<typeof StatusDataSchema> })
  | (Envelope & { event: "session.qr"; data: z.infer<typeof QrDataSchema> })
  | (Envelope & { event: "session.authenticated"; data: z.infer<typeof AuthDataSchema> })
  | (Envelope & { event: "session.disconnected"; data: z.infer<typeof DisconnectedDataSchema> })
  | (Envelope & { event: "other"; originalEvent: string; data: Record<string, unknown> });

export const SESSION_EVENTS = ["session.status", "session.qr", "session.authenticated", "session.disconnected"] as const;

/** Validates an OpenWA delivery body. Throws ZodError on a malformed payload. */
export function parseWebhook(json: unknown): WebhookPayload {
  const env = EnvelopeSchema.parse(json);
  const { event, data, ...rest } = env;
  switch (event) {
    case "message.received":
      return { ...rest, event, data: MessageDataSchema.parse(data) };
    case "session.status":
      return { ...rest, event, data: StatusDataSchema.parse(data) };
    case "session.qr":
      return { ...rest, event, data: QrDataSchema.parse(data) };
    case "session.authenticated":
      return { ...rest, event, data: AuthDataSchema.parse(data) };
    case "session.disconnected":
      return { ...rest, event, data: DisconnectedDataSchema.parse(data) };
    default:
      return { ...rest, event: "other", originalEvent: event, data };
  }
}

/** Only the session id, for routing before the signature can be checked. */
export function peekSessionId(json: unknown): string | null {
  const r = z.object({ sessionId: z.string().min(1) }).safeParse(json);
  return r.success ? r.data.sessionId : null;
}

// ---- inbound message filtering + mapping ----

const NON_DIRECT_SUFFIXES = ["@g.us", "@broadcast", "@newsletter"];
const PHONE_HOSTS = ["c.us", "s.whatsapp.net"];

/**
 * Inbound job as produced here and consumed by worker/inbound-message.ts. Wider than
 * `InboundMessageJob.type` in lib/queues.ts ("text" | "image"), which the backend owns; the
 * producer and consumer are both ours, so the queue payload carries this shape.
 */
export type InboundJob = Omit<InboundMessageJob, "type"> & { type: InboundType };

export type InboundDecision = { ok: true; job: InboundJob } | { ok: false; reason: string };

function isDirectChat(m: OpenWaMessage): boolean {
  if (m.isGroup || m.isStatusBroadcast) return false;
  if (m.kind && m.kind !== "individual") return false;
  const chatId = m.chatId.toLowerCase();
  if (chatId === "status@broadcast") return false;
  return !NON_DIRECT_SUFFIXES.some((s) => chatId.endsWith(s));
}

/** Customer phone (digits): the chat id's number, or `senderPhone` for a `@lid` privacy id. */
export function phoneForChat(chatId: string, senderPhone?: string | null): string {
  const [local, host = ""] = chatId.split("@");
  if (PHONE_HOSTS.includes(host.toLowerCase())) return local.split(":")[0].replace(/\D/g, "");
  return (senderPhone ?? "").replace(/\D/g, "");
}

/** whatsapp-web.js can put a base64 thumbnail in `body` for media; never treat that as text. */
function looksLikeBase64Blob(s: string): boolean {
  return s.length > 500 && !/\s/.test(s) && /^[A-Za-z0-9+/=]+$/.test(s);
}

const MAX_BODY = 4096;

function bodyFor(m: OpenWaMessage, type: InboundType): string {
  if (type === "location") {
    if (m.location) return formatLocation({ ...m.location, description: m.location.description ?? undefined, address: m.location.address ?? undefined });
    const raw = m.body ?? "";
    return looksLikeBase64Blob(raw) ? "" : raw.trim();
  }
  if (type === "voice" || type === "audio" || type === "sticker") return "";
  const rawText = type === "text" ? (m.body ?? "") : (m.caption ?? m.body ?? "");
  return looksLikeBase64Blob(rawText) ? "" : rawText.trim();
}

/**
 * Turns a verified webhook into an inbound job, or explains why it is ignored. Accepted:
 * `message.received`, 1:1 chats only, not sent by us, types in INBOUND_TYPES (text, image, video,
 * voice, audio, sticker, location, document). Media bytes are never forwarded.
 */
export function toInboundJob(payload: WebhookPayload, ctx: { tenantId: string }): InboundDecision {
  if (payload.event !== "message.received") return { ok: false, reason: "not_a_message" };
  const m = payload.data;
  if (m.fromMe) return { ok: false, reason: "from_me" };
  if (!isDirectChat(m)) return { ok: false, reason: "not_direct_chat" };
  const type = m.type;
  if (!isInboundType(type)) return { ok: false, reason: `unsupported_type:${m.type}` };
  if (!m.id) return { ok: false, reason: "missing_message_id" };

  const body = bodyFor(m, type).slice(0, MAX_BODY);
  if (type === "text" && !body) return { ok: false, reason: "empty_text" };

  const pushName = m.contact?.pushName ?? m.contact?.name ?? undefined;
  return {
    ok: true,
    job: {
      tenantId: ctx.tenantId,
      sessionId: payload.sessionId,
      idempotencyKey: payload.idempotencyKey,
      chatId: m.chatId,
      phone: phoneForChat(m.chatId, m.senderPhone),
      ...(pushName ? { pushName } : {}),
      messageId: m.id,
      type,
      body,
      timestamp: m.timestamp ? m.timestamp * 1000 : Date.now(),
    },
  };
}
