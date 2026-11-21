"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, SendHorizontal } from "lucide-react";
import { apiFetch } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";

type Action = { tool: string; ok: boolean; simulated: boolean; summary: string };
type Turn = { from: "customer" | "bot"; text: string; at: number; actions?: Action[] };
type TestResponse = { replies: string[]; actions: Action[]; handedOff: boolean };

const MAX_HISTORY = 20;
const TOOL_LABELS: Record<string, string> = {
  list_products: "Looked up products",
  send_product_images: "Photos",
  quote_order: "Priced order",
  create_order: "Order",
  get_order_status: "Order status",
  request_human: "Handoff",
};
const SUGGESTIONS = ["Hi, what do you have today?", "How much is delivery?", "I want to order", "Can I talk to a person?"];
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-hidden>
      {[0, 150, 300].map((delay) => (
        <span key={delay} className="size-2 animate-typing rounded-full bg-muted-foreground" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  );
}

export function TestBotPanel({ botName, businessName, unsavedChanges }: { botName: string; businessName: string; unsavedChanges?: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailed, setLastFailed] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, pending]);

  async function send(message: string) {
    const text = message.trim();
    if (!text || pending) return;
    const history = turns.slice(-MAX_HISTORY).map(({ from, text }) => ({ from, text }));
    setTurns((t) => [...t, { from: "customer", text, at: Date.now() }]);
    setDraft("");
    setError(null);
    setLastFailed(null);
    setPending(true);
    try {
      const res = await apiFetch<TestResponse>("/api/settings/bot/test", { method: "POST", json: { history, message: text } });
      const at = Date.now();
      setTurns((t) => [...t, ...res.replies.map((r, i) => ({ from: "bot" as const, text: r, at, actions: i === 0 ? res.actions : undefined }))]);
    } catch (err) {
      // Drop the unanswered message so a retry doesn't duplicate it in the transcript.
      setTurns((t) => t.slice(0, -1));
      setLastFailed(text);
      setError(err instanceof Error ? err.message : "The bot could not reply");
    } finally {
      setPending(false);
    }
  }

  const initials = (botName || businessName || "B").trim().slice(0, 1).toUpperCase();

  return (
    <section aria-labelledby="test-title" className="mx-auto grid max-w-2xl gap-4">
      <div className="space-y-1">
        <h2 id="test-title" className="text-base font-semibold">
          Try your bot
        </h2>
        <p className="text-sm text-muted-foreground">
          Chat like a customer would. It uses your saved settings and real products.{" "}
          <span className="font-medium text-foreground">Nothing is sent to WhatsApp, no orders are saved and nobody is alerted.</span>
        </p>
        {unsavedChanges ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">You have unsaved changes. Save them first if you want the bot to use them.</p>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-2xl border shadow-md">
        <div className="flex items-center gap-3 bg-primary px-4 py-3 text-primary-foreground">
          <span aria-hidden className="flex size-10 items-center justify-center rounded-full bg-white/20 font-semibold">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-tight">{businessName}</p>
            <p className="truncate text-xs opacity-85">{pending ? "typing…" : `${botName} · test chat`}</p>
          </div>
          <Badge className="border-white/30 bg-white/15 text-primary-foreground">Dry run</Badge>
        </div>

        <div ref={scrollRef} className="h-[26rem] overflow-y-auto bg-chat-bg px-3 py-4 sm:px-4">
          <ol className="flex min-h-full flex-col gap-1.5" aria-live="polite" aria-label="Test conversation">
            {turns.length === 0 && !pending ? (
              <li className="m-auto flex max-w-xs flex-col items-center gap-3 text-center">
                <p className="rounded-lg bg-card/80 px-3 py-2 text-xs text-muted-foreground shadow-sm">Send a message to start. Try one of these:</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      className="min-h-9 rounded-full border bg-card px-3 text-sm shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </li>
            ) : null}
            {turns.map((t, i) => {
              const mine = t.from === "customer";
              const firstOfGroup = i === 0 || turns[i - 1].from !== t.from;
              return (
                <li key={i} className={cn("flex max-w-[85%] flex-col gap-1", mine ? "items-end self-end" : "items-start self-start", firstOfGroup && i > 0 && "mt-2")}>
                  <span className="sr-only">{mine ? "You (as customer):" : `${botName}:`}</span>
                  <div
                    className={cn(
                      "rounded-xl px-3 py-1.5 text-[15px] leading-snug text-foreground shadow-sm",
                      mine ? "bg-bubble-out" : "bg-bubble-in",
                      firstOfGroup && (mine ? "rounded-tr-sm" : "rounded-tl-sm"),
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words">{t.text}</p>
                    <p className="mt-0.5 text-right text-[11px] text-muted-foreground tabular-nums">{timeFmt.format(t.at)}</p>
                  </div>
                  {t.actions?.length ? (
                    <ul className="flex flex-wrap gap-1" aria-label="What the bot did">
                      {t.actions.map((a, j) => (
                        <li key={j}>
                          <Badge
                            variant={!a.ok ? "destructive" : a.simulated ? "warning" : "secondary"}
                            className="max-w-full whitespace-normal font-normal"
                            title={a.summary}
                          >
                            {TOOL_LABELS[a.tool] ?? a.tool}: {a.summary}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
            {pending ? (
              <li className="mt-2 self-start">
                <span className="sr-only">{botName} is typing</span>
                <div className="rounded-xl rounded-tl-sm bg-bubble-in px-3.5 py-2 shadow-sm">
                  <TypingDots />
                </div>
              </li>
            ) : null}
          </ol>
        </div>

        <form
          className="flex items-center gap-2 border-t bg-card p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <label htmlFor="test-message" className="sr-only">
            Message
          </label>
          <input
            id="test-message"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a message"
            maxLength={2000}
            autoComplete="off"
            className="h-11 min-w-0 flex-1 rounded-full border border-input bg-background px-4 text-base outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 md:text-sm"
          />
          <Button type="submit" size="icon" className="shrink-0 rounded-full" disabled={pending || !draft.trim()} aria-label="Send">
            <SendHorizontal aria-hidden />
          </Button>
        </form>
      </div>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span className="flex-1">{error}</span>
          {lastFailed ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void send(lastFailed)}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}

      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setTurns([]);
            setError(null);
            setLastFailed(null);
          }}
          disabled={pending || turns.length === 0}
        >
          <RotateCcw aria-hidden /> Start a new chat
        </Button>
      </div>
    </section>
  );
}
