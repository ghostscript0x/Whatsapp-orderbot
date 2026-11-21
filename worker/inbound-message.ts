import { setTimeout as sleep } from "node:timers/promises";
import { DelayedError, Worker, type Job } from "bullmq";
import type { Conversation } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { forTenant } from "../lib/tenant";
import { logger } from "../lib/logger";
import { acquireLock, bullConnection, rateLimit, redis } from "../lib/redis";
import { QUEUE_INBOUND, type InboundMessageJob } from "../lib/queues";
import { flagNeedsHuman, getRecentMessages, storeMessage, upsertCustomerConversation } from "../lib/conversations";
import { OpenWaError, markTenantChatRead, sendTenantChatState, sendTenantText } from "../lib/openwa";
import { lastInboundKey, type InboundJob } from "../lib/webhook";
import { createReplier, decideBurst, unansweredInbound, type Replier } from "../lib/humanize";
import { FALLBACK_REPLY, runAgent, toBotConfig } from "../lib/agent";
import { buildCustomerProfile } from "../lib/agent/profile";

const CONCURRENCY = 10;
// Covers the agent (several LLM round trips) plus typing pauses; matches the BullMQ lockDuration.
const LOCK_TTL_MS = 120_000;
const LOCK_RETRY_DELAY_MS = 2_000;
const CHAT_RATE_LIMIT = 20;
const CHAT_RATE_WINDOW_S = 60;
const HISTORY_SIZE = 20;
/** Messages loaded per turn: history + the unanswered burst. */
const LOAD_SIZE = 40;
/** Spread wake-ups of delayed burst jobs a little. */
const WAKE_JITTER_MS = 300;

type Log = typeof logger;

/**
 * Processes one inbound WhatsApp message: per-chat lock, store, then the burst debounce decides
 * which job answers (the newest message's, once the customer goes quiet). The answering job marks
 * the chat read, shows "typing…", runs the agent on the whole burst and sends the reply as
 * 1-3 bubbles with natural pauses. Exported for tests; production code uses startInboundWorker().
 */
export async function processInboundJob(job: Job<InboundMessageJob>, token?: string): Promise<void> {
  const data: InboundJob = job.data;
  const log = logger.child({ tenantId: data.tenantId, jobId: job.id, queue: QUEUE_INBOUND });

  const tenant = await prisma.tenant.findUnique({ where: { id: data.tenantId }, select: { status: true, name: true, currency: true, timezone: true } });
  if (!tenant || tenant.status !== "ACTIVE") {
    log.info({ status: tenant?.status ?? "missing" }, "tenant not active; dropping inbound message");
    return;
  }

  const release = await acquireLock(`lock:${data.tenantId}:${data.chatId}`, LOCK_TTL_MS);
  if (!release) {
    // Another message from this chat is being handled. Re-queue without spending an attempt.
    log.debug("chat lock busy; delaying job");
    await job.moveToDelayed(Date.now() + LOCK_RETRY_DELAY_MS + Math.floor(Math.random() * 1000), token);
    throw new DelayedError();
  }

  const db = forTenant(data.tenantId);
  let conversation: Conversation | undefined;
  let replier: Replier | undefined;
  try {
    const upserted = await upsertCustomerConversation(db, { chatId: data.chatId, phone: data.phone, name: data.pushName });
    conversation = upserted.conversation;
    const { customer } = upserted;

    // Retries and burst wake-ups must not store the inbound message (or count it against the rate limit) twice.
    let inbound = await db.message.findFirst({ where: { conversationId: conversation.id, direction: "IN", waMessageId: data.messageId } });
    if (!inbound) {
      if (!(await rateLimit(`chat:${data.tenantId}:${data.chatId}`, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_S))) {
        log.warn({ conversationId: conversation.id }, "chat rate limit exceeded; ignoring message");
        return;
      }
      inbound = await storeMessage(db, {
        conversationId: conversation.id,
        direction: "IN",
        sender: "CUSTOMER",
        type: data.type,
        body: data.body,
        mediaUrl: data.mediaUrl,
        waMessageId: data.messageId,
      });
    }

    if (conversation.botPaused) {
      log.info({ conversationId: conversation.id }, "bot paused for conversation; not replying");
      return;
    }

    const recent = await getRecentMessages(db, data.tenantId, conversation.id, LOAD_SIZE);
    const lastAccepted = Number(await redis().get(lastInboundKey(data.tenantId, data.chatId))) || null;
    const decision = decideBurst({ ownId: inbound.id, unanswered: unansweredInbound(recent), nowMs: Date.now(), lastAcceptedMs: lastAccepted });
    if (decision.action === "answered" || decision.action === "superseded") {
      log.debug({ conversationId: conversation.id, decision: decision.action }, "burst handled by another job");
      return;
    }
    if (decision.action === "wait") {
      await job.moveToDelayed(decision.untilMs + Math.floor(Math.random() * WAKE_JITTER_MS), token);
      throw new DelayedError();
    }

    const batchIds = new Set(decision.batch.map((b) => b.id));
    const batch = recent.filter((m) => batchIds.has(m.id));
    const firstBatchIdx = recent.findIndex((m) => batchIds.has(m.id));
    const history = recent.slice(0, firstBatchIdx).slice(-HISTORY_SIZE);
    const newest = batch[batch.length - 1];
    const replyStartedAt = Date.now();

    const conversationId = conversation.id;
    replier = createReplier(chatIo(data, conversationId, db, log));

    const [settingsRow, customerProfile] = await Promise.all([
      db.botSettings.findFirst(),
      buildCustomerProfile(db, customer, history.at(-1)?.createdAt),
      replier.seen(batch.map((m) => m.waMessageId).filter((id): id is string => Boolean(id)), newest.createdAt.getTime()),
    ]);
    await replier.startTyping();

    const result = await runAgent({
      tenantId: data.tenantId,
      db,
      customer,
      conversation,
      recentMessages: history,
      inbound: batch.map((m) => ({ type: m.type, body: m.body })),
      customerProfile,
      chatId: data.chatId,
      tenant: { name: tenant.name, currency: tenant.currency, timezone: tenant.timezone },
      settings: toBotConfig(settingsRow),
      log,
      pause: (ms) => sleep(ms),
      onInterimText: async (text) => {
        await replier?.say(text);
        await replier?.startTyping(); // still working on the rest
      },
    });

    // If the customer wrote again while we were busy, quote the message we're answering so the
    // reply reads in context (their new message gets its own turn next).
    const quote = (await newerMessageArrived(data, replyStartedAt)) ? (newest.waMessageId ?? undefined) : undefined;
    let sentBubbles = 0;
    for (const [i, text] of result.replies.entries()) sentBubbles += (await replier.say(text, i === 0 ? { quotedMessageId: quote } : {})).length;
    await replier.stopTyping();
    log.info(
      { conversationId, burst: batch.length, bubbles: sentBubbles, iterations: result.iterations, handedOff: result.handedOff, quoted: Boolean(quote), ms: Date.now() - replyStartedAt },
      "inbound burst handled",
    );
  } catch (err) {
    if (err instanceof DelayedError) throw err;
    await replier?.stopTyping();
    if (replier && replier.sent > 0) {
      // Part of the reply already reached the customer. A retry would see the burst as answered
      // (or repeat itself), so don't retry: apologise once and bring in a human instead.
      log.error({ err, conversationId: conversation?.id, sentBubbles: replier.sent }, "reply only partially sent; handing off instead of retrying");
      if (conversation) await giveUp(db, data, conversation.id, log);
      return;
    }
    const attempts = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade + 1 >= attempts;
    log.error({ err, attemptsMade: job.attemptsMade, attempts, isFinalAttempt }, "inbound message failed");
    if (isFinalAttempt && conversation) await giveUp(db, data, conversation.id, log);
    throw err;
  } finally {
    await release();
  }
}

/** WhatsApp side of a reply: sends + stores bubbles, typing indicator, read receipts. */
function chatIo(data: InboundJob, conversationId: string, db: ReturnType<typeof forTenant>, log: Log) {
  const store = (text: string, messageId: string) =>
    storeMessage(db, { conversationId, direction: "OUT", sender: "BOT", type: "text", body: text, waMessageId: messageId });
  return {
    async sendText(text: string, quotedMessageId?: string) {
      let res: { messageId: string };
      try {
        res = await sendTenantText(data.tenantId, data.chatId, text, { quotedMessageId });
      } catch (err) {
        // OpenWA fails a quoted send it can't resolve (404) instead of sending it unquoted: send plain.
        if (!(quotedMessageId && err instanceof OpenWaError && err.status === 404)) throw err;
        log.warn({ conversationId }, "quoted message not found by the gateway; sending without quote");
        res = await sendTenantText(data.tenantId, data.chatId, text);
      }
      await store(text, res.messageId);
    },
    setTyping: (state: "typing" | "paused") => sendTenantChatState(data.tenantId, data.chatId, state),
    async markRead(ids: string[]) {
      const ok = await markTenantChatRead(data.tenantId, data.chatId, ids);
      if (!ok) log.debug({ conversationId }, "gateway declined to mark chat read");
    },
    sleep: (ms: number) => sleep(ms),
    now: () => Date.now(),
    warn: (err: unknown, what: string) => log.warn({ err, conversationId }, `${what} failed (cosmetic; reply continues)`),
  };
}

async function newerMessageArrived(data: InboundJob, sinceMs: number): Promise<boolean> {
  const last = Number(await redis().get(lastInboundKey(data.tenantId, data.chatId)));
  return Number.isFinite(last) && last > sinceMs;
}

/** Last attempt failed: tell the customer politely and flag the chat for a human. */
async function giveUp(db: ReturnType<typeof forTenant>, data: InboundJob, conversationId: string, log: Log) {
  try {
    await flagNeedsHuman(db, data.tenantId, conversationId, "The bot failed to handle a message");
  } catch (err) {
    log.error({ err, conversationId }, "failed to flag conversation for a human after final attempt");
  }
  try {
    const { messageId } = await sendTenantText(data.tenantId, data.chatId, FALLBACK_REPLY);
    await storeMessage(db, { conversationId, direction: "OUT", sender: "BOT", type: "text", body: FALLBACK_REPLY, waMessageId: messageId });
  } catch (err) {
    log.error({ err, conversationId }, "failed to send fallback reply after final attempt");
  }
}

export function startInboundWorker(): Worker<InboundMessageJob> {
  return new Worker<InboundMessageJob>(QUEUE_INBOUND, processInboundJob, {
    connection: bullConnection(),
    concurrency: CONCURRENCY,
    // The agent can take several LLM round trips plus typing pauses; keep the BullMQ job lock comfortably longer.
    lockDuration: LOCK_TTL_MS,
  });
}
