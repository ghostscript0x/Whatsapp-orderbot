import type { TenantDb } from "@/lib/tenant";
import { getCustomerOrders } from "@/lib/orders";
import type { CustomerProfile } from "./prompt";

const DAY_MS = 86_400_000;

/**
 * Returning-customer context for the prompt: order count, their last order and when they last
 * chatted. `previousMessageAt` = the newest message in the chat before the current burst.
 */
export async function buildCustomerProfile(
  db: TenantDb,
  customer: { id: string; name: string | null },
  previousMessageAt: Date | undefined,
  now: Date = new Date(),
): Promise<CustomerProfile> {
  const [orderCount, recent] = await Promise.all([db.order.count({ where: { customerId: customer.id } }), getCustomerOrders(db, customer.id)]);
  const last = recent[0];
  return {
    displayName: customer.name,
    orderCount,
    ...(last
      ? { lastOrderItems: last.items.map((i) => `${i.quantity}x ${i.nameSnapshot}`), lastOrderDaysAgo: (now.getTime() - last.createdAt.getTime()) / DAY_MS }
      : {}),
    ...(previousMessageAt ? { lastChatDaysAgo: Math.max(0, (now.getTime() - previousMessageAt.getTime()) / DAY_MS) } : {}),
  };
}
