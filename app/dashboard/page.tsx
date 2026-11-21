import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, Bot, MessageSquare, PackagePlus, ShoppingBag, UserRound } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSystemStatus } from "@/lib/system-status";
import { getHomeData, getHomeLists } from "@/components/home/data";
import { tenantForPage } from "@/components/home/page-auth";
import { AccessNotice } from "@/components/home/notice";
import { StatCard } from "@/components/home/stat-card";
import { SetupChecklist } from "@/components/home/setup-checklist";
import { WhatsAppCard } from "@/components/home/whatsapp-card";
import { RecentOrders, WaitingChats } from "@/components/home/lists";
import { WorkerOfflineBanner } from "@/components/home/system-banner";
import { greeting, timeAgo } from "@/components/home/time";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

function formatLocalDate(isoDate: string): string {
  // isoDate is already the tenant's local date; format it without shifting zones.
  return new Intl.DateTimeFormat("en-NG", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

const quickActionClass =
  "flex min-h-12 items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm font-medium shadow-sm transition-[box-shadow,border-color] hover:border-muted-foreground/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default async function DashboardHomePage() {
  const auth = await tenantForPage("/dashboard");
  if (!auth.ok) return <AccessNotice title="No access" message={auth.message} />;

  const { db, tenantId, userId, role } = auth.value;
  const [data, tenant, user, system] = await Promise.all([
    getHomeData(db, tenantId),
    db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, currency: true, timezone: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    getSystemStatus(),
  ]);
  const lists = await getHomeLists(db, tenant.currency);
  const { today } = data;
  const firstName = user?.name.trim().split(/\s+/)[0];
  const tz = tenant.timezone;
  const setupDone = Object.values(data.checklist).every(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          {formatLocalDate(today.date)} · {tenant.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {greeting(tz)}
          {firstName ? `, ${firstName}` : ""}
        </h1>
      </header>

      <WorkerOfflineBanner status={system} timeLabel={system.lastHeartbeatAt ? timeAgo(system.lastHeartbeatAt, tz) : null} />

      <section aria-labelledby="today-heading" className="space-y-3">
        <h2 id="today-heading" className="text-sm font-semibold text-muted-foreground">
          Today so far
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Orders" value={today.orders} icon={ShoppingBag} href="/dashboard/orders" />
          <StatCard label="Sales" value={today.revenueFormatted} icon={Banknote} hint="Not counting cancelled" />
          <StatCard label="New chats" value={today.newConversations} icon={MessageSquare} href="/dashboard/conversations" />
          <StatCard
            label="Waiting for you"
            value={data.needsHuman}
            icon={UserRound}
            href="/dashboard/conversations?needsHuman=1"
            hint={data.needsHuman > 0 ? "Reply to these customers" : "Nobody waiting"}
            attention={data.needsHuman > 0}
          />
        </div>
      </section>

      {!setupDone && role === "OWNER" && (
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <SetupChecklist checklist={data.checklist} />
          <WhatsAppCard status={data.whatsapp.status} phone={data.whatsapp.phone} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <RecentOrders orders={lists.recentOrders} timeZone={tz} />
        <WaitingChats chats={lists.waitingChats} timeZone={tz} />
      </div>

      <section aria-labelledby="quick-heading" className="space-y-3">
        <h2 id="quick-heading" className="text-sm font-semibold text-muted-foreground">
          Quick actions
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link href="/dashboard/products/new" className={quickActionClass}>
            <PackagePlus aria-hidden className="size-5 text-primary" />
            Add a product
          </Link>
          <Link href="/dashboard/orders?status=NEW" className={quickActionClass}>
            <ShoppingBag aria-hidden className="size-5 text-primary" />
            See new orders
          </Link>
          {role === "OWNER" ? (
            <Link href="/dashboard/settings?tab=test" className={quickActionClass}>
              <Bot aria-hidden className="size-5 text-primary" />
              Try your bot
            </Link>
          ) : (
            <Link href="/dashboard/conversations" className={quickActionClass}>
              <MessageSquare aria-hidden className="size-5 text-primary" />
              Open chats
            </Link>
          )}
        </div>
      </section>

      {setupDone && role === "OWNER" && <WhatsAppCard status={data.whatsapp.status} phone={data.whatsapp.phone} />}
    </div>
  );
}
