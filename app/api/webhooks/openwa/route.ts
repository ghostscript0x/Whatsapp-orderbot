import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { decrypt, sha256 } from "@/lib/crypto";
import { jsonError, route } from "@/lib/api";
import { logger } from "@/lib/logger";
import { rateLimit, redis, setOnce } from "@/lib/redis";
import { inboundQueue, sessionQueue } from "@/lib/queues";
import { LAST_INBOUND_TTL_S, lastInboundKey, parseWebhook, peekSessionId, toInboundJob, verifySignature, SESSION_EVENTS, type WebhookPayload } from "@/lib/webhook";
import { isUniqueViolation } from "@/lib/db-compat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEDUPE_TTL_S = 86_400;
const TENANT_MSG_LIMIT = 120; // inbound messages per tenant per window
const TENANT_MSG_WINDOW_S = 60;

/**
 * Public OpenWA webhook. OpenWA retries any non-2xx (and timeouts) with exponential backoff up to
 * the webhook's retryCount, reusing the same idempotencyKey, then records a delivery failure.
 * So: 2xx = accepted or deliberately ignored; 401/404 = rejected (retries are bounded and the
 * failure shows up in OpenWA's delivery-failure log); 429/5xx = "try again later".
 */
export const POST = route(async (req: Request): Promise<Response> => {
  const raw = Buffer.from(await req.arrayBuffer());

  let json: unknown;
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch {
    return jsonError(400, "bad_request", "Body must be valid JSON");
  }

  const openwaSessionId = peekSessionId(json);
  if (!openwaSessionId) return jsonError(400, "bad_request", "Missing sessionId");

  const session = await prisma.whatsAppSession.findUnique({
    where: { openwaSessionId },
    select: { id: true, tenantId: true, webhookSecretEnc: true, tenant: { select: { status: true } } },
  });
  if (!session) return jsonError(404, "not_found", "Unknown session");

  if (!verifySignature(raw, req.headers, decrypt(session.webhookSecretEnc))) {
    logger.warn({ tenantId: session.tenantId, openwaSessionId }, "openwa webhook: bad signature");
    return jsonError(401, "unauthorized", "Invalid signature");
  }

  const log = logger.child({ tenantId: session.tenantId, openwaSessionId });

  let payload: WebhookPayload;
  try {
    payload = parseWebhook(json);
  } catch (err) {
    if (!(err instanceof ZodError)) throw err;
    // Signed by the gateway but not a shape we understand: retrying won't change it, so ack.
    log.warn({ issues: err.issues }, "openwa webhook: unrecognised payload");
    return NextResponse.json({ ok: true, ignored: "invalid_payload" });
  }

  // Suspended tenants: acknowledged and ignored (PRD 6.8).
  if (session.tenant.status === "SUSPENDED") return NextResponse.json({ ok: true, ignored: "tenant_suspended" });

  await prisma.whatsAppSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });

  const isMessage = payload.event === "message.received";
  if (isMessage && !(await rateLimit(`wa-webhook:${session.tenantId}`, TENANT_MSG_LIMIT, TENANT_MSG_WINDOW_S))) {
    log.warn("openwa webhook: tenant rate limit hit");
    return jsonError(429, "rate_limited", "Too many requests");
  }

  const dedupeKey = `dedupe:${payload.idempotencyKey}`;
  if (!(await setOnce(dedupeKey, DEDUPE_TTL_S))) return NextResponse.json({ ok: true, duplicate: true });

  const eventName = payload.event === "other" ? payload.originalEvent : payload.event;
  await recordEvent(session.tenantId, payload.idempotencyKey, eventName, log);
  try {
    // BullMQ job ids may not contain ":"; hash the key so any gateway id format is safe.
    const jobId = sha256(payload.idempotencyKey);
    if (isMessage) {
      const decision = toInboundJob(payload, { tenantId: session.tenantId });
      if (!decision.ok) {
        await markIgnored(payload.idempotencyKey, decision.reason, log);
        return NextResponse.json({ ok: true, ignored: decision.reason });
      }
      await inboundQueue().add("inbound", decision.job, { jobId });
      await noteInbound(session.tenantId, decision.job.chatId, log);
    } else if ((SESSION_EVENTS as readonly string[]).includes(payload.event)) {
      await sessionQueue().add(
        payload.event,
        { tenantId: session.tenantId, sessionId: payload.sessionId, event: payload.event, payload: payload.data },
        { jobId },
      );
    } else {
      await markIgnored(payload.idempotencyKey, "unsubscribed event", log);
      return NextResponse.json({ ok: true, ignored: "event" });
    }
  } catch (err) {
    // Release the dedupe claim so OpenWA's retry can be accepted.
    await redis().del(dedupeKey);
    log.error({ err, event: eventName }, "openwa webhook: failed to accept delivery");
    return jsonError(500, "internal_error", "Could not accept event");
  }

  return NextResponse.json({ ok: true });
});

/** Audit rows are best effort: a failure here must never fail the ack. */
async function recordEvent(tenantId: string, idempotencyKey: string, event: string, log: typeof logger) {
  try {
    await prisma.webhookEvent.create({ data: { tenantId, idempotencyKey, event } });
  } catch (err) {
    if (isUniqueViolation(err)) return; // already recorded (gateway retry)
    log.error({ err, idempotencyKey }, "openwa webhook: could not record WebhookEvent");
  }
}

async function markIgnored(idempotencyKey: string, reason: string, log: typeof logger) {
  try {
    await prisma.webhookEvent.updateMany({ where: { idempotencyKey }, data: { processedAt: new Date(), error: `ignored: ${reason}` } });
  } catch (err) {
    log.error({ err, idempotencyKey }, "openwa webhook: could not mark WebhookEvent ignored");
  }
}

/**
 * Burst signal for the worker (see lastInboundKey). Only timing depends on it, so a Redis hiccup
 * here must not fail a delivery that is already queued: log and carry on.
 */
async function noteInbound(tenantId: string, chatId: string, log: typeof logger) {
  try {
    await redis().set(lastInboundKey(tenantId, chatId), String(Date.now()), "EX", LAST_INBOUND_TTL_S);
  } catch (err) {
    log.warn({ err }, "openwa webhook: could not record last-inbound time");
  }
}
