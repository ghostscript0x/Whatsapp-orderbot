import Link from "next/link";
import { listTenants, listTenantsQuery } from "@/components/admin/data";
import { TenantTable } from "@/components/admin/tenant-table";
import { platformAdminForPage } from "@/components/home/page-auth";
import { AccessNotice } from "@/components/home/notice";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pageHref(params: { q?: string; status?: string }, page: number): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.status) sp.set("status", params.status);
  if (page > 1) sp.set("page", String(page));
  const s = sp.toString();
  return s ? `/admin?${s}` : "/admin";
}

export default async function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  // Checked here as well as in the layout: layouts are not re-run on every client navigation.
  const auth = await platformAdminForPage("/admin");
  if (!auth.ok) return <AccessNotice title="403 · Not allowed" message="This page is only for platform administrators." />;

  const raw = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  const parsed = listTenantsQuery.safeParse({ page: first(raw.page), q: first(raw.q), status: first(raw.status) });
  const query = parsed.success ? parsed.data : listTenantsQuery.parse({});
  const result = await listTenants(query);
  const filters = { q: query.q, status: query.status };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        className="mb-2"
        title="Businesses"
        description={`${result.total} total. Suspended businesses can't use their dashboard and their WhatsApp messages are ignored.`}
      />

      <form method="get" action="/admin" role="search" className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="q" className="mb-1.5 block text-sm font-medium">
            Search
          </label>
          <Input id="q" name="q" type="search" defaultValue={query.q ?? ""} placeholder="Name, slug or owner email" maxLength={100} />
        </div>
        <div className="sm:w-44">
          <label htmlFor="status" className="mb-1.5 block text-sm font-medium">
            Status
          </label>
          <NativeSelect id="status" name="status" defaultValue={query.status ?? ""}>
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </NativeSelect>
        </div>
        <Button type="submit">Search</Button>
      </form>

      <TenantTable tenants={result.tenants} />

      {result.totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-2 text-sm">
          {result.page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(filters, result.page - 1)}>Previous</Link>
            </Button>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            Page {result.page} of {result.totalPages}
          </span>
          {result.page < result.totalPages ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(filters, result.page + 1)}>Next</Link>
            </Button>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
