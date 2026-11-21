import { z } from "zod";
import { ORDER_STATUSES } from "@/lib/orders-rules";

const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

/** Shared by GET /api/orders and GET /api/orders/export. `from` inclusive, `to` exclusive (ISO date-times). */
export const orderFilterSchema = z.object({
  status: z.preprocess(emptyToUndefined, z.enum(ORDER_STATUSES).optional()),
  from: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  to: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  q: z.preprocess(emptyToUndefined, z.string().trim().max(50).optional()),
});
