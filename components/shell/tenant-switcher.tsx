"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronsUpDown, Plus, Store } from "lucide-react";
import type { MyTenant } from "@/lib/tenants";
import { apiFetch } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { CreateBusinessDialog } from "./create-business-dialog";

const itemClass =
  "flex min-h-11 cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export function TenantSwitcher({ tenants, activeTenantId }: { tenants: MyTenant[]; activeTenantId: string }) {
  const router = useRouter();
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const active = tenants.find((t) => t.tenantId === activeTenantId);

  async function switchTo(tenantId: string) {
    if (tenantId === activeTenantId) return;
    setError(null);
    setSwitching(tenantId);
    try {
      await apiFetch("/api/tenants/switch", { method: "POST", json: { tenantId } });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't switch business";
      setError(message);
      toast.error(message);
    } finally {
      setSwitching(null);
    }
  }

  return (
    <div className="min-w-0">
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger
          className="flex h-10 max-w-full items-center gap-2 rounded-lg px-2.5 text-sm font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted"
          aria-label={`Current business: ${active?.name ?? "none"}. Switch business`}
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Store className="size-4" aria-hidden /></span>
          <span className="truncate">{switching ? "Switching…" : (active?.name ?? "Choose business")}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            className="z-50 min-w-64 max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-1.5 text-card-foreground shadow-lg data-[state=open]:animate-fade-in"
          >
            <DropdownMenu.Label className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Your businesses</DropdownMenu.Label>
            {tenants.map((t) => (
              <DropdownMenu.Item
                key={t.tenantId}
                className={itemClass}
                disabled={t.status === "SUSPENDED"}
                onSelect={() => void switchTo(t.tenantId)}
              >
                <Check className={cn("size-4 shrink-0", t.tenantId === activeTenantId ? "opacity-100" : "opacity-0")} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t.status === "SUSPENDED" ? "Suspended" : t.role === "OWNER" ? "Owner" : "Staff"}
                </span>
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item className={itemClass} onSelect={() => setCreateOpen(true)}>
              <Plus className="size-4 shrink-0" aria-hidden />
              New business
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <CreateBusinessDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
