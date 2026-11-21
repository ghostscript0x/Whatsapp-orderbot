"use client";

import * as React from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastKind = "default" | "success" | "error";
type ToastItem = { id: number; kind: ToastKind; message: string };

const DURATION_MS: Record<ToastKind, number> = { default: 4000, success: 3500, error: 6000 };
const MAX_VISIBLE = 4;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const l of listeners) l();
}

function dismiss(id: number) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  items = items.filter((i) => i.id !== id);
  emit();
}

function push(kind: ToastKind, message: string) {
  const id = nextId++;
  const next = [...items, { id, kind, message }];
  for (const dropped of next.slice(0, Math.max(0, next.length - MAX_VISIBLE))) {
    const t = timers.get(dropped.id);
    if (t) clearTimeout(t);
    timers.delete(dropped.id);
  }
  items = next.slice(-MAX_VISIBLE);
  timers.set(id, setTimeout(() => dismiss(id), DURATION_MS[kind]));
  emit();
  return id;
}

type ToastFn = ((message: string) => number) & {
  success: (message: string) => number;
  error: (message: string) => number;
  dismiss: (id: number) => void;
};

/** Fire-and-forget notifications. Requires <Toaster /> to be mounted once. */
export const toast: ToastFn = Object.assign((message: string) => push("default", message), {
  success: (message: string) => push("success", message),
  error: (message: string) => push("error", message),
  dismiss,
});

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getSnapshot = () => items;
const EMPTY: ToastItem[] = [];
const getServerSnapshot = () => EMPTY;

const ICONS = { default: Info, success: CheckCircle2, error: XCircle } as const;

export function Toaster() {
  const list = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:inset-x-auto md:bottom-6 md:right-6 md:items-end md:px-0">
      {/* Separate live regions: errors interrupt screen readers, everything else waits politely. */}
      <div role="status" aria-live="polite" className="flex w-full flex-col items-center gap-2 md:items-end">
        {list
          .filter((t) => t.kind !== "error")
          .map((t) => (
            <ToastCard key={t.id} item={t} />
          ))}
      </div>
      <div role="alert" aria-live="assertive" className="flex w-full flex-col items-center gap-2 md:items-end">
        {list
          .filter((t) => t.kind === "error")
          .map((t) => (
            <ToastCard key={t.id} item={t} />
          ))}
      </div>
    </div>
  );
}

function ToastCard({ item }: { item: ToastItem }) {
  const Icon = ICONS[item.kind];
  return (
    <div className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-xl border bg-card p-3.5 pr-2 text-sm text-card-foreground shadow-lg md:w-96">
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-5 shrink-0",
          item.kind === "success" && "text-success",
          item.kind === "error" && "text-destructive",
          item.kind === "default" && "text-muted-foreground",
        )}
      />
      <p className="flex-1 pt-0.5 leading-snug">{item.message}</p>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label="Dismiss notification"
        className="-my-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
