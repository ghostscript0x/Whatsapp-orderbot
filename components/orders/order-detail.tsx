"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { OrderStatus } from "@prisma/client";
import { Bike, CheckCircle2, ClipboardCheck, Copy, MapPin, MessageCircle, PackageCheck, Phone, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/fetcher";
import { formatMoney } from "@/lib/money";
import { STATUS_LABELS } from "@/lib/orders-rules";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { StatusBadge } from "./status-badge";
import { errorMessage, formatDateTime, formatPhone, formatRelative, plural, whatsappLink } from "./format";
import { useNow } from "./hooks";

type OrderDetailData = {
  id: string;
  number: string;
  status: OrderStatus;
  subtotalKobo: number;
  deliveryFeeKobo: number;
  totalKobo: number;
  customerName: string;
  deliveryAddress: string;
  notes: string;
  createdAt: string;
  items: { id: string; nameSnapshot: string; unitPriceKobo: number; quantity: number }[];
  customer: { id: string; name: string | null; phone: string };
  conversationId: string | null;
  events: { id: string; fromStatus: OrderStatus | null; toStatus: OrderStatus; createdAt: string; byUserName: string | null }[];
  allowedNext: OrderStatus[];
};

const NEXT_ACTION: Partial<Record<OrderStatus, { label: string; icon: React.ComponentType<{ className?: string }>; done: string }>> = {
  CONFIRMED: { label: "Confirm order", icon: ClipboardCheck, done: "Order confirmed" },
  OUT_FOR_DELIVERY: { label: "Out for delivery", icon: Bike, done: "Marked out for delivery" },
  DELIVERED: { label: "Mark delivered", icon: PackageCheck, done: "Marked delivered" },
};

const BACK = { href: "/dashboard/orders", label: "All orders" };

export function OrderDetail({ id }: { id: string }) {
  const [order, setOrder] = React.useState<OrderDetailData | null>(null);
  const [currency, setCurrency] = React.useState("NGN");
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<OrderStatus | null>(null);
  const now = useNow();
  const router = useRouter();
  const url = `/api/orders/${encodeURIComponent(id)}`;

  const load = React.useCallback(async () => {
    setLoadError(null);
    try {
      const res = await apiFetch<{ order: OrderDetailData; currency: string }>(url);
      setOrder(res.order);
      setCurrency(res.currency);
    } catch (err) {
      setLoadError(errorMessage(err, "Couldn't load this order"));
    }
  }, [url]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function changeStatus(status: OrderStatus) {
    setPending(status);
    try {
      await apiFetch(url, { method: "PATCH", json: { status } });
      toast.success(status === "CANCELLED" ? "Order cancelled. The customer has been told." : `${NEXT_ACTION[status]?.done ?? STATUS_LABELS[status]}. The customer gets a WhatsApp update.`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't update the order"));
    } finally {
      // Reload either way: on a conflict someone else may have changed the status.
      await load();
      setPending(null);
      // The sidebar/tab-bar "new orders" badge is rendered by the dashboard layout.
      router.refresh();
    }
  }

  if (!order) {
    return (
      <div className="space-y-6">
        <PageHeader className="mb-0" title="Order" back={BACK} />
        {loadError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <span>{loadError}</span>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-4" aria-busy="true" aria-label="Loading order">
            <Skeleton className="h-24 w-full rounded-xl" />
            <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
              <Skeleton className="h-64 w-full rounded-xl" />
              <Skeleton className="h-48 w-full rounded-xl" />
            </div>
          </div>
        )}
      </div>
    );
  }

  const forward = order.allowedNext.filter((s) => s !== "CANCELLED");
  const canCancel = order.allowedNext.includes("CANCELLED");

  return (
    <div className="space-y-6">
      <PageHeader
        className="mb-0"
        title={order.number}
        description={`Placed ${formatRelative(order.createdAt, now)} · ${plural(order.items.reduce((n, i) => n + i.quantity, 0), "item")} · ${formatMoney(order.totalKobo, currency)}`}
        back={BACK}
        actions={<StatusBadge status={order.status} className="px-3 py-1 text-sm" />}
      />

      <Card className={cn(order.status === "NEW" && "border-sky-500/40 bg-sky-500/[0.04]")}>
        <CardContent className="space-y-3 p-4 sm:p-5">
          {forward.length > 0 ? (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                {forward.map((s) => {
                  const action = NEXT_ACTION[s];
                  const Icon = action?.icon ?? CheckCircle2;
                  return (
                    <Button key={s} size="lg" className="h-12 w-full text-base sm:w-auto sm:min-w-56" onClick={() => void changeStatus(s)} disabled={pending !== null}>
                      {pending === s ? <Spinner /> : <Icon aria-hidden />}
                      {action?.label ?? STATUS_LABELS[s]}
                    </Button>
                  );
                })}
                {canCancel && (
                  <ConfirmButton
                    variant="ghost"
                    className="h-12 w-full text-destructive hover:text-destructive sm:ml-auto sm:w-auto"
                    disabled={pending !== null}
                    title={`Cancel ${order.number}?`}
                    description={`${order.customerName} gets a WhatsApp message that the order was cancelled. This can't be undone.`}
                    confirmLabel="Cancel order"
                    destructive
                    onConfirm={() => changeStatus("CANCELLED")}
                  >
                    <XCircle aria-hidden />
                    Cancel order
                  </ConfirmButton>
                )}
              </div>
              <p className="text-xs text-muted-foreground">The customer gets a WhatsApp update each time you move the order forward.</p>
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm">
              {order.status === "DELIVERED" ? (
                <>
                  <CheckCircle2 className="size-5 text-emerald-600" aria-hidden /> This order was delivered. Nothing left to do.
                </>
              ) : (
                <>
                  <XCircle className="size-5 text-muted-foreground" aria-hidden /> This order was cancelled.
                </>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Items</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {order.items.map((i) => (
                  <li key={i.id} className="flex items-start gap-3 py-3 text-sm first:pt-0">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold tabular-nums">{i.quantity}×</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium break-words">{i.nameSnapshot}</p>
                      <p className="text-muted-foreground tabular-nums">{formatMoney(i.unitPriceKobo, currency)} each</p>
                    </div>
                    <span className="shrink-0 font-medium tabular-nums">{formatMoney(i.unitPriceKobo * i.quantity, currency)}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-3 space-y-1.5 border-t pt-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="tabular-nums">{formatMoney(order.subtotalKobo, currency)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Delivery</dt>
                  <dd className="tabular-nums">{order.deliveryFeeKobo > 0 ? formatMoney(order.deliveryFeeKobo, currency) : "Free"}</dd>
                </div>
                <div className="flex justify-between border-t pt-2 text-base font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{formatMoney(order.totalKobo, currency)}</dd>
                </div>
              </dl>
              {order.notes && (
                <div className="mt-4 rounded-lg bg-amber-500/10 p-3 text-sm">
                  <p className="font-medium">Customer note</p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words">{order.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-0">
                {order.events.map((e, idx) => {
                  const last = idx === order.events.length - 1;
                  return (
                    <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
                      {!last && <span className="absolute left-[0.4375rem] top-5 h-[calc(100%-1rem)] w-px bg-border" aria-hidden />}
                      <span
                        className={cn("mt-1 size-3.5 shrink-0 rounded-full border-2", last ? "border-primary bg-primary" : "border-muted-foreground/40 bg-background")}
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{e.fromStatus === null ? "Order placed on WhatsApp" : STATUS_LABELS[e.toStatus]}</p>
                        <p className="text-xs text-muted-foreground">
                          <time dateTime={e.createdAt} title={formatDateTime(e.createdAt)}>
                            {formatRelative(e.createdAt, now)}
                          </time>
                          {e.fromStatus !== null && (e.byUserName ? ` · by ${e.byUserName}` : " · automatically")}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <CustomerCard order={order} />
        </div>
      </div>
    </div>
  );
}

function CustomerCard({ order }: { order: OrderDetailData }) {
  const phone = order.customer.phone;

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(order.deliveryAddress);
      toast.success("Address copied");
    } catch {
      toast.error("Couldn't copy. Select the address and copy it manually.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Customer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <p className="text-base font-medium">{order.customerName}</p>
          <p className="text-muted-foreground">{formatPhone(phone)}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <a href={`tel:+${phone}`} className={buttonVariants({ variant: "outline", className: "h-11" })}>
            <Phone aria-hidden />
            Call
          </a>
          <a href={whatsappLink(phone)} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", className: "h-11" })}>
            <MessageCircle aria-hidden />
            WhatsApp
          </a>
        </div>
        {order.conversationId && (
          <Link href={`/dashboard/conversations/${order.conversationId}`} className={buttonVariants({ variant: "secondary", className: "h-11 w-full" })}>
            <MessageCircle aria-hidden />
            Open chat in dashboard
          </Link>
        )}

        <div className="space-y-1.5 border-t pt-4">
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="size-4" aria-hidden />
            Delivery address
          </p>
          <p className="whitespace-pre-wrap break-words">{order.deliveryAddress}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="ghost" size="sm" className="h-10 px-2" onClick={() => void copyAddress()}>
              <Copy aria-hidden />
              Copy
            </Button>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.deliveryAddress)}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "ghost", size: "sm", className: "h-10 px-2" })}
            >
              <MapPin aria-hidden />
              Open in Maps
            </a>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
