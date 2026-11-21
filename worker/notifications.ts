import { Worker, type Job } from "bullmq";
import { bullConnection } from "../lib/redis";
import { QUEUE_NOTIFY, type NotifyJob } from "../lib/queues";
import { forTenant, type TenantDb } from "../lib/tenant";
import { logger } from "../lib/logger";
import { env } from "../lib/env";
import { sendEmail } from "../lib/email";
import { formatMoney } from "../lib/money";
import { chatIdFromPhone } from "../lib/utils";
import { sendTenantText, WhatsAppNotConnectedError } from "../lib/openwa";
import { storeMessage } from "../lib/conversations";
import { customerStatusMessage, ownerDisconnectedEmail, ownerNeedsHumanMessage, ownerNewOrderMessage } from "../lib/notification-messages";

type JobOf<K extends NotifyJob["kind"]> = Extract<NotifyJob, { kind: K }>;

const dashboardUrl = (path: string) => `${env().APP_URL.replace(/\/+$/, "")}/dashboard/${path}`;

async function tenantInfo(db: TenantDb, tenantId: string): Promise<{ name: string; currency: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { name: true, currency: true } });
  if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
  return tenant;
}

/**
 * Sends via the tenant's WhatsApp. When WhatsApp is not connected, retrying won't help:
 * log a warning and let the job complete. Any other error propagates so BullMQ retries.
 */
async function sendOrSkip(tenantId: string, chatId: string, text: string, what: string): Promise<{ messageId: string } | null> {
  try {
    return await sendTenantText(tenantId, chatId, text);
  } catch (err) {
    if (err instanceof WhatsAppNotConnectedError) {
      logger.warn({ tenantId, what }, "WhatsApp not connected; notification skipped");
      return null;
    }
    throw err;
  }
}

async function ownerAlertChat(db: TenantDb, tenantId: string, what: string): Promise<string | null> {
  const settings = await db.botSettings.findUnique({ where: { tenantId }, select: { ownerAlertPhone: true } });
  const phone = settings?.ownerAlertPhone?.replace(/\D/g, "");
  if (!phone) {
    logger.warn({ tenantId, what }, "no ownerAlertPhone configured; owner alert skipped");
    return null;
  }
  return chatIdFromPhone(phone);
}

async function handleOrderStatus(job: JobOf<"order-status">) {
  const db = forTenant(job.tenantId);
  const order = await db.order.findUnique({
    where: { id: job.orderId },
    include: { customer: { select: { waChatId: true, conversation: { select: { id: true } } } } },
  });
  if (!order) {
    logger.warn({ tenantId: job.tenantId, orderId: job.orderId }, "order-status: order no longer exists");
    return;
  }
  const status = job.status ?? order.status;
  // A retried "confirmed"/"on its way" job must not reach the customer after the order was cancelled.
  if (order.status === "CANCELLED" && status !== "CANCELLED") {
    logger.info({ tenantId: job.tenantId, orderId: order.id, status }, "order-status: order since cancelled; stale update skipped");
    return;
  }

  const [settings, tenant] = await Promise.all([
    db.botSettings.findUnique({ where: { tenantId: job.tenantId }, select: { statusTemplates: true } }),
    tenantInfo(db, job.tenantId),
  ]);
  const text = customerStatusMessage({
    status,
    statusTemplates: settings?.statusTemplates,
    orderNumber: order.number,
    customerName: order.customerName,
    total: formatMoney(order.totalKobo, tenant.currency),
    businessName: tenant.name,
  });
  if (!text) return;

  const sent = await sendOrSkip(job.tenantId, order.customer.waChatId, text, "order-status");
  const conversationId = order.customer.conversation?.id;
  if (!sent || !conversationId) return;

  // The customer already has the message. If recording it fails, rethrowing would make BullMQ
  // retry and send it a second time, so log loudly and finish instead.
  try {
    await storeMessage(db, { conversationId, direction: "OUT", sender: "BOT", body: text, waMessageId: sent.messageId });
  } catch (err) {
    logger.error({ err, tenantId: job.tenantId, orderId: order.id }, "order-status: sent but could not store the message in the conversation");
  }
}

async function handleOwnerNewOrder(job: JobOf<"owner-new-order">) {
  const db = forTenant(job.tenantId);
  const chatId = await ownerAlertChat(db, job.tenantId, "owner-new-order");
  if (!chatId) return;
  const order = await db.order.findUnique({
    where: { id: job.orderId },
    include: { items: { orderBy: { id: "asc" } }, customer: { select: { phone: true } } },
  });
  if (!order) {
    logger.warn({ tenantId: job.tenantId, orderId: job.orderId }, "owner-new-order: order no longer exists");
    return;
  }
  const { currency } = await tenantInfo(db, job.tenantId);
  const money = (kobo: number) => formatMoney(kobo, currency);
  const text = ownerNewOrderMessage({
    orderNumber: order.number,
    total: money(order.totalKobo),
    deliveryFee: order.deliveryFeeKobo > 0 ? money(order.deliveryFeeKobo) : null,
    items: order.items.map((i) => ({ quantity: i.quantity, name: i.nameSnapshot, lineTotal: money(i.unitPriceKobo * i.quantity) })),
    customerName: order.customerName,
    customerPhone: order.customer.phone,
    deliveryAddress: order.deliveryAddress,
    notes: order.notes,
    link: dashboardUrl(`orders/${order.id}`),
  });
  await sendOrSkip(job.tenantId, chatId, text, "owner-new-order");
}

async function handleOwnerNeedsHuman(job: JobOf<"owner-needs-human">) {
  const db = forTenant(job.tenantId);
  const chatId = await ownerAlertChat(db, job.tenantId, "owner-needs-human");
  if (!chatId) return;
  const conversation = await db.conversation.findUnique({
    where: { id: job.conversationId },
    include: { customer: { select: { name: true, phone: true } } },
  });
  if (!conversation) {
    logger.warn({ tenantId: job.tenantId, conversationId: job.conversationId }, "owner-needs-human: conversation no longer exists");
    return;
  }
  const text = ownerNeedsHumanMessage({
    customerName: conversation.customer.name,
    customerPhone: conversation.customer.phone,
    reason: job.reason,
    link: dashboardUrl(`conversations/${conversation.id}`),
  });
  await sendOrSkip(job.tenantId, chatId, text, "owner-needs-human");
}

async function handleOwnerDisconnected(job: JobOf<"owner-disconnected">) {
  const db = forTenant(job.tenantId);
  const [tenant, owners] = await Promise.all([
    tenantInfo(db, job.tenantId),
    db.membership.findMany({ where: { role: "OWNER" }, select: { user: { select: { email: true, name: true } } } }),
  ]);
  if (owners.length === 0) {
    logger.warn({ tenantId: job.tenantId }, "owner-disconnected: tenant has no owners to email");
    return;
  }
  for (const { user } of owners) {
    const { subject, text } = ownerDisconnectedEmail({ ownerName: user.name, businessName: tenant.name, link: dashboardUrl("whatsapp") });
    await sendEmail(user.email, subject, text);
  }
}

export async function processNotifyJob(job: Job<NotifyJob>): Promise<void> {
  const data = job.data;
  switch (data.kind) {
    case "order-status":
      return handleOrderStatus(data);
    case "owner-new-order":
      return handleOwnerNewOrder(data);
    case "owner-needs-human":
      return handleOwnerNeedsHuman(data);
    case "owner-disconnected":
      return handleOwnerDisconnected(data);
    default: {
      const unknown: never = data;
      throw new Error(`Unknown notify job kind: ${JSON.stringify(unknown)}`);
    }
  }
}

export function startNotificationsWorker(): Worker<NotifyJob> {
  return new Worker<NotifyJob>(QUEUE_NOTIFY, processNotifyJob, { connection: bullConnection(), concurrency: 5 });
}
