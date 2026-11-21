"use client";

import Link from "next/link";
import type { Role } from "@prisma/client";
import type { MyTenant } from "@/lib/tenants";
import { Toaster } from "@/components/ui/toast";
import { BrandMark } from "./brand";
import { BottomTabBar, NavLinks, type NavBadges } from "./nav";
import { TenantSwitcher } from "./tenant-switcher";
import { UserMenu } from "./user-menu";

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/dashboard"
      aria-label="OrderBot home"
      className="flex items-center gap-2.5 rounded-lg font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <BrandMark />
      {!compact && <span>OrderBot</span>}
    </Link>
  );
}

export function DashboardShell({
  user,
  tenants,
  activeTenantId,
  role,
  badges,
  children,
}: {
  user: { name: string; email: string };
  tenants: MyTenant[];
  activeTenantId: string;
  role: Role;
  badges?: NavBadges;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[16rem_1fr]">
      <a
        href="#main"
        className="sr-only z-[70] rounded-lg bg-card px-4 py-2 text-sm font-medium shadow-lg focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh flex-col border-r bg-card md:flex">
        <div className="flex h-16 items-center px-5">
          <Brand />
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-2">
          <NavLinks role={role} badges={badges} />
        </nav>
        <p className="border-t px-5 py-4 text-xs text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{role === "OWNER" ? "Owner" : "Staff"}</span>
        </p>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-6 md:h-16">
          <div className="md:hidden">
            <Brand compact />
          </div>
          <div className="min-w-0 flex-1">
            <TenantSwitcher tenants={tenants} activeTenantId={activeTenantId} />
          </div>
          <UserMenu name={user.name} email={user.email} role={role} />
        </header>

        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 outline-none sm:px-6 md:pb-10 md:pt-8"
        >
          {children}
        </main>
      </div>

      <BottomTabBar role={role} badges={badges} />
      <Toaster />
    </div>
  );
}
