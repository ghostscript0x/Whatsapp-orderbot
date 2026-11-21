"use client";

import { useRouter } from "next/navigation";
import type { TenantStatus } from "@prisma/client";
import { ConfirmButton } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/fetcher";

/** Suspend / unsuspend behind a confirmation dialog. */
export function TenantStatusButton({ tenantId, tenantName, status }: { tenantId: string; tenantName: string; status: TenantStatus }) {
  const router = useRouter();
  const next: TenantStatus = status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  const suspending = next === "SUSPENDED";

  async function apply() {
    // Errors propagate to ConfirmButton, which keeps the dialog open and shows them.
    await apiFetch("/api/admin/tenants", { method: "PATCH", json: { tenantId, status: next } });
    toast.success(suspending ? `${tenantName} suspended` : `${tenantName} is active again`);
    router.refresh();
  }

  return (
    <ConfirmButton
      size="sm"
      variant={suspending ? "outline" : "secondary"}
      destructive={suspending}
      title={suspending ? `Suspend ${tenantName}?` : `Unsuspend ${tenantName}?`}
      description={
        suspending
          ? "Their team can't use the dashboard and the bot ignores their WhatsApp messages until you unsuspend them."
          : "Their team gets dashboard access back and the bot starts answering their customers again."
      }
      confirmLabel={suspending ? "Suspend" : "Unsuspend"}
      onConfirm={apply}
      aria-label={`${suspending ? "Suspend" : "Unsuspend"} ${tenantName}`}
    >
      {suspending ? "Suspend" : "Unsuspend"}
    </ConfirmButton>
  );
}
