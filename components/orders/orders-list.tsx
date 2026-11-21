"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { OrderStatus } from "@prisma/client";
import { CalendarDays, ChevronRight, Download, Inbox, RefreshCw, Search, SearchX, X } from "lucide-react";
import { apiFetch } from "@/lib/fetcher";
import { formatMoney } from "@/lib/money";
import { ORDER_STATUSES, STATUS_LABELS } from "@/lib/orders-rules";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/misc";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { StatusBadge } from "./status-badge";
import { errorMessage, formatDateTime, formatPhone, formatRelative, plural } from "./format";
import { useDebounced, useNow, useVisiblePoll } from "./hooks";

type OrderRow = {
  id: string;
  number: string;
  status: OrderStatus;
  totalKobo: number;
  customerName: string;
  customerPhone: string;
  itemCount: number;
  itemSummary: string;
  createdAt: string;
};
type StatusCounts = Record<OrderStatus, number>;
/** `counts` honours the search/date filters but not the status tab. */
type ListResponse = { orders: OrderRow[]; nextCursor: string | null; counts: StatusCounts; currency: string };

export type Tab = OrderStatus | "ALL";
const TABS: Tab[] = [...ORDER_STATUSES, "ALL"];
const POLL_MS = 15_000;

type DateRange = { from: string; to: string };

/** Date inputs are local calendar days; the API takes `from` inclusive and `to` exclusive instants. */
function buildParams(status: Tab, range: DateRange, q: string): URLSearchParams {
  const p = new URLSearchParams();
  if (status !== "ALL") p.set("status", status);
  if (range.from) p.set("from", new Date(`${range.from}T00:00:00`).toISOString());
  if (range.to) {
    const end = new Date(`${range.to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    p.set("to", end.toISOString());
  }
  if (q) p.set("q", q);
  return p;
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function presets(): { label: string; range: DateRange }[] {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 6);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  return [
    { label: "Today", range: { from: isoDay(today), to: isoDay(today) } },
    { label: "Yesterday", range: { from: isoDay(yesterday), to: isoDay(yesterday) } },
    { label: "Last 7 days", range: { from: isoDay(weekAgo), to: isoDay(today) } },
    { label: "This month", range: { from: isoDay(monthStart), to: isoDay(today) } },
  ];
}

const shortDay = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
function rangeLabel(r: DateRange): string {
  if (!r.from && !r.to) return "Any date";
  const preset = presets().find((p) => p.range.from === r.from && p.range.to === r.to);
  if (preset) return preset.label;
  const f = r.from ? shortDay.format(new Date(`${r.from}T00:00:00`)) : "";
  const t = r.to ? shortDay.format(new Date(`${r.to}T00:00:00`)) : "";
  if (f && t) return f === t ? f : `${f} – ${t}`;
  return f ? `From ${f}` : `Until ${t}`;
}

export function OrdersList({ initialQuery = "", initialStatus = "" }: { initialQuery?: string; initialStatus?: Tab | "" }) {
  const [tab, setTab] = React.useState<Tab>(initialStatus || (initialQuery ? "ALL" : "NEW"));
  const [range, setRange] = React.useState<DateRange>({ from: "", to: "" });
  const [qInput, setQInput] = React.useState(initialQuery);
  const q = useDebounced(qInput.trim(), 300);
  const now = useNow();
  const router = useRouter();

  const [data, setData] = React.useState<ListResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pollError, setPollError] = React.useState(false);

  const [counts, setCounts] = React.useState<StatusCounts | null>(null);
  const [freshIds, setFreshIds] = React.useState<Set<string>>(() => new Set());
  /** What we last saw under the current search/date filters, to spot orders that arrive while the page is open. */
  const baseline = React.useRef<{ key: string; newCount: number; ids: Set<string> } | null>(null);
  const seq = React.useRef(0);

  const qs = React.useMemo(() => buildParams(tab, range, q).toString(), [tab, range, q]);
  // Counts ignore the status tab, so switching tabs keeps the same baseline.
  const countsKey = React.useMemo(() => buildParams("ALL", range, q).toString(), [range, q]);

  // Keep the tab and search in the URL so Back from an order returns to the same view.
  React.useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("status");
    url.searchParams.delete("q");
    if (tab !== "NEW") url.searchParams.set("status", tab);
    if (q) url.searchParams.set("q", q);
    window.history.replaceState(window.history.state, "", url);
  }, [tab, q]);

  /** Updates tab counts and announces new orders when the NEW count goes up. */
  const track = React.useCallback((res: ListResponse, key: string) => {
    setCounts(res.counts);
    const ids = res.orders.map((o) => o.id);
    const b = baseline.current;
    if (!b || b.key !== key) {
      baseline.current = { key, newCount: res.counts.NEW, ids: new Set(ids) };
      return;
    }
    const added = res.counts.NEW - b.newCount;
    const arrived = res.orders.filter((o) => o.status === "NEW" && !b.ids.has(o.id)).slice(0, Math.max(0, added));
    baseline.current = { key, newCount: res.counts.NEW, ids: new Set([...b.ids, ...ids]) };
    // Keep the layout's "new orders" badge in step with what this page sees.
    if (added !== 0) router.refresh();
    if (added <= 0) return;
    if (arrived.length > 0) setFreshIds((prev) => new Set([...prev, ...arrived.map((o) => o.id)]));
    toast(
      added === 1 && arrived.length === 1
        ? `New order ${arrived[0].number} from ${arrived[0].customerName} · ${formatMoney(arrived[0].totalKobo, res.currency)}`
        : added === 1
          ? "A new order just came in"
          : `${added} new orders just came in`,
    );
  }, [router]);

  const load = React.useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<ListResponse>(`/api/orders?${qs}`);
      if (id !== seq.current) return;
      setData(res);
      track(res, countsKey);
    } catch (err) {
      if (id === seq.current) setError(errorMessage(err, "Couldn't load orders"));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [qs, countsKey, track]);

  React.useEffect(() => {
    void load();
  }, [load]);

  /** Background refresh: replace the first page, keep any extra pages the user loaded. */
  const refreshList = React.useCallback(async () => {
    const id = seq.current;
    const res = await apiFetch<ListResponse>(`/api/orders?${qs}`);
    if (id !== seq.current) return;
    setData((prev) => {
      if (!prev || prev.orders.length <= res.orders.length) return res;
      const ids = new Set(res.orders.map((o) => o.id));
      return { ...res, orders: [...res.orders, ...prev.orders.filter((o) => !ids.has(o.id))], nextCursor: prev.nextCursor };
    });
    track(res, countsKey);
  }, [qs, countsKey, track]);

  useVisiblePoll(() => {
    if (loading) return;
    refreshList()
      .then(() => setPollError(false))
      .catch(() => setPollError(true));
  }, POLL_MS);

  async function loadMore() {
    if (!data?.nextCursor) return;
    setLoadingMore(true);
    try {
      const more = new URLSearchParams(qs);
      more.set("cursor", data.nextCursor);
      const next = await apiFetch<ListResponse>(`/api/orders?${more}`);
      setData((d) => (d ? { ...next, orders: [...d.orders, ...next.orders] } : next));
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load more orders"));
    } finally {
      setLoadingMore(false);
    }
  }

  const currency = data?.currency ?? "NGN";
  const hasFilters = Boolean(range.from || range.to || q);
  const exportQs = buildParams(tab, range, q).toString();

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          <TabsList aria-label="Order status" className="w-max">
            {TABS.map((t) => (
              <TabsTrigger key={t} value={t} className="min-h-10 gap-1.5">
                {t === "ALL" ? "All" : STATUS_LABELS[t]}
                {counts && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums",
                      t === "NEW" && counts.NEW > 0 ? "bg-sky-600 text-white" : "bg-background/70 text-muted-foreground",
                    )}
                  >
                    <span className="sr-only">(</span>
                    {tabCount(counts, t)}
                    <span className="sr-only"> orders)</span>
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-[1_1_16rem]">
            <Label htmlFor="order-search" className="sr-only">
              Search orders
            </Label>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="order-search"
              type="search"
              inputMode="search"
              placeholder="Search order number or phone"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              className="h-11 pl-9"
            />
          </div>
          <DateFilter value={range} onChange={setRange} />
          <a
            href={`/api/orders/export?${exportQs}`}
            className={buttonVariants({ variant: "outline", className: "h-11" })}
            download
            onClick={() => toast("Preparing your CSV download…")}
          >
            <Download aria-hidden />
            <span className="hidden sm:inline">Export CSV</span>
            <span className="sm:hidden">CSV</span>
          </a>
        </div>

        {pollError && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
            <RefreshCw className="size-3" aria-hidden />
            Live updates paused, couldn&apos;t reach the server. Retrying every 15 seconds.
          </p>
        )}

        <TabsContent value={tab} className="mt-4 focus-visible:outline-none">
          {error ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
              <span>{error}</span>
              <Button size="sm" variant="outline" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          ) : !data ? (
            <ListSkeleton />
          ) : data.orders.length === 0 ? (
            hasFilters ? (
              <EmptyState
                icon={SearchX}
                title="No orders match"
                description="Try another search or date range."
                action={
                  <Button
                    variant="outline"
                    onClick={() => {
                      setQInput("");
                      setRange({ from: "", to: "" });
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : tab === "NEW" ? (
              <EmptyState
                icon={Inbox}
                title="You're all caught up"
                description="New orders from your WhatsApp bot appear here. This page checks for new ones every 15 seconds."
                action={
                  <Button variant="outline" onClick={() => setTab("ALL")}>
                    View all orders
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Inbox}
                title={tab === "ALL" ? "No orders yet" : `No ${STATUS_LABELS[tab].toLowerCase()} orders`}
                description={tab === "ALL" ? "Orders your WhatsApp bot takes will show up here." : undefined}
              />
            )
          ) : (
            <div className={cn("space-y-4 transition-opacity", loading && "opacity-60")} aria-busy={loading}>
              <ul className="space-y-2 md:hidden">
                {data.orders.map((o) => (
                  <li key={o.id}>
                    <OrderCard order={o} currency={currency} now={now} fresh={freshIds.has(o.id)} />
                  </li>
                ))}
              </ul>

              <div className="hidden overflow-hidden rounded-lg border md:block">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">Order</th>
                      <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                      <th scope="col" className="px-4 py-3 font-medium">Items</th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">Total</th>
                      <th scope="col" className="px-4 py-3 font-medium">Status</th>
                      <th scope="col" className="px-4 py-3 font-medium">Placed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.orders.map((o) => (
                      <tr key={o.id} className={cn("relative hover:bg-muted/40", o.status === "NEW" && "bg-sky-500/[0.06]")}>
                        <td className="px-4 py-3">
                          <Link
                            href={`/dashboard/orders/${o.id}`}
                            className="inline-flex items-center gap-2 font-semibold after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
                          >
                            {freshIds.has(o.id) && <FreshDot />}
                            {o.number}
                          </Link>
                        </td>
                        <td className="max-w-56 px-4 py-3">
                          <p className="truncate font-medium">{o.customerName}</p>
                          <p className="text-muted-foreground">{formatPhone(o.customerPhone)}</p>
                        </td>
                        <td className="max-w-72 px-4 py-3 text-muted-foreground">
                          <p className="truncate" title={o.itemSummary}>
                            {o.itemSummary || plural(o.itemCount, "item")}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums">{formatMoney(o.totalKobo, currency)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={o.status} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                          <time dateTime={o.createdAt} title={formatDateTime(o.createdAt)}>
                            {formatRelative(o.createdAt, now)}
                          </time>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {data.nextCursor && (
                <div className="flex justify-center">
                  <Button variant="outline" className="h-11" onClick={() => void loadMore()} disabled={loadingMore}>
                    {loadingMore && <Spinner />}
                    Load more
                  </Button>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function tabCount(counts: StatusCounts, tab: Tab): number {
  return tab === "ALL" ? ORDER_STATUSES.reduce((sum, s) => sum + counts[s], 0) : counts[tab];
}

function FreshDot() {
  return (
    <span className="relative flex size-2.5" aria-label="Just arrived" role="img">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-500 opacity-60 motion-reduce:animate-none" />
      <span className="relative inline-flex size-2.5 rounded-full bg-sky-500" />
    </span>
  );
}

function OrderCard({ order: o, currency, now, fresh }: { order: OrderRow; currency: string; now: Date; fresh: boolean }) {
  const isNew = o.status === "NEW";
  return (
    <Link
      href={`/dashboard/orders/${o.id}`}
      className={cn(
        "flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors active:bg-muted/60 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isNew && "border-sky-500/40 bg-sky-500/[0.06] shadow-sm",
      )}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-semibold">
            {fresh && <FreshDot />}
            {o.number}
          </span>
          <span className="font-semibold tabular-nums">{formatMoney(o.totalKobo, currency)}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm">{o.customerName}</p>
          <StatusBadge status={o.status} />
        </div>
        <p className="line-clamp-2 text-sm text-muted-foreground">{o.itemSummary || plural(o.itemCount, "item")}</p>
        <p className="text-xs text-muted-foreground">
          <time dateTime={o.createdAt} title={formatDateTime(o.createdAt)}>
            {formatRelative(o.createdAt, now)}
          </time>
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

function DateFilter({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const active = Boolean(value.from || value.to);
  const invalid = Boolean(draft.from && draft.to && draft.from > draft.to);

  return (
    <div className="flex items-center">
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (o) setDraft(value);
          setOpen(o);
        }}
      >
        <DialogTrigger asChild>
          <Button variant="outline" className={cn("h-11", active && "rounded-r-none border-primary/50 text-primary")}>
            <CalendarDays aria-hidden />
            {rangeLabel(value)}
          </Button>
        </DialogTrigger>
        <DialogContent title="Filter by date" description="Show orders placed in this period.">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {presets().map((p) => {
                const selected = p.range.from === draft.from && p.range.to === draft.to;
                return (
                  <Button key={p.label} type="button" variant={selected ? "default" : "outline"} size="sm" className="h-10" aria-pressed={selected} onClick={() => setDraft(p.range)}>
                    {p.label}
                  </Button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="order-from">From</Label>
                <Input id="order-from" type="date" className="h-11" value={draft.from} max={draft.to || undefined} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="order-to">To</Label>
                <Input id="order-to" type="date" className="h-11" value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
              </div>
            </div>
            {invalid && (
              <p role="alert" className="text-sm text-destructive">
                The start date must be on or before the end date.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDraft({ from: "", to: "" })}>
              Any date
            </Button>
            <DialogClose asChild>
              <Button type="button" disabled={invalid} onClick={() => onChange(draft)}>
                Apply
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {active && (
        <Button variant="outline" size="icon" className="h-11 w-11 rounded-l-none border-l-0 border-primary/50" aria-label="Clear date filter" onClick={() => onChange({ from: "", to: "" })}>
          <X aria-hidden />
        </Button>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading orders">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-[5.25rem] w-full rounded-xl md:h-14 md:rounded-lg" />
      ))}
    </div>
  );
}
