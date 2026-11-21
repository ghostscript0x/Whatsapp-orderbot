import { NextResponse } from "next/server";
import { z } from "zod";
import { route, parseJson, requireTenant, errors } from "@/lib/api";
import { changeOrderStatus, OrderNotFoundError, OrderValidationError } from "@/lib/orders";
import { ORDER_STATUSES, nextStatuses } from "@/lib/orders-rules";

type Params = { params: Promise<{ id: string }> };

export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireTenant();
  const { id } = await params;
  const order = await ctx.db.order.findUnique({
    where: { id },
    include: {
      items: { orderBy: { id: "asc" } },
      customer: { select: { id: true, name: true, phone: true, conversation: { select: { id: true } } } },
      events: { orderBy: { createdAt: "asc" }, include: { byUser: { select: { name: true } } } },
    },
  });
  if (!order) throw errors.notFound("Order");
  const tenant = await ctx.db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { currency: true } });

  const { customer, events, ...rest } = order;
  return NextResponse.json({
    order: {
      ...rest,
      customer: { id: customer.id, name: customer.name, phone: customer.phone },
      conversationId: customer.conversation?.id ?? null,
      events: events.map((e) => ({ id: e.id, fromStatus: e.fromStatus, toStatus: e.toStatus, createdAt: e.createdAt, byUserName: e.byUser?.name ?? null })),
      allowedNext: nextStatuses(order.status),
    },
    currency: tenant?.currency ?? "NGN",
  });
});

const patchSchema = z.object({ status: z.enum(ORDER_STATUSES) }).strict();

export const PATCH = route(async (req, { params }: Params) => {
  const ctx = await requireTenant();
  const { id } = await params;
  const { status } = await parseJson(req, patchSchema);
  try {
    const order = await changeOrderStatus(ctx.tenantId, id, status, ctx.userId);
    return NextResponse.json({ order: { id: order.id, status: order.status, updatedAt: order.updatedAt, allowedNext: nextStatuses(order.status) } });
  } catch (err) {
    if (err instanceof OrderNotFoundError) throw errors.notFound("Order");
    if (err instanceof OrderValidationError) throw errors.conflict(err.message);
    throw err;
  }
});
