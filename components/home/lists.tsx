import Link from "next/link";
import { ChevronRight, Hand, ShoppingBag } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/orders/status-badge";
import type { HomeLists } from "./data";
import { timeAgo } from "./time";

function SectionCard({ title, href, linkLabel, children }: { title: string; href: string; linkLabel: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-2 pb-3 sm:pb-3">
        <CardTitle className="text-base sm:text-base">{title}</CardTitle>
        <Link
          href={href}
          className="-mr-2 inline-flex min-h-10 items-center gap-0.5 rounded-lg px-2 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {linkLabel}
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      </CardHeader>
      {children}
    </Card>
  );
}

const rowClass =
  "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none sm:px-6";

export function RecentOrders({ orders, timeZone }: { orders: HomeLists["recentOrders"]; timeZone: string }) {
  return (
    <SectionCard title="Latest orders" href="/dashboard/orders" linkLabel="All orders">
      {orders.length === 0 ? (
        <div className="flex flex-col items-center border-t px-6 py-10 text-center">
          <ShoppingBag aria-hidden className="mb-2 size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No orders yet</p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">When a customer orders on WhatsApp, it shows up here straight away.</p>
        </div>
      ) : (
        <ul className="divide-y border-t">
          {orders.map((o) => (
            <li key={o.id}>
              <Link href={`/dashboard/orders/${o.id}`} className={rowClass}>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate">{o.customerName}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{o.number}</span> · {timeAgo(o.createdAt, timeZone)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-semibold tabular-nums">{o.totalFormatted}</span>
                  <StatusBadge status={o.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function WaitingChats({ chats, timeZone }: { chats: HomeLists["waitingChats"]; timeZone: string }) {
  return (
    <SectionCard title="Customers waiting for you" href="/dashboard/conversations?needsHuman=1" linkLabel="All chats">
      {chats.length === 0 ? (
        <div className="flex flex-col items-center border-t px-6 py-10 text-center">
          <Hand aria-hidden className="mb-2 size-6 text-muted-foreground" />
          <p className="text-sm font-medium">Nobody is waiting</p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">If a customer asks for a person, or the bot can&apos;t help, they&apos;ll appear here.</p>
        </div>
      ) : (
        <ul className="divide-y border-t">
          {chats.map((c) => (
            <li key={c.id}>
              <Link href={`/dashboard/conversations/${c.id}`} className={rowClass}>
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-sm font-semibold text-amber-800 dark:text-amber-200"
                >
                  {c.name.replace(/^\+/, "").slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.note || "Asked to talk to a person"}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(c.lastMessageAt, timeZone)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
