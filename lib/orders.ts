import type { Order, OrderItem, OrderStatus, Prisma } from "@prisma/client";
import { forTenant, type TenantDb } from "./tenant";
import { notifyQueue, type NotifyJob } from "./queues";
import { logger } from "./logger";
import {
  ORDER_STATUSES,
  OrderValidationError,
  checkTransition,
  normalizeOrderFields,
  normalizeOrderItems,
  normalizeOrderNumber,
  priceOrderLines,
  summarizeOrderItems,
} from "./orders-rules";
import { insensitive } from "@/lib/db-compat";

export { OrderValidationError };

/** Thrown when the order does not exist in this tenant. */
export class OrderNotFoundError extends Error {
  constructor() {
    super("Order not found");
    this.name = "OrderNotFoundError";
  }
}

export type CreateOrderInput = {
  customerId: string;
  items: { productId: string; quantity: number }[];
  customerName: string;
  deliveryAddress: string;
  notes?: string;
};

/**
 * Notifications are enqueued AFTER the DB commit. If Redis is down the order still exists,
 * so we log loudly instead of failing the order (a thrown error would make the bot retry
 * and could create a duplicate order).
 */
async function enqueueNotify(job: NotifyJob, jobId: string) {
  try {
    await notifyQueue().add(job.kind, job, { jobId });
  } catch (err) {
    logger.error({ err, tenantId: job.tenantId, job }, "failed to enqueue notification after commit");
  }
}

/**
 * Creates an order with server-side prices inside one transaction on the tenant-scoped client.
 * Nested creates are not auto-scoped by forTenant, so tenantId is passed explicitly on them.
 */
export async function createOrder(tenantId: string, input: CreateOrderInput): Promise<Order & { items: OrderItem[] }> {
  const lines = normalizeOrderItems(input.items);
  const fields = normalizeOrderFields(input);
  const db = forTenant(tenantId);

  const order = await db.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: input.customerId }, select: { id: true } });
    if (!customer) throw new OrderValidationError("Customer not found.");

    const products = await tx.product.findMany({
      where: { id: { in: lines.map((l) => l.productId) } },
      select: { id: true, name: true, priceKobo: true, available: true, deletedAt: true },
    });
    const settings = await tx.botSettings.findUnique({ where: { tenantId }, select: { deliveryFeeKobo: true } });
    const priced = priceOrderLines(lines, products, settings?.deliveryFeeKobo ?? 0);

    // Atomic increment: concurrent orders serialize on the tenant row, numbers never collide.
    const { orderCounter } = await tx.tenant.update({
      where: { id: tenantId },
      data: { orderCounter: { increment: 1 } },
      select: { orderCounter: true },
    });

    return tx.order.create({
      data: {
        tenantId,
        number: `ORD-${orderCounter}`,
        customerId: customer.id,
        status: "NEW",
        subtotalKobo: priced.subtotalKobo,
        deliveryFeeKobo: priced.deliveryFeeKobo,
        totalKobo: priced.totalKobo,
        customerName: fields.customerName,
        deliveryAddress: fields.deliveryAddress,
        notes: fields.notes,
        items: { create: priced.lines.map((l) => ({ ...l, tenantId })) },
        events: { create: { tenantId, fromStatus: null, toStatus: "NEW" } },
      },
      include: { items: true },
    });
  });

  await enqueueNotify({ kind: "owner-new-order", tenantId, orderId: order.id }, `owner-new-order-${order.id}`);
  return order;
}

/**
 * Moves an order along the allowed status graph. Same status is a no-op (no event, no notification).
 * Uses a conditional update on the current status so two concurrent changes cannot both win.
 */
export async function changeOrderStatus(tenantId: string, orderId: string, toStatus: OrderStatus, byUserId: string | null): Promise<Order> {
  const db = forTenant(tenantId);
  const result = await db.$transaction(async (tx) => {
    const current = await tx.order.findUnique({ where: { id: orderId } });
    if (!current) throw new OrderNotFoundError();

    const check = checkTransition(current.status, toStatus);
    if (check === "same") return { order: current, eventId: null };
    if (check === "invalid") {
      throw new OrderValidationError(`An order that is ${current.status.toLowerCase().replace(/_/g, " ")} can't be changed to ${toStatus.toLowerCase().replace(/_/g, " ")}.`);
    }

    const updated = await tx.order.updateMany({ where: { id: orderId, status: current.status }, data: { status: toStatus } });
    if (updated.count !== 1) throw new OrderValidationError("This order was just changed by someone else. Refresh and try again.");

    const event = await tx.orderStatusEvent.create({
      data: { tenantId, orderId, fromStatus: current.status, toStatus, byUserId },
      select: { id: true },
    });
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    return { order, eventId: event.id };
  });

  if (result.eventId) {
    await enqueueNotify({ kind: "order-status", tenantId, orderId, status: toStatus }, `order-status-${result.eventId}`);
  }
  return result.order;
}

/** This customer's 5 most recent orders, optionally one order number. */
export async function getCustomerOrders(db: TenantDb, customerId: string, orderNumber?: string): Promise<(Order & { items: OrderItem[] })[]> {
  return db.order.findMany({
    where: { customerId, ...(orderNumber?.trim() ? { number: normalizeOrderNumber(orderNumber) } : {}) },
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
}

// ---------- dashboard list / export queries ----------

export type OrderFilters = { status?: OrderStatus; from?: Date; to?: Date; q?: string };

/** `from` inclusive, `to` exclusive. q matches order number or customer phone digits. */
export function orderWhere(filters: OrderFilters): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.from || filters.to) where.createdAt = { ...(filters.from && { gte: filters.from }), ...(filters.to && { lt: filters.to }) };
  const q = filters.q?.trim();
  if (q) {
    const or: Prisma.OrderWhereInput[] = [{ number: { contains: q, ...insensitive() } }];
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 3) or.push({ customer: { phone: { contains: digits } } });
    where.OR = or;
  }
  return where;
}

export async function listOrders(db: TenantDb, filters: OrderFilters, page: { cursor?: string; limit: number }) {
  const rows = await db.order.findMany({
    where: orderWhere(filters),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: page.limit + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      number: true,
      status: true,
      totalKobo: true,
      customerName: true,
      createdAt: true,
      customer: { select: { phone: true } },
      _count: { select: { items: true } },
      items: { select: { quantity: true, nameSnapshot: true }, orderBy: { id: "asc" } },
    },
  });
  const hasMore = rows.length > page.limit;
  const items = rows.slice(0, page.limit).map((r) => ({
    id: r.id,
    number: r.number,
    status: r.status,
    totalKobo: r.totalKobo,
    customerName: r.customerName,
    customerPhone: r.customer.phone,
    itemCount: r._count.items,
    itemSummary: summarizeOrderItems(r.items),
    createdAt: r.createdAt,
  }));
  return { orders: items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

/**
 * Orders per status for the status tabs: applies the q/date filters but deliberately ignores
 * `status`, so every tab shows its own count. Statuses with no orders are 0.
 */
export async function countOrdersByStatus(db: TenantDb, filters: OrderFilters): Promise<Record<OrderStatus, number>> {
  const groups = await db.order.groupBy({
    by: ["status"],
    where: orderWhere({ ...filters, status: undefined }),
    _count: { _all: true },
  });
  const counts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
  for (const g of groups) counts[g.status] = g._count._all;
  return counts;
}

export const EXPORT_MAX_ROWS = 10_000;

export async function listOrdersForExport(db: TenantDb, filters: OrderFilters) {
  const rows = await db.order.findMany({
    where: orderWhere(filters),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: EXPORT_MAX_ROWS,
    include: { items: { select: { nameSnapshot: true, quantity: true, unitPriceKobo: true } }, customer: { select: { phone: true } } },
  });
  return rows.map((o) => ({ ...o, customerPhone: o.customer.phone }));
}
