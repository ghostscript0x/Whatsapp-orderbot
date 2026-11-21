import { randomUUID } from "node:crypto";
import { z, type ZodSchema } from "zod";
import type { WaStatus } from "@prisma/client";
import { env, requireEnv } from "./env";
import { prisma } from "./prisma";

/**
 * Typed client for the self-hosted OpenWA gateway (https://github.com/rmyndharis/OpenWA).
 * API reference: docs/06-api-specification.md in that repo; summary in docs/OPENWA.md.
 *
 * Identifiers: OpenWA assigns each session a UUID (`id`); we create it with the unique
 * name `t-<tenantId>` (names allow only letters, digits and hyphens) and store the UUID in
 * WhatsAppSession.openwaSessionId. Every method except createSession takes that UUID.
 */

export type ChatState = "typing" | "recording" | "paused";

export type OpenWaSessionState = { status: WaStatus; qr: string | null; phone: string | null };

export class OpenWaError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "OpenWaError";
  }
}

/** Thrown by sendTenantText/sendTenantImage when the tenant has no CONNECTED session. */
export class WhatsAppNotConnectedError extends Error {
  constructor(tenantId: string) {
    super(`WhatsApp is not connected for tenant ${tenantId}`);
    this.name = "WhatsAppNotConnectedError";
  }
}

const REQUEST_TIMEOUT_MS = 15_000;
// Sending an image makes OpenWA download it first, so allow longer.
const MEDIA_TIMEOUT_MS = 45_000;
export const WEBHOOK_EVENTS = [
  "message.received",
  "session.status",
  "session.qr",
  "session.authenticated",
  "session.disconnected",
] as const;

/** OpenWA session name for a tenant (3-50 chars, [a-zA-Z0-9-]). */
export function sessionNameFor(tenantId: string): string {
  return `t-${tenantId}`;
}

// ---- response schemas (only the fields we read; extra fields pass through) ----

const OpenWaStatusSchema = z.enum([
  "created",
  "initializing",
  "qr_ready",
  "authenticating",
  "ready",
  "disconnected",
  "action_required",
  "failed",
]);
export type OpenWaStatus = z.infer<typeof OpenWaStatusSchema>;

const SessionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  status: OpenWaStatusSchema,
  phone: z.string().nullish(),
});
const QrSchema = z.object({ qrCode: z.string().min(1), status: OpenWaStatusSchema.optional() });
const PairingSchema = z.object({ pairingCode: z.string().min(1) });
const WebhookSchema = z.object({ id: z.string().min(1), url: z.string() });
const SendSchema = z.object({ messageId: z.string().min(1) });
const SuccessSchema = z.object({ success: z.boolean() });
const ErrorBodySchema = z
  .object({ message: z.union([z.string(), z.array(z.string())]).optional(), code: z.string().optional() })
  .passthrough();

/** Map OpenWA's lowercase lifecycle status onto our WaStatus enum. */
export function mapOpenWaStatus(status: OpenWaStatus): WaStatus {
  switch (status) {
    case "created":
    case "initializing":
    case "authenticating":
      return "STARTING";
    case "qr_ready":
      return "QR_PENDING";
    case "ready":
      return "CONNECTED";
    case "action_required":
      // WhatsApp needs something from the account holder (restriction / passkey): re-link required.
      return "NEEDS_RESCAN";
    case "disconnected":
    case "failed":
      return "DISCONNECTED";
  }
}

// ---- transport ----

type RequestOpts = {
  body?: unknown;
  timeoutMs?: number;
  query?: Record<string, string>;
  /**
   * Extra attempts on a transient failure (network error, timeout, 502/503/504, 409 key-in-progress).
   * Only safe for idempotent calls, or for sends that carry `idempotencyKey`.
   */
  retries?: number;
  /** OpenWA dedupes sends carrying the same key for 24 h, so a retry can't double-send. */
  idempotencyKey?: string;
};

const RETRY_DELAYS_MS = [600, 1500];
const TRANSIENT_STATUSES = new Set([502, 503, 504]);

function isTransient(err: OpenWaError): boolean {
  return err.status === 0 || TRANSIENT_STATUSES.has(err.status) || err.code === "IDEMPOTENCY_KEY_IN_PROGRESS";
}

/** A proxy (e.g. Cloudflare) answers outages with an HTML page: log its title, not the markup. */
function describeErrorBody(text: string, statusText: string): string {
  if (/^\s*</.test(text)) {
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1]?.replace(/\s+/g, " ").trim();
    return `${title || statusText || "HTML error page"} (gateway unreachable through its proxy)`;
  }
  return text.slice(0, 200) || statusText;
}

async function call<T>(method: string, path: string, schema: ZodSchema<T> | null, opts: RequestOpts = {}): Promise<T> {
  const retries = opts.retries ?? 0;
  for (let attempt = 0; ; attempt++) {
    try {
      return await callOnce(method, path, schema, opts);
    } catch (err) {
      if (!(err instanceof OpenWaError) || !isTransient(err) || attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]));
    }
  }
}

async function callOnce<T>(method: string, path: string, schema: ZodSchema<T> | null, opts: RequestOpts): Promise<T> {
  const base = env().OPENWA_BASE_URL.replace(/\/+$/, "");
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        "X-API-Key": requireEnv("OPENWA_API_KEY"),
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : err instanceof Error ? err.message : String(err);
    throw new OpenWaError(0, "network_error", `OpenWA ${method} ${path} failed: ${reason}`);
  }

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const parsed = ErrorBodySchema.safeParse(json);
    const msg = parsed.success && parsed.data.message !== undefined
      ? [parsed.data.message].flat().join("; ")
      : describeErrorBody(text, res.statusText);
    throw new OpenWaError(res.status, parsed.success ? parsed.data.code : undefined, `OpenWA ${method} ${path} → ${res.status}: ${msg}`);
  }

  if (!schema) return undefined as T;
  const out = schema.safeParse(json);
  if (!out.success) {
    throw new OpenWaError(res.status, "invalid_response", `OpenWA ${method} ${path} returned an unexpected body: ${out.error.issues[0]?.message ?? "invalid"}`);
  }
  return out.data;
}

const enc = encodeURIComponent;

async function findSessionByName(name: string) {
  const list = await call("GET", "/api/sessions", z.array(SessionSchema), { query: { name } });
  return list.find((s) => s.name === name) ?? null;
}

async function upsertWebhook(sessionId: string, webhook: { url: string; secret: string }) {
  const existing = await call("GET", `/api/sessions/${enc(sessionId)}/webhooks`, z.array(WebhookSchema));
  const body = { url: webhook.url, events: [...WEBHOOK_EVENTS], secret: webhook.secret };
  // Match on our webhook path, not the full URL: dev tunnel hostnames change on restart, and
  // OpenWA has no documented DELETE, so we move our existing webhook instead of adding another.
  const ourPath = new URL(webhook.url).pathname;
  const match =
    existing.find((w) => w.url === webhook.url) ??
    existing.find((w) => {
      try {
        return new URL(w.url).pathname === ourPath;
      } catch {
        return false;
      }
    });
  if (match) {
    await call("PUT", `/api/sessions/${enc(sessionId)}/webhooks/${enc(match.id)}`, null, { body });
  } else {
    await call("POST", `/api/sessions/${enc(sessionId)}/webhooks`, null, { body: { ...body, retryCount: 5 } });
  }
}

const RUNNING: OpenWaStatus[] = ["initializing", "qr_ready", "authenticating", "ready"];

export const openwa = {
  /**
   * Idempotent: finds the session by name or creates it, creates/updates our webhook
   * (secret + events), and starts it if it is not running. Returns the OpenWA session UUID.
   */
  async createSession(name: string, webhook: { url: string; secret: string }): Promise<{ sessionId: string }> {
    let session = await findSessionByName(name);
    if (!session) {
      try {
        session = await call("POST", "/api/sessions", SessionSchema, { body: { name } });
      } catch (err) {
        // A concurrent create won the race on the unique name.
        if (!(err instanceof OpenWaError && err.status === 409)) throw err;
        session = await findSessionByName(name);
        if (!session) throw err;
      }
    }
    await upsertWebhook(session.id, webhook);
    if (!RUNNING.includes(session.status)) {
      try {
        await call("POST", `/api/sessions/${enc(session.id)}/start`, SessionSchema);
      } catch (err) {
        // 400 "already started / already starting" means our goal is met.
        if (!(err instanceof OpenWaError && err.status === 400 && /already/i.test(err.message))) throw err;
      }
    }
    return { sessionId: session.id };
  },

  /** Live status + phone; the QR (PNG data URL) only while OpenWA is waiting for a scan. */
  async getSessionState(sessionId: string): Promise<OpenWaSessionState> {
    const s = await call("GET", `/api/sessions/${enc(sessionId)}`, SessionSchema);
    let qr: string | null = null;
    if (s.status === "qr_ready") {
      try {
        qr = (await call("GET", `/api/sessions/${enc(sessionId)}/qr`, QrSchema)).qrCode;
      } catch (err) {
        // 400 = QR not ready yet / just paired / pairing-code window: no QR to show right now.
        if (!(err instanceof OpenWaError && err.status === 400)) throw err;
      }
    }
    return { status: mapOpenWaStatus(s.status), qr, phone: s.phone ?? null };
  },

  /** Phone must be digits only with country code (6-15 digits). Session must be qr_ready. */
  async requestPairingCode(sessionId: string, phone: string): Promise<string> {
    const res = await call("POST", `/api/sessions/${enc(sessionId)}/pairing-code`, PairingSchema, {
      body: { phoneNumber: phone.replace(/\D/g, "") },
      timeoutMs: MEDIA_TIMEOUT_MS,
    });
    return res.pairingCode;
  },

  /**
   * Unlinks the device. OpenWA refuses logout for a stopped session (400) or, on Baileys, one
   * with no linked device (409); in both cases there is nothing to unlink, so just stop it.
   */
  async logout(sessionId: string): Promise<void> {
    try {
      await call("POST", `/api/sessions/${enc(sessionId)}/logout`, null, { timeoutMs: MEDIA_TIMEOUT_MS });
    } catch (err) {
      if (!(err instanceof OpenWaError && (err.status === 400 || err.status === 409))) throw err;
      await call("POST", `/api/sessions/${enc(sessionId)}/stop`, null, { timeoutMs: MEDIA_TIMEOUT_MS });
    }
  },

  /**
   * `quotedMessageId` turns the send into a reply. The id is engine-specific (whatsapp-web.js:
   * serialized `false_<chat>_<hash>`, Baileys: raw key id) — pass the inbound message's `id` as
   * received. An id the engine can't resolve fails the send with 404 (it is never sent unquoted).
   */
  async sendText(sessionId: string, chatId: string, text: string, opts: { quotedMessageId?: string } = {}): Promise<{ messageId: string }> {
    const res = await call("POST", `/api/sessions/${enc(sessionId)}/messages/send-text`, SendSchema, {
      body: { chatId, text, ...(opts.quotedMessageId ? { quotedMessageId: opts.quotedMessageId } : {}) },
      ...SEND_RETRY(),
    });
    return { messageId: res.messageId };
  },

  /** Shows ("typing" / "recording") or clears ("paused") the typing indicator in a chat. Both engines. */
  async sendChatState(sessionId: string, chatId: string, state: ChatState): Promise<void> {
    await call("POST", `/api/sessions/${enc(sessionId)}/chats/typing`, null, { body: { chatId, state }, retries: 1 });
  },

  /**
   * Marks a chat as read (blue ticks). whatsapp-web.js reads the whole chat and ignores
   * `messageIds`; Baileys acknowledges only the listed ids (or just the newest one when omitted),
   * so pass every message of a burst. Returns false when the gateway declined (`success: false`).
   */
  async markChatRead(sessionId: string, chatId: string, messageIds?: string[]): Promise<boolean> {
    const ids = messageIds?.filter(Boolean).slice(-100);
    const res = await call("POST", `/api/sessions/${enc(sessionId)}/chats/read`, SuccessSchema, {
      body: { chatId, ...(ids?.length ? { messageIds: ids } : {}) },
      retries: 1,
    });
    return res.success;
  },

  /**
   * `image` is a URL the gateway downloads, or the bytes themselves. The gateway's SSRF guard
   * (or its network) can refuse URLs the app reaches fine, so sendTenantImage prefers bytes.
   */
  async sendImage(sessionId: string, chatId: string, image: ImageSource, caption?: string): Promise<{ messageId: string }> {
    const source = "url" in image ? { url: image.url } : { base64: image.base64, mimetype: image.mimetype };
    const res = await call("POST", `/api/sessions/${enc(sessionId)}/messages/send-image`, SendSchema, {
      body: { chatId, ...source, ...(caption ? { caption } : {}) },
      timeoutMs: MEDIA_TIMEOUT_MS,
      ...SEND_RETRY(),
    });
    return { messageId: res.messageId };
  },
};

export type ImageSource = { url: string } | { base64: string; mimetype: string };

/** Sends get a fresh idempotency key per logical send, so retries of that send are deduped by OpenWA. */
function SEND_RETRY(): Pick<RequestOpts, "retries" | "idempotencyKey"> {
  return { retries: 2, idempotencyKey: randomUUID() };
}

const IMAGE_FETCH_TIMEOUT_MS = 15_000;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Downloads an image for a base64 send. Returns null (caller falls back to the URL) on any problem. */
async function downloadImage(url: string): Promise<{ base64: string; mimetype: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS), redirect: "follow", cache: "no-store" });
    const mimetype = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!res.ok || !mimetype.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > IMAGE_MAX_BYTES) return null;
    return { base64: buf.toString("base64"), mimetype };
  } catch {
    return null;
  }
}

async function connectedSessionId(tenantId: string): Promise<string> {
  const session = await prisma.whatsAppSession.findUnique({
    where: { tenantId },
    select: { openwaSessionId: true, status: true },
  });
  if (!session || session.status !== "CONNECTED") throw new WhatsAppNotConnectedError(tenantId);
  return session.openwaSessionId;
}

export async function sendTenantText(tenantId: string, chatId: string, text: string, opts: { quotedMessageId?: string } = {}): Promise<{ messageId: string }> {
  return openwa.sendText(await connectedSessionId(tenantId), chatId, text, opts);
}

/** Typing indicator for a tenant's chat. Throws WhatsAppNotConnectedError / OpenWaError like the senders. */
export async function sendTenantChatState(tenantId: string, chatId: string, state: ChatState): Promise<void> {
  await openwa.sendChatState(await connectedSessionId(tenantId), chatId, state);
}

/** Blue ticks for a tenant's chat (see openwa.markChatRead). */
export async function markTenantChatRead(tenantId: string, chatId: string, messageIds?: string[]): Promise<boolean> {
  return openwa.markChatRead(await connectedSessionId(tenantId), chatId, messageIds);
}

/**
 * Sends a product photo. The app downloads it and sends the bytes, because the gateway may be
 * unable to fetch our storage URL itself ("Media fetch failed"); if the download fails here,
 * the URL is handed to the gateway as a fallback.
 */
export async function sendTenantImage(tenantId: string, chatId: string, imageUrl: string, caption?: string): Promise<{ messageId: string }> {
  const sessionId = await connectedSessionId(tenantId);
  const bytes = await downloadImage(imageUrl);
  return openwa.sendImage(sessionId, chatId, bytes ?? { url: imageUrl }, caption);
}
