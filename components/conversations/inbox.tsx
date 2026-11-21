"use client";

import * as React from "react";
import Link from "next/link";
import type { MessageDirection, MessageSender } from "@prisma/client";
import { Camera, MessagesSquare, PauseCircle, Search, SearchX } from "lucide-react";
import { apiFetch } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/misc";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { errorMessage, formatDateTime, formatPhone, formatShortTime } from "@/components/orders/format";
import { useDebounced, useNow, useVisiblePoll } from "@/components/orders/hooks";
import { Avatar } from "./avatar";

type InboxRow = {
  id: string;
  needsHuman: boolean;
  needsHumanNote: string | null;
  botPaused: boolean;
  lastMessageAt: string;
  customer: { id: string; name: string | null; phone: string; orderCount: number };
  lastMessage: { body: string; type: string; direction: MessageDirection; sender: MessageSender; createdAt: string } | null;
};
type InboxCounts = { needsHuman: number; botPaused: number };
/** `counts` are tenant-wide (not affected by the filter or search). */
type InboxResponse = { conversations: InboxRow[]; nextCursor: string | null; counts: InboxCounts };

type Filter = "all" | "needs" | "paused";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "needs", label: "Needs you" },
  { value: "paused", label: "Bot paused" },
];
const POLL_MS = 15_000;

function previewText(m: InboxRow["lastMessage"]): string {
  if (!m) return "No messages yet";
  const prefix = m.sender === "BOT" ? "Bot: " : m.sender === "STAFF" ? "You: " : "";
  return prefix + (m.body.trim() || (m.type === "image" ? "Photo" : ""));
}

export function ConversationInbox() {
  const [filter, setFilter] = React.useState<Filter>("all");
  const [qInput, setQInput] = React.useState("");
  const q = useDebounced(qInput.trim(), 300);
  const now = useNow();

  const [data, setData] = React.useState<InboxResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const seq = React.useRef(0);

  const qs = React.useMemo(() => {
    const p = new URLSearchParams();
    if (filter === "needs") p.set("needsHuman", "true");
    if (filter === "paused") p.set("botPaused", "true");
    if (q) p.set("q", q);
    return p.toString();
  }, [filter, q]);

  const load = React.useCallback(
    async (silent = false) => {
      const id = silent ? seq.current : ++seq.current;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await apiFetch<InboxResponse>(`/api/conversations?${qs}`);
        if (id !== seq.current) return;
        // A background refresh only replaces the first page; keep pages already loaded below it.
        setData((prev) => {
          if (!silent || !prev || prev.conversations.length <= res.conversations.length) return res;
          const ids = new Set(res.conversations.map((c) => c.id));
          return { ...res, conversations: [...res.conversations, ...prev.conversations.filter((c) => !ids.has(c.id))], nextCursor: prev.nextCursor };
        });
        setError(null);
      } catch (err) {
        if (id === seq.current) setError(errorMessage(err, "Couldn't load conversations"));
      } finally {
        if (!silent && id === seq.current) setLoading(false);
      }
    },
    [qs],
  );

  React.useEffect(() => {
    void load();
  }, [load]);
  useVisiblePoll(() => void load(true), POLL_MS);

  async function loadMore() {
    if (!data?.nextCursor) return;
    setLoadingMore(true);
    try {
      const p = new URLSearchParams(qs);
      p.set("cursor", data.nextCursor);
      const next = await apiFetch<InboxResponse>(`/api/conversations?${p}`);
      setData((d) => ({ ...next, conversations: [...(d?.conversations ?? []), ...next.conversations] }));
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load more conversations"));
    } finally {
      setLoadingMore(false);
    }
  }

  const rows = data?.conversations ?? [];
  const counts = data?.counts;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="relative">
          <Label htmlFor="conv-search" className="sr-only">
            Search conversations
          </Label>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id="conv-search"
            type="search"
            placeholder="Search name or phone"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            className="h-11 rounded-full pl-9"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Filter conversations">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filter === f.value ? "border-transparent bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {f.label}
              {counts && f.value !== "all" && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[11px] font-semibold leading-5 tabular-nums",
                    f.value === "needs" && counts.needsHuman > 0
                      ? "bg-amber-500 text-white"
                      : filter === f.value
                        ? "bg-primary-foreground/20"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  <span className="sr-only">(</span>
                  {f.value === "needs" ? counts.needsHuman : counts.botPaused}
                  <span className="sr-only"> chats)</span>
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : !data ? (
        <div className="divide-y rounded-xl border" aria-busy="true" aria-label="Loading conversations">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 p-3">
              <Skeleton className="size-12 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        q ? (
          <EmptyState icon={SearchX} title="No conversations match" description="Try a different name or number." />
        ) : filter === "needs" ? (
          <EmptyState icon={MessagesSquare} title="No one is waiting for you" description="When the bot hands a chat over, it shows up here." />
        ) : filter === "paused" ? (
          <EmptyState icon={PauseCircle} title="The bot is answering every chat" description="No chats have the bot paused right now." />
        ) : (
          <EmptyState icon={MessagesSquare} title="No conversations yet" description="When customers message your WhatsApp number, their chats appear here." />
        )
      ) : (
        <div className={cn("space-y-3 transition-opacity", loading && "opacity-60")} aria-busy={loading}>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {rows.map((c) => (
              <InboxItem key={c.id} c={c} now={now} />
            ))}
          </ul>
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
    </div>
  );
}

function InboxItem({ c, now }: { c: InboxRow; now: Date }) {
  const name = c.customer.name || formatPhone(c.customer.phone);
  const fromCustomer = c.lastMessage?.sender === "CUSTOMER";
  return (
    <li>
      <Link
        href={`/dashboard/conversations/${c.id}`}
        className={cn(
          "flex items-center gap-3 px-3 py-3 transition-colors hover:bg-muted/50 active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          c.needsHuman && "bg-amber-500/[0.07]",
        )}
      >
        <Avatar name={c.customer.name} phone={c.customer.phone} attention={c.needsHuman} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className={cn("truncate", c.needsHuman ? "font-semibold" : "font-medium")}>{name}</span>
            <time
              dateTime={c.lastMessageAt}
              title={formatDateTime(c.lastMessageAt)}
              className={cn("shrink-0 text-xs", c.needsHuman ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted-foreground")}
            >
              {formatShortTime(c.lastMessageAt, now)}
            </time>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <p className={cn("flex min-w-0 flex-1 items-center gap-1 text-sm", c.needsHuman && fromCustomer ? "text-foreground" : "text-muted-foreground")}>
              {c.lastMessage?.type === "image" && <Camera className="size-3.5 shrink-0" aria-label="Photo" />}
              <span className="truncate">{previewText(c.lastMessage)}</span>
            </p>
            {c.needsHuman ? (
              <span className="shrink-0 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white">Needs you</span>
            ) : (
              c.botPaused && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  <PauseCircle className="size-3" aria-hidden />
                  Bot paused
                </span>
              )
            )}
          </div>
          {c.needsHuman && c.needsHumanNote && <p className="mt-0.5 truncate text-xs text-amber-800 dark:text-amber-200">{c.needsHumanNote}</p>}
        </div>
      </Link>
    </li>
  );
}
