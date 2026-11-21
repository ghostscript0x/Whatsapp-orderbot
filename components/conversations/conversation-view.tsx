"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MessageDirection, MessageSender } from "@prisma/client";
import { AlertTriangle, ArrowDown, ArrowLeft, Bot, ImageOff, Phone, Receipt, RotateCcw, Send, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Label, Switch } from "@/components/ui/misc";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { errorMessage, formatDateTime, formatDayLabel, formatPhone, formatTime, plural } from "@/components/orders/format";
import { useVisiblePoll } from "@/components/orders/hooks";
import { Avatar } from "./avatar";

type ChatMessage = {
  id: string;
  direction: MessageDirection;
  sender: MessageSender;
  type: string;
  body: string;
  mediaUrl: string | null;
  createdAt: string;
};
type ConversationData = {
  id: string;
  botPaused: boolean;
  botPausedAt: string | null;
  needsHuman: boolean;
  needsHumanNote: string | null;
  lastStaffReplyAt: string | null;
  customer: { id: string; name: string | null; phone: string; firstSeenAt: string; orderCount: number };
  messages: ChatMessage[];
};
type FlagPatch = { botPaused?: boolean; needsHuman?: boolean };
/** A staff reply that the server hasn't confirmed yet. */
type PendingReply = { tempId: string; body: string; createdAt: string; state: "sending" | "failed" };

const POLL_MS = 5_000;
const MAX_REPLY = 4000;
const MAX_COMPOSER_PX = 160;

export function ConversationView({ id }: { id: string }) {
  const router = useRouter();
  const [conv, setConv] = React.useState<ConversationData | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [savingFlag, setSavingFlag] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [pending, setPending] = React.useState<PendingReply[]>([]);
  const [atBottom, setAtBottom] = React.useState(true);
  const [unseen, setUnseen] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);
  const composerRef = React.useRef<HTMLTextAreaElement>(null);
  const firstScroll = React.useRef(true);
  const url = `/api/conversations/${encodeURIComponent(id)}`;

  const load = React.useCallback(async () => {
    try {
      const res = await apiFetch<{ conversation: ConversationData }>(url);
      setConv(res.conversation);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, "Couldn't load this conversation"));
    }
  }, [url]);

  React.useEffect(() => {
    void load();
  }, [load]);
  useVisiblePoll(() => void load(), POLL_MS);

  // Track whether the end of the chat is on screen, so new messages only auto-scroll when the user is already there.
  const hasConv = conv !== null;
  React.useEffect(() => {
    const el = endRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      setAtBottom(entry.isIntersecting);
      if (entry.isIntersecting) setUnseen(false);
    }, { rootMargin: "0px 0px 160px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasConv]);

  const lastKey = `${conv?.messages.at(-1)?.id ?? ""}:${pending.length}`;
  React.useEffect(() => {
    if (!conv) return;
    if (firstScroll.current) {
      firstScroll.current = false;
      endRef.current?.scrollIntoView({ block: "end" });
    } else if (atBottom) {
      endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    } else {
      setUnseen(true);
    }
    // Only react to new messages, not to scroll position changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastKey]);

  async function patch(data: FlagPatch, success: string) {
    setSavingFlag(true);
    try {
      const res = await apiFetch<{ conversation: Pick<ConversationData, "botPaused" | "botPausedAt" | "needsHuman" | "needsHumanNote"> }>(url, {
        method: "PATCH",
        json: data,
      });
      setConv((c) => (c ? { ...c, ...res.conversation } : c));
      // The "needs you" badge in the sidebar/tab bar is rendered by the dashboard layout.
      router.refresh();
      toast.success(success);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't update the conversation"));
    } finally {
      setSavingFlag(false);
    }
  }

  async function deliver(reply: PendingReply) {
    setPending((list) => list.map((p) => (p.tempId === reply.tempId ? { ...p, state: "sending" } : p)));
    try {
      const res = await apiFetch<{ message: ChatMessage }>(`${url}/messages`, { method: "POST", json: { body: reply.body } });
      setPending((list) => list.filter((p) => p.tempId !== reply.tempId));
      setConv((c) =>
        c ? { ...c, botPaused: true, messages: c.messages.some((m) => m.id === res.message.id) ? c.messages : [...c.messages, res.message] } : c,
      );
    } catch (err) {
      setPending((list) => list.map((p) => (p.tempId === reply.tempId ? { ...p, state: "failed" } : p)));
      toast.error(errorMessage(err, "Your reply wasn't sent"));
    }
  }

  function send() {
    const body = draft.trim();
    if (!body) return;
    const reply: PendingReply = { tempId: `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`, body, createdAt: new Date().toISOString(), state: "sending" };
    setPending((list) => [...list, reply]);
    setDraft("");
    setAtBottom(true);
    if (composerRef.current) composerRef.current.style.height = "";
    void deliver(reply);
  }

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_PX)}px`;
  }

  if (!conv) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <BackLink />
        {loadError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <span>{loadError}</span>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-3" aria-busy="true" aria-label="Loading conversation">
            <div className="flex items-center gap-3">
              <Skeleton className="size-11 rounded-full" />
              <Skeleton className="h-5 w-40" />
            </div>
            <Skeleton className="ml-0 h-12 w-2/3 rounded-2xl" />
            <Skeleton className="ml-auto h-16 w-3/5 rounded-2xl" />
            <Skeleton className="h-10 w-1/2 rounded-2xl" />
          </div>
        )}
      </div>
    );
  }

  const customerName = conv.customer.name || formatPhone(conv.customer.phone);
  const botOn = !conv.botPaused;
  const groups = groupByDay(conv.messages);

  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b pb-4">
        <Link href="/dashboard/conversations" className={buttonVariants({ variant: "ghost", size: "icon", className: "-ml-2 size-11" })} aria-label="All conversations">
          <ArrowLeft aria-hidden />
        </Link>
        <Avatar name={conv.customer.name} phone={conv.customer.phone} className="size-11" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold leading-tight">{customerName}</h1>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <a href={`tel:+${conv.customer.phone}`} className="inline-flex min-h-6 items-center gap-1 underline-offset-4 hover:underline">
              <Phone className="size-3.5" aria-hidden />
              {formatPhone(conv.customer.phone)}
            </a>
            {conv.customer.orderCount > 0 && (
              <Link
                href={`/dashboard/orders?status=ALL&q=${encodeURIComponent(conv.customer.phone)}`}
                className="inline-flex min-h-6 items-center gap-1 text-primary underline-offset-4 hover:underline"
              >
                <Receipt className="size-3.5" aria-hidden />
                {plural(conv.customer.orderCount, "order")}
              </Link>
            )}
          </p>
        </div>
        <div className="flex w-full items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2 sm:w-auto">
          <div className="min-w-0">
            <Label htmlFor="bot-on" className="flex items-center gap-1.5">
              <Bot className="size-4" aria-hidden />
              Bot {botOn ? "on" : "paused"}
            </Label>
            <p id="bot-on-help" className="text-xs text-muted-foreground">
              {botOn ? "Replies to this customer automatically" : "Only you reply. Turns back on after 12 h without a staff reply."}
            </p>
          </div>
          <Switch
            id="bot-on"
            aria-describedby="bot-on-help"
            checked={botOn}
            disabled={savingFlag}
            onCheckedChange={(on) => void patch({ botPaused: !on }, on ? "Bot is back on for this chat" : "Bot paused. You're handling this chat.")}
          />
        </div>
      </div>

      {conv.needsHuman && (
        <div role="status" className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium">This customer is waiting for a person</p>
              <p className="break-words text-muted-foreground">{conv.needsHumanNote || "The bot handed this chat over and paused itself."}</p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" className="h-10 flex-1" disabled={savingFlag} onClick={() => void patch({ needsHuman: false }, "Marked resolved. The bot stays paused.")}>
              Mark resolved
            </Button>
            <Button className="h-10 flex-1" disabled={savingFlag} onClick={() => void patch({ botPaused: false }, "Resolved and handed back to the bot")}>
              Hand back to bot
            </Button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="min-h-[50dvh] flex-1 py-4" aria-label="Messages">
        {conv.messages.length === 0 && pending.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <section key={g.key} aria-label={formatDayLabel(g.messages[0].createdAt)}>
                <DaySeparator iso={g.messages[0].createdAt} />
                <ol className="space-y-1.5">
                  {g.messages.map((m, i) => (
                    <Bubble key={m.id} m={m} grouped={i > 0 && g.messages[i - 1].sender === m.sender} />
                  ))}
                </ol>
              </section>
            ))}
            {pending.length > 0 && (
              <ol className="space-y-1.5" aria-label="Replies being sent">
                {pending.map((p) => (
                  <PendingBubble key={p.tempId} p={p} onRetry={() => void deliver(p)} onDiscard={() => setPending((list) => list.filter((x) => x.tempId !== p.tempId))} />
                ))}
              </ol>
            )}
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:mx-0 sm:px-0"
      >
        {unseen && !atBottom && (
          <button
            type="button"
            onClick={() => endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" })}
            className="absolute -top-12 left-1/2 inline-flex min-h-10 -translate-x-1/2 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-medium shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowDown className="size-4" aria-hidden />
            New messages
          </button>
        )}
        <Label htmlFor="reply" className="sr-only">
          Reply to {customerName}
        </Label>
        <div className="flex items-end gap-2">
          <Textarea
            ref={composerRef}
            id="reply"
            rows={1}
            maxLength={MAX_REPLY}
            placeholder="Type a reply"
            aria-describedby="reply-help"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              autoGrow(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            className="max-h-40 min-h-11 resize-none rounded-2xl py-2.5"
          />
          <Button type="submit" size="icon" className="size-11 shrink-0 rounded-full" disabled={!draft.trim()} aria-label="Send reply">
            <Send aria-hidden />
          </Button>
        </div>
        <p id="reply-help" className="mt-1.5 text-xs text-muted-foreground">
          {botOn ? "Sending a reply pauses the bot for this chat. " : ""}
          <span className="hidden sm:inline">Enter to send, Shift+Enter for a new line.</span>
        </p>
      </form>
      <div ref={endRef} aria-hidden />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/dashboard/conversations" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden />
      All conversations
    </Link>
  );
}

function groupByDay(messages: ChatMessage[]): { key: string; messages: ChatMessage[] }[] {
  const groups: { key: string; messages: ChatMessage[] }[] = [];
  for (const m of messages) {
    const key = new Date(m.createdAt).toDateString();
    const last = groups.at(-1);
    if (last && last.key === key) last.messages.push(m);
    else groups.push({ key, messages: [m] });
  }
  return groups;
}

function DaySeparator({ iso }: { iso: string }) {
  return (
    <div className="my-3 flex justify-center">
      <span className="rounded-full border bg-background/95 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">{formatDayLabel(iso)}</span>
    </div>
  );
}

function Bubble({ m, grouped }: { m: ChatMessage; grouped: boolean }) {
  const outgoing = m.direction === "OUT";
  const staff = m.sender === "STAFF";
  return (
    <li className={cn("flex", outgoing ? "justify-end" : "justify-start", !grouped && "pt-1.5")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 text-[15px] leading-snug shadow-sm sm:max-w-[70%]",
          outgoing ? "rounded-br-md" : "rounded-bl-md border bg-card",
          m.sender === "BOT" && "bg-primary/10 text-foreground",
          staff && "bg-primary text-primary-foreground",
        )}
      >
        {outgoing && !grouped && (
          <p className={cn("mb-0.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide", staff ? "text-primary-foreground/80" : "text-primary")}>
            {staff ? "You" : (
              <>
                <Bot className="size-3" aria-hidden /> Bot
              </>
            )}
          </p>
        )}
        {!outgoing && <span className="sr-only">Customer: </span>}
        {m.type === "image" &&
          (m.mediaUrl ? (
            <a href={m.mediaUrl} target="_blank" rel="noopener noreferrer" className="-mx-1 mb-1 block overflow-hidden rounded-xl">
              {/* Remote WhatsApp/storage media with unknown dimensions; next/image would need per-host config. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.mediaUrl} alt={m.body ? `Photo: ${m.body}` : "Photo sent in chat"} loading="lazy" className="max-h-72 w-auto bg-muted object-contain" />
            </a>
          ) : (
            <p className="mb-1 flex items-center gap-1.5 italic opacity-80">
              <ImageOff className="size-4" aria-hidden /> Photo not available
            </p>
          ))}
        {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
        <time
          dateTime={m.createdAt}
          title={formatDateTime(m.createdAt)}
          className={cn("mt-0.5 block text-right text-[11px] tabular-nums", staff ? "text-primary-foreground/70" : "text-muted-foreground")}
        >
          {formatTime(m.createdAt)}
        </time>
      </div>
    </li>
  );
}

function PendingBubble({ p, onRetry, onDiscard }: { p: PendingReply; onRetry: () => void; onDiscard: () => void }) {
  const failed = p.state === "failed";
  return (
    <li className="flex flex-col items-end gap-1">
      <div
        className={cn(
          "max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-[15px] leading-snug shadow-sm sm:max-w-[70%]",
          failed ? "border border-destructive/50 bg-destructive/10" : "bg-primary/80 text-primary-foreground",
        )}
      >
        <p className="whitespace-pre-wrap break-words">{p.body}</p>
        {!failed && (
          <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-primary-foreground/80">
            <Spinner className="size-3" /> Sending…
          </p>
        )}
      </div>
      {failed && (
        <div className="flex items-center gap-1 text-xs text-destructive" role="alert">
          <span>Not sent.</span>
          <Button type="button" variant="ghost" size="sm" className="h-9 px-2 text-destructive" onClick={onRetry}>
            <RotateCcw aria-hidden /> Retry
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-9 px-2 text-muted-foreground" onClick={onDiscard}>
            <Trash2 aria-hidden /> Discard
          </Button>
        </div>
      )}
    </li>
  );
}
