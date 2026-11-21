import { Prisma, type Conversation, type Customer, type Message, type MessageDirection, type MessageSender } from "@prisma/client";
import type { TenantDb } from "./tenant";
import { redis } from "./redis";
import { notifyQueue } from "./queues";
import { logger } from "./logger";
import { insensitive, isUniqueViolation } from "./db-compat";

/** Redis key holding the last MEMORY_CACHE_SIZE messages (JSON, oldest→newest). */
export const memoryKey = (tenantId: string, conversationId: string) => `mem:${tenantId}:${conversationId}`;
const MEMORY_TTL_S = 60 * 60;
const MEMORY_CACHE_SIZE = 50;
const MAX_NOTE = 500;

/**
 * Finds or creates the customer for a WhatsApp chat and their single conversation.
 * Bumps lastSeenAt and updates the display name when WhatsApp gives us one.
 */
export async function upsertCustomerConversation(
  db: TenantDb,
  input: { chatId: string; phone: string; name?: string },
): Promise<{ customer: Customer; conversation: Conversation }> {
  const name = input.name?.trim().slice(0, 100) || undefined;
  const now = new Date();

  let customer = await db.customer.findFirst({ where: { waChatId: input.chatId } });
  if (!customer) {
    try {
      // forTenant injects tenantId into creates; the cast only drops Prisma's compile-time requirement for it.
      customer = await db.customer.create({
        data: { waChatId: input.chatId, phone: input.phone, name: name ?? null, lastSeenAt: now } as Prisma.CustomerUncheckedCreateInput,
      });
    } catch (err) {
      // Another job created it concurrently (unique tenantId+waChatId): use that row.
      if (!isUniqueViolation(err)) throw err;
      customer = await db.customer.findFirstOrThrow({ where: { waChatId: input.chatId } });
    }
  }
  customer = await db.customer.update({
    where: { id: customer.id },
    data: { lastSeenAt: now, ...(name && name !== customer.name ? { name } : {}) },
  });

  const conversation = await db.conversation.upsert({
    where: { customerId: customer.id },
    create: { customerId: customer.id, tenantId: customer.tenantId },
    update: {},
  });
  return { customer, conversation };
}

/** Stores a message, bumps the conversation's lastMessageAt and invalidates the memory cache. */
export async function storeMessage(
  db: TenantDb,
  input: {
    conversationId: string;
    direction: MessageDirection;
    sender: MessageSender;
    type?: string;
    body: string;
    mediaUrl?: string;
    waMessageId?: string;
  },
): Promise<Message> {
  const conversation = await db.conversation.findUnique({ where: { id: input.conversationId }, select: { id: true, tenantId: true } });
  if (!conversation) throw new Error(`Conversation ${input.conversationId} not found for this tenant`);

  const now = new Date();
  const [message] = await db.$transaction([
    db.message.create({
      data: {
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        direction: input.direction,
        sender: input.sender,
        type: input.type ?? "text",
        body: input.body,
        mediaUrl: input.mediaUrl ?? null,
        waMessageId: input.waMessageId ?? null,
        createdAt: now,
      },
    }),
    db.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: now } }),
  ]);
  await redis().del(memoryKey(conversation.tenantId, conversation.id));
  return message;
}

function reviveMessages(raw: string): Message[] | null {
  try {
    const parsed = JSON.parse(raw) as (Omit<Message, "createdAt"> & { createdAt: string })[];
    if (!Array.isArray(parsed)) return null;
    return parsed.map((m) => ({ ...m, createdAt: new Date(m.createdAt) }));
  } catch {
    return null; // corrupt cache entry: treated as a miss and overwritten below
  }
}

/** Last `limit` messages, oldest→newest. Served from Redis `mem:{tenantId}:{conversationId}` when cached. */
export async function getRecentMessages(db: TenantDb, tenantId: string, conversationId: string, limit = 20): Promise<Message[]> {
  const key = memoryKey(tenantId, conversationId);
  const useCache = limit <= MEMORY_CACHE_SIZE;
  if (useCache) {
    const cached = await redis().get(key);
    const revived = cached ? reviveMessages(cached) : null;
    if (revived) return revived.slice(-limit);
  }

  const rows = await db.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: useCache ? MEMORY_CACHE_SIZE : limit,
  });
  const ordered = rows.reverse();
  if (useCache) await redis().set(key, JSON.stringify(ordered), "EX", MEMORY_TTL_S);
  return ordered.slice(-limit);
}

/**
 * Flags the conversation for a human and pauses the bot. Alerts the owner only when the
 * conversation was not already waiting for a human, so repeated requests don't spam them.
 *
 * The "was it already flagged?" decision is a conditional update, not read-then-write, so two
 * concurrent calls (e.g. the agent's request_human tool and a failed-job fallback) alert once.
 */
export async function flagNeedsHuman(db: TenantDb, tenantId: string, conversationId: string, reason: string): Promise<void> {
  const note = reason.trim().slice(0, MAX_NOTE) || "Customer needs help";
  const flag = { needsHuman: true, needsHumanNote: note, botPaused: true, botPausedAt: new Date() };

  const claimed = await db.conversation.updateMany({
    where: { id: conversationId, OR: [{ needsHuman: false }, { botPaused: false }] },
    data: flag,
  });
  if (claimed.count === 0) {
    // Either already flagged (refresh note and pause time, don't re-alert) or not this tenant's conversation.
    const refreshed = await db.conversation.updateMany({ where: { id: conversationId }, data: flag });
    if (refreshed.count === 0) throw new Error(`Conversation ${conversationId} not found for this tenant`);
    logger.info({ tenantId, conversationId }, "conversation already flagged for a human; owner not re-alerted");
    return;
  }
  await notifyQueue().add("owner-needs-human", { kind: "owner-needs-human", tenantId, conversationId, reason: note });
}

// ---------- dashboard inbox ----------

export type ConversationFilters = { needsHuman?: boolean; botPaused?: boolean; q?: string };

function conversationWhere(filters: ConversationFilters): Prisma.ConversationWhereInput {
  const where: Prisma.ConversationWhereInput = {};
  if (filters.needsHuman !== undefined) where.needsHuman = filters.needsHuman;
  if (filters.botPaused !== undefined) where.botPaused = filters.botPaused;
  const q = filters.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    where.customer = {
      OR: [{ name: { contains: q, ...insensitive() } }, ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : [])],
    };
  }
  return where;
}

/** Inbox page, newest activity first, cursor-paginated. */
export async function listConversations(db: TenantDb, filters: ConversationFilters, page: { cursor?: string; limit: number }) {
  const rows = await db.conversation.findMany({
    where: conversationWhere(filters),
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: page.limit + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    include: {
      customer: { select: { id: true, name: true, phone: true, _count: { select: { orders: true } } } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, type: true, direction: true, sender: true, createdAt: true } },
    },
  });
  const hasMore = rows.length > page.limit;
  const conversations = rows.slice(0, page.limit).map((c) => ({
    id: c.id,
    needsHuman: c.needsHuman,
    needsHumanNote: c.needsHumanNote,
    botPaused: c.botPaused,
    lastMessageAt: c.lastMessageAt,
    customer: { id: c.customer.id, name: c.customer.name, phone: c.customer.phone, orderCount: c.customer._count.orders },
    lastMessage: c.messages[0] ? { ...c.messages[0], body: c.messages[0].body.slice(0, 140) } : null,
  }));
  return { conversations, nextCursor: hasMore ? conversations[conversations.length - 1].id : null };
}

/** Tenant-wide totals for the inbox tabs (independent of the list filters). */
export async function conversationCounts(db: TenantDb): Promise<{ needsHuman: number; botPaused: number }> {
  const [needsHuman, botPaused] = await Promise.all([
    db.conversation.count({ where: { needsHuman: true } }),
    db.conversation.count({ where: { botPaused: true } }),
  ]);
  return { needsHuman, botPaused };
}
