import { NextResponse } from "next/server";
import { z } from "zod";
import { parseQuery, route, requireTenant } from "@/lib/api";
import { countOrdersByStatus, listOrders } from "@/lib/orders";
import { orderFilterSchema } from "./_filters";

const querySchema = orderFilterSchema.extend({
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * GET /api/orders?status=&from=&to=&q=&cursor=&limit=
 * -> { orders: [{ id, number, status, totalKobo, customerName, customerPhone, itemCount, itemSummary, createdAt }],
 *      nextCursor, counts: Record<OrderStatus, number> (q/date filters only, not status), currency }
 */
export const GET = route(async (req) => {
  const ctx = await requireTenant();
  const { cursor, limit, ...filters } = parseQuery(req, querySchema);
  const [page, counts, tenant] = await Promise.all([
    listOrders(ctx.db, filters, { cursor, limit }),
    countOrdersByStatus(ctx.db, filters),
    ctx.db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { currency: true } }),
  ]);
  return NextResponse.json({ ...page, counts, currency: tenant?.currency ?? "NGN" });
});
