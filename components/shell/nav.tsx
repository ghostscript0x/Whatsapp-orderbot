"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@prisma/client";
import {
  ChevronRight,
  House,
  type LucideIcon,
  MessagesSquare,
  MoreHorizontal,
  Package,
  Settings,
  ShoppingBag,
  Smartphone,
  Users,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type NavBadges = { orders: number; conversations: number };

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  ownerOnly: boolean;
  /** Shown in the mobile bottom bar; the rest live under "More". */
  primary: boolean;
  badge?: keyof NavBadges;
  description?: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: House, ownerOnly: false, primary: true },
  { href: "/dashboard/orders", label: "Orders", icon: ShoppingBag, ownerOnly: false, primary: true, badge: "orders" },
  { href: "/dashboard/conversations", label: "Chats", icon: MessagesSquare, ownerOnly: false, primary: true, badge: "conversations" },
  { href: "/dashboard/products", label: "Products", icon: Package, ownerOnly: false, primary: true },
  { href: "/dashboard/whatsapp", label: "WhatsApp", icon: Smartphone, ownerOnly: true, primary: false, description: "Connect or reconnect your number" },
  { href: "/dashboard/settings", label: "Settings", icon: Settings, ownerOnly: true, primary: false, description: "Bot, business details and hours" },
  { href: "/dashboard/team", label: "Team", icon: Users, ownerOnly: true, primary: false, description: "Invite staff to help with orders" },
];

const BADGE_LABEL: Record<keyof NavBadges, string> = { orders: "new orders", conversations: "chats waiting for you" };

function isActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function visibleItems(role: Role) {
  return NAV_ITEMS.filter((item) => !item.ownerOnly || role === "OWNER");
}

function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-semibold leading-none text-destructive-foreground tabular-nums",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function srBadge(item: NavItem, badges?: NavBadges) {
  const n = item.badge && badges ? badges[item.badge] : 0;
  return n > 0 ? <span className="sr-only">{`, ${n} ${BADGE_LABEL[item.badge!]}`}</span> : null;
}

/** Vertical nav list for the desktop sidebar. */
export function NavLinks({ role, badges, onNavigate }: { role: Role; badges?: NavBadges; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="grid gap-0.5">
      {visibleItems(role).map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className={cn("size-[18px] shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} aria-hidden />
              <span className="flex-1">{item.label}</span>
              {item.badge && badges ? <CountBadge count={badges[item.badge]} /> : null}
              {srBadge(item, badges)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Fixed bottom tab bar on phones: the four daily sections plus "More" for owner-only pages. */
export function BottomTabBar({ role, badges }: { role: Role; badges?: NavBadges }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = visibleItems(role);
  const primary = items.filter((i) => i.primary);
  const secondary = items.filter((i) => !i.primary);
  const moreActive = secondary.some((i) => isActive(pathname, i.href));

  const tabClass = (active: boolean) =>
    cn(
      "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-medium transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      active ? "text-primary" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-card/85 md:hidden"
    >
      <ul className="mx-auto flex max-w-lg items-stretch px-1">
        {primary.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex flex-1">
              <Link href={item.href} aria-current={active ? "page" : undefined} className={tabClass(active)}>
                <span className="relative">
                  <span
                    aria-hidden
                    className={cn("absolute -inset-x-3 -inset-y-1 rounded-full transition-colors", active ? "bg-primary-soft" : "bg-transparent")}
                  />
                  <Icon aria-hidden className="relative size-5" strokeWidth={active ? 2.25 : 2} />
                  {item.badge && badges ? <CountBadge count={badges[item.badge]} className="absolute -right-3 -top-2 h-4 min-w-4 px-1 text-[10px]" /> : null}
                </span>
                <span>{item.label}</span>
                {srBadge(item, badges)}
              </Link>
            </li>
          );
        })}
        {secondary.length > 0 && (
          <li className="flex flex-1">
            <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
              <button type="button" onClick={() => setMoreOpen(true)} className={tabClass(moreActive)} aria-haspopup="dialog">
                <span className="relative">
                  <span
                    aria-hidden
                    className={cn("absolute -inset-x-3 -inset-y-1 rounded-full", moreActive ? "bg-primary-soft" : "bg-transparent")}
                  />
                  <MoreHorizontal aria-hidden className="relative size-5" />
                </span>
                <span>More</span>
              </button>
              <DialogContent title="More">
                <ul className="-mx-2 grid gap-1">
                  {secondary.map((item) => {
                    const active = isActive(pathname, item.href);
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={() => setMoreOpen(false)}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex min-h-14 items-center gap-3 rounded-xl px-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            active ? "bg-primary-soft" : "hover:bg-muted",
                          )}
                        >
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                            <Icon aria-hidden className="size-5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">{item.label}</span>
                            {item.description && <span className="block text-xs text-muted-foreground">{item.description}</span>}
                          </span>
                          <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </DialogContent>
            </Dialog>
          </li>
        )}
      </ul>
    </nav>
  );
}
