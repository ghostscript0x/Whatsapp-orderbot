import type { WaStatus } from "@prisma/client";
import { Store } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { EmptyState } from "@/components/ui/empty-state";
import type { AdminTenantRow } from "./data";
import { TenantStatusButton } from "./tenant-status-button";

const WA: Record<WaStatus, { label: string; variant: "success" | "warning" | "destructive" | "secondary" }> = {
  CONNECTED: { label: "Connected", variant: "success" },
  STARTING: { label: "Starting", variant: "secondary" },
  QR_PENDING: { label: "Waiting for scan", variant: "warning" },
  NEEDS_RESCAN: { label: "Needs re-scan", variant: "destructive" },
  DISCONNECTED: { label: "Disconnected", variant: "secondary" },
};

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function TenantTable({ tenants }: { tenants: AdminTenantRow[] }) {
  if (tenants.length === 0) {
    return <EmptyState icon={Store} title="No businesses match" description="Try a different search or status filter." />;
  }

  return (
    <>
      {/* Phones: one card per business. */}
      <ul className="grid gap-3 md:hidden">
        {tenants.map((t) => {
          const wa = t.whatsappStatus ? WA[t.whatsappStatus] : null;
          return (
            <li key={t.id} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{t.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{t.ownerEmail ?? "No owner"}</p>
                </div>
                <Badge variant={t.status === "ACTIVE" ? "success" : "destructive"}>{t.status === "ACTIVE" ? "Active" : "Suspended"}</Badge>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">WhatsApp</dt>
                  <dd>{wa ? <Badge variant={wa.variant}>{wa.label}</Badge> : <span className="text-muted-foreground">Never set up</span>}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Orders (7 days)</dt>
                  <dd className="font-medium tabular-nums">{t.ordersLast7Days}</dd>
                </div>
              </dl>
              <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
                <span className="text-xs text-muted-foreground">
                  Since <time dateTime={t.createdAt}>{dateFmt.format(new Date(t.createdAt))}</time>
                </span>
                <TenantStatusButton tenantId={t.id} tenantName={t.name} status={t.status} />
              </div>
            </li>
          );
        })}
      </ul>

    <div className="hidden overflow-x-auto rounded-xl border bg-card shadow-sm md:block">
      <table className="w-full min-w-[720px] text-sm">
        <caption className="sr-only">Businesses on the platform</caption>
        <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">Business</th>
            <th scope="col" className="px-4 py-3 font-medium">Status</th>
            <th scope="col" className="px-4 py-3 font-medium">WhatsApp</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Orders (7d)</th>
            <th scope="col" className="px-4 py-3 font-medium">Owner</th>
            <th scope="col" className="px-4 py-3 font-medium">Created</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {tenants.map((t) => {
            const wa = t.whatsappStatus ? WA[t.whatsappStatus] : null;
            return (
              <tr key={t.id} className="align-middle transition-colors hover:bg-muted/40">
                <td className="max-w-[16rem] px-4 py-3">
                  <div className="truncate font-medium">{t.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{t.slug}</div>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={t.status === "ACTIVE" ? "success" : "destructive"}>{t.status === "ACTIVE" ? "Active" : "Suspended"}</Badge>
                </td>
                <td className="px-4 py-3">
                  {wa ? <Badge variant={wa.variant}>{wa.label}</Badge> : <span className="text-muted-foreground">Never set up</span>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{t.ordersLast7Days}</td>
                <td className="max-w-[14rem] truncate px-4 py-3">{t.ownerEmail ?? <span className="text-muted-foreground">None</span>}</td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  <time dateTime={t.createdAt}>{dateFmt.format(new Date(t.createdAt))}</time>
                </td>
                <td className="px-4 py-3 text-right">
                  <TenantStatusButton tenantId={t.id} tenantName={t.name} status={t.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}
