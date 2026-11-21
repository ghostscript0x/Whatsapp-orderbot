"use client";

import { useState } from "react";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { Role } from "@prisma/client";
import { signOut } from "next-auth/react";
import { LogOut, Settings, Users } from "lucide-react";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "")).toUpperCase() || "?";
}

const itemClass =
  "flex min-h-11 cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground";

export function UserMenu({ name, email, role }: { name: string; email: string; role?: Role }) {
  const [pending, setPending] = useState(false);
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary ring-offset-background transition-colors hover:ring-2 hover:ring-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`Account menu for ${name}`}
      >
        {initials(name)}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-60 max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-1.5 text-card-foreground shadow-lg data-[state=open]:animate-fade-in"
        >
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-muted-foreground">{email}</p>
          </div>
          {role === "OWNER" && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item asChild className={itemClass}>
                <Link href="/dashboard/settings">
                  <Settings aria-hidden />
                  Settings
                </Link>
              </DropdownMenu.Item>
              <DropdownMenu.Item asChild className={itemClass}>
                <Link href="/dashboard/team">
                  <Users aria-hidden />
                  Team
                </Link>
              </DropdownMenu.Item>
            </>
          )}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            disabled={pending}
            className={itemClass}
            onSelect={() => {
              setPending(true);
              void signOut({ redirectTo: "/login" });
            }}
          >
            <LogOut aria-hidden />
            {pending ? "Logging out…" : "Log out"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
