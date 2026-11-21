import { Queue } from "bullmq";
import type { OrderStatus } from "@prisma/client";
import type { InboundType } from "./humanize";
import { bullConnection } from "./redis";

export const QUEUE_INBOUND = "inbound-message";
export const QUEUE_SESSION = "session-events";
export const QUEUE_NOTIFY = "notifications";

/** Job payloads shared between the webhook route (producer) and the worker (consumer). */
export type InboundMessageJob = {
  tenantId: string;
  sessionId: string;
  idempotencyKey: string;
  chatId: string; // WhatsApp chat id, e.g. "2348012345678@c.us"
  phone: string; // E.164 digits without "+"
  pushName?: string;
  messageId: string;
  type: InboundType;
  body: string;
  mediaUrl?: string;
  timestamp: number; // epoch ms
};

export type SessionEventJob = {
  tenantId: string;
  sessionId: string;
  event: string; // e.g. "session.status", "session.qr", "session.disconnected"
  payload: Record<string, unknown>;
};

export type NotifyJob =
  /**
   * `status` is the status the order moved to. The worker announces THAT status, not whatever the
   * order is in by the time the job runs (two quick changes must produce two different messages).
   * Optional only for jobs queued before the field existed.
   */
  | { kind: "order-status"; tenantId: string; orderId: string; status?: OrderStatus }
  | { kind: "owner-new-order"; tenantId: string; orderId: string }
  | { kind: "owner-needs-human"; tenantId: string; conversationId: string; reason: string }
  | { kind: "owner-disconnected"; tenantId: string };

const globalQ = globalThis as unknown as { queues?: Record<string, Queue> };

function queue<T>(name: string): Queue<T> {
  globalQ.queues ??= {};
  globalQ.queues[name] ??= new Queue(name, {
    connection: bullConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });
  return globalQ.queues[name] as Queue<T>;
}

export const inboundQueue = () => queue<InboundMessageJob>(QUEUE_INBOUND);
export const sessionQueue = () => queue<SessionEventJob>(QUEUE_SESSION);
export const notifyQueue = () => queue<NotifyJob>(QUEUE_NOTIFY);
