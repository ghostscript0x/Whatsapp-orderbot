import type { OrderStatus, WaStatus } from "@prisma/client";
import type { TenantDb } from "@/lib/tenant";
import { dayRangeInTimeZone } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

/** Shape returned by GET /api/dashboard/stats and rendered by /dashboard. */
export type HomeData = {
  today: {
    /** Local calendar date in the tenant timezone, YYYY-MM-DD. */
    date: string;
    timezone: string;
    orders: number;
    /** Sum of totalKobo for today's orders that are not CANCELLED. */
    revenueKobo: number;
    revenueFormatted: string;
    currency: string;
    newConversations: number;
  };
  /** Conversations currently flagged needs_human (not limited to today). */
  needsHuman: number;
  whatsapp: { status: WaStatus; phone: string | null; lastSeenAt: string | null };
  checklist: {
    whatsappConnected: boolean;
    hasProducts: boolean;
    businessDetailsSet: boolean;
    botTested: boolean;
  };
};

type BusinessDetailsFields = { ownerAlertPhone: string | null; deliveryAreas: string; paymentInstructions: string };

/**
 * "Set business details" is done when the owner has given a phone for order alerts AND told the
 * bot at least one of: where they deliver, or how customers pay. Those are the fields the bot
 * cannot work without; tone/greeting have usable defaults.
 */
export function isBusinessDetailsSet(s: BusinessDetailsFields | null): boolean {
  if (!s) return false;
  const hasAlertPhone = !!s.ownerAlertPhone?.trim();
  return hasAlertPhone && (s.deliveryAreas.trim() !== "" || s.paymentInstructions.trim() !== "");
}

/** Loads everything the dashboard home needs, scoped to one tenant. */
export async function getHomeData(db: TenantDb, tenantId: string, now: Date = new Date()): Promise<HomeData> {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true, currency: true } });
  const { date, start, end } = dayRangeInTimeZone(tenant.timezone, now);
  const today = { gte: start, lt: end };

  const [orders, revenue, newConversations, needsHuman, session, productCount, settings, botMessage] = await Promise.all([
    db.order.count({ where: { createdAt: today } }),
    db.order.aggregate({ where: { createdAt: today, status: { not: "CANCELLED" } }, _sum: { totalKobo: true } }),
    db.conversation.count({ where: { createdAt: today } }),
    db.conversation.count({ where: { needsHuman: true } }),
    db.whatsAppSession.findUnique({ where: { tenantId }, select: { status: true, phone: true, lastSeenAt: true } }),
    db.product.count({ where: { deletedAt: null } }),
    db.botSettings.findUnique({
      where: { tenantId },
      select: { ownerAlertPhone: true, deliveryAreas: true, paymentInstructions: true },
    }),
    db.message.findFirst({ where: { direction: "OUT", sender: "BOT" }, select: { id: true } }),
  ]);

  const revenueKobo = revenue._sum.totalKobo ?? 0;
  const status: WaStatus = session?.status ?? "DISCONNECTED";

  return {
    today: {
      date,
      timezone: tenant.timezone,
      orders,
      revenueKobo,
      revenueFormatted: formatMoney(revenueKobo, tenant.currency),
      currency: tenant.currency,
      newConversations,
    },
    needsHuman,
    whatsapp: { status, phone: session?.phone ?? null, lastSeenAt: session?.lastSeenAt?.toISOString() ?? null },
    checklist: {
      whatsappConnected: status === "CONNECTED",
      hasProducts: productCount > 0,
      businessDetailsSet: isBusinessDetailsSet(settings),
      botTested: botMessage !== null,
    },
  };
}

export type HomeLists = {
  recentOrders: {
    id: string;
    number: string;
    customerName: string;
    status: OrderStatus;
    totalFormatted: string;
    createdAt: string;
  }[];
  waitingChats: { id: string; name: string; phone: string; note: string | null; lastMessageAt: string }[];
};

/** The two short lists on the home page: latest 5 orders and up to 5 chats waiting for a person. */
export async function getHomeLists(db: TenantDb, currency: string): Promise<HomeLists> {
  const [orders, chats] = await Promise.all([
    db.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, number: true, customerName: true, status: true, totalKobo: true, createdAt: true },
    }),
    db.conversation.findMany({
      where: { needsHuman: true },
      orderBy: { lastMessageAt: "desc" },
      take: 5,
      select: { id: true, needsHumanNote: true, lastMessageAt: true, customer: { select: { name: true, phone: true } } },
    }),
  ]);
  return {
    recentOrders: orders.map((o) => ({
      id: o.id,
      number: o.number,
      customerName: o.customerName,
      status: o.status,
      totalFormatted: formatMoney(o.totalKobo, currency),
      createdAt: o.createdAt.toISOString(),
    })),
    waitingChats: chats.map((c) => ({
      id: c.id,
      name: c.customer.name?.trim() || `+${c.customer.phone}`,
      phone: c.customer.phone,
      note: c.needsHumanNote,
      lastMessageAt: c.lastMessageAt.toISOString(),
    })),
  };
}
