import { parseQuery, route, requireTenant } from "@/lib/api";
import { listOrdersForExport } from "@/lib/orders";
import { ordersToCsv } from "@/lib/orders-rules";
import { orderFilterSchema } from "../_filters";

export const GET = route(async (req) => {
  const ctx = await requireTenant();
  const filters = parseQuery(req, orderFilterSchema);
  const [orders, tenant] = await Promise.all([
    listOrdersForExport(ctx.db, filters),
    ctx.db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { currency: true } }),
  ]);
  // BOM so Excel opens UTF-8 names/addresses correctly.
  const csv = "﻿" + ordersToCsv(orders, tenant?.currency ?? "NGN");
  const filename = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
});
