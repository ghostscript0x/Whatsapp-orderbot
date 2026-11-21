import { OrdersList, type Tab } from "@/components/orders/orders-list";
import { PageHeader } from "@/components/ui/page-header";
import { ORDER_STATUSES } from "@/lib/orders-rules";

export const metadata = { title: "Orders" };

type SearchParams = Promise<{ q?: string | string[]; status?: string | string[] }>;

const TAB_VALUES: readonly string[] = [...ORDER_STATUSES, "ALL"];

export default async function OrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 50) : "";
  const status = typeof sp.status === "string" && TAB_VALUES.includes(sp.status) ? (sp.status as Tab) : "";

  return (
    <div className="space-y-6">
      <PageHeader className="mb-0" title="Orders" description="Orders placed through your WhatsApp bot. New ones are highlighted and update automatically." />
      <OrdersList initialQuery={q} initialStatus={status} />
    </div>
  );
}
