import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";

/** Models that carry tenantId. Keep in sync with prisma/schema.prisma. */
export const TENANT_MODELS = new Set<string>([
  "Membership",
  "Invite",
  "WhatsAppSession",
  "BotSettings",
  "Category",
  "Product",
  "ProductImage",
  "Customer",
  "Conversation",
  "Message",
  "Order",
  "OrderItem",
  "OrderStatusEvent",
  "WebhookEvent",
]);

const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);

type AnyArgs = Record<string, unknown> & { where?: Record<string, unknown>; data?: unknown; create?: unknown };

function withTenantData(data: unknown, tenantId: string): unknown {
  if (Array.isArray(data)) return data.map((d) => ({ ...(d as object), tenantId }));
  return { ...(data as object), tenantId };
}

/**
 * Returns a Prisma client where every query on a tenant model is forced to
 * `tenantId`. Reads/updates/deletes get `tenantId` ANDed into `where`; creates get
 * it injected into `data` (overriding anything the caller passed).
 *
 * findUnique/update/delete are allowed because Prisma 5+ accepts extra non-unique
 * filters in `where` for unique operations.
 *
 * Note: nested writes (e.g. `order.create({ data: { items: { create: [...] } } })`)
 * are NOT rewritten by the extension; pass `tenantId` explicitly on nested creates.
 */
export function forTenant(tenantId: string, client: PrismaClient = prisma) {
  if (!tenantId) throw new Error("forTenant() requires a tenantId");
  return client.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_MODELS.has(model)) return query(args);
          const a = (args ?? {}) as AnyArgs;

          if (WHERE_OPS.has(operation)) {
            a.where = { ...(a.where ?? {}), tenantId };
          } else if (operation === "create") {
            a.data = withTenantData(a.data, tenantId);
          } else if (operation === "createMany" || operation === "createManyAndReturn") {
            a.data = withTenantData(a.data, tenantId);
          } else if (operation === "upsert") {
            a.where = { ...(a.where ?? {}), tenantId };
            a.create = withTenantData(a.create, tenantId);
          }
          return query(a as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof forTenant>;
export type TenantTx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

export { Prisma };
