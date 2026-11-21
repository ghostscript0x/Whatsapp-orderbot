import { Worker, type Job } from "bullmq";
import type { Prisma, WaStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { bullConnection } from "../lib/redis";
import { notifyQueue, QUEUE_SESSION, type SessionEventJob } from "../lib/queues";
import { mapOpenWaStatus, type OpenWaStatus } from "../lib/openwa";

const KNOWN_STATUSES = new Set<string>(["created", "initializing", "qr_ready", "authenticating", "ready", "disconnected", "action_required", "failed"]);

/** OpenWA disconnect reasons that mean the device was unlinked and a new scan is required. */
const UNLINKED_REASON = /logout|logged.?out|unlink|unpaired|removed|conflict|replaced|banned/i;

/**
 * Pure: decides the WhatsAppSession update for a session event, and whether the owner
 * should be told the bot went offline. Exported for unit tests.
 */
export function planSessionUpdate(
  job: Pick<SessionEventJob, "event" | "payload">,
  current: WaStatus,
): { data: Prisma.WhatsAppSessionUpdateInput; notifyOwner: boolean } | null {
  const p = job.payload;
  const now = new Date();
  switch (job.event) {
    case "session.qr":
      return typeof p.qr === "string" ? { data: { status: "QR_PENDING", qr: p.qr, lastSeenAt: now }, notifyOwner: false } : null;
    case "session.authenticated":
      return {
        data: { status: "CONNECTED", qr: null, lastSeenAt: now, ...(typeof p.phone === "string" && p.phone ? { phone: p.phone } : {}) },
        notifyOwner: false,
      };
    case "session.status": {
      if (typeof p.status !== "string" || !KNOWN_STATUSES.has(p.status)) return null;
      const status = mapOpenWaStatus(p.status as OpenWaStatus);
      return {
        data: { status, lastSeenAt: now, ...(status === "QR_PENDING" ? {} : { qr: null }) },
        notifyOwner: current === "CONNECTED" && (status === "DISCONNECTED" || status === "NEEDS_RESCAN"),
      };
    }
    case "session.disconnected": {
      const reason = typeof p.reason === "string" ? p.reason : JSON.stringify(p.reason ?? "");
      const status: WaStatus = UNLINKED_REASON.test(reason) ? "NEEDS_RESCAN" : "DISCONNECTED";
      return { data: { status, qr: null, lastSeenAt: now }, notifyOwner: current === "CONNECTED" };
    }
    default:
      return null;
  }
}

async function handle(job: Job<SessionEventJob>) {
  const { tenantId, sessionId, event } = job.data;
  const log = logger.child({ tenantId, jobId: job.id, event });

  const session = await prisma.whatsAppSession.findFirst({ where: { tenantId, openwaSessionId: sessionId }, select: { id: true, status: true } });
  if (!session) {
    log.warn("session event for unknown or replaced session; skipping");
    return;
  }

  const plan = planSessionUpdate(job.data, session.status);
  if (!plan) {
    log.warn({ payload: job.data.payload }, "session event without a usable payload; skipping");
    return;
  }

  await prisma.whatsAppSession.update({ where: { id: session.id }, data: plan.data });
  if (plan.notifyOwner) {
    await notifyQueue().add("owner-disconnected", { kind: "owner-disconnected", tenantId }, { jobId: `owner-disconnected-${job.id}` });
  }
  log.info({ status: plan.data.status, notified: plan.notifyOwner }, "whatsapp session updated");
}

export function startSessionWorker(): Worker {
  return new Worker<SessionEventJob>(QUEUE_SESSION, handle, { connection: bullConnection(), concurrency: 5 });
}
