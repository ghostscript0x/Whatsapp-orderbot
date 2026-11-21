import { DAYS, DAY_LABELS, localDayAndMinutes, parseBusinessHours } from "@/lib/business-hours";

/**
 * Pure helpers that make the bot feel like a person at the shop: read/typing timing, burst
 * debouncing, splitting a reply into WhatsApp bubbles, and describing inbound media for the model.
 * No I/O here; the worker (worker/inbound-message.ts) does the sending and waiting.
 * All tunables are the constants below. Randomness is injectable (`rand`) so tests are deterministic.
 */

export type Rand = () => number;

// ---- tunables ----

/** Wait this long after the customer's latest message before answering (they often send 2-4 quick messages). */
export const BURST_QUIET_MS = 4_000;
/** ...but never wait longer than this after the first unanswered message of a burst. */
export const BURST_MAX_WAIT_MS = 10_000;
/** Unanswered messages older than this (relative to the newest) are history, not part of the burst. */
export const BURST_LOOKBACK_MS = 120_000;
/** At most this many messages are answered as one burst. */
export const BURST_MAX_MESSAGES = 6;

/** "Seen" ticks appear 1-3 s after the message (overlaps the quiet window, so usually no extra wait). */
export const READ_DELAY_MIN_MS = 1_000;
export const READ_DELAY_MAX_MS = 3_000;
/** Pause between turning blue and starting to type. */
export const READ_TO_TYPING_MIN_MS = 400;
export const READ_TO_TYPING_MAX_MS = 1_200;

/** Typing speed: ms per character, picked per bubble. */
export const TYPING_MS_PER_CHAR_MIN = 35;
export const TYPING_MS_PER_CHAR_MAX = 60;
export const TYPING_MIN_MS = 1_200;
export const TYPING_MAX_MS = 6_000;
/** Total typing time for all bubbles of one reply is scaled down to fit this budget. */
export const TYPING_TOTAL_BUDGET_MS = 9_000;
/** Short gap after a bubble is sent before typing the next one. */
export const BETWEEN_BUBBLES_MIN_MS = 300;
export const BETWEEN_BUBBLES_MAX_MS = 900;
/** Gap between product photos. */
export const BETWEEN_IMAGES_MIN_MS = 700;
export const BETWEEN_IMAGES_MAX_MS = 1_600;

export const MAX_BUBBLES = 3;
/** OpenWA send-text limit is 4096 chars; stay under it. */
export const MAX_BUBBLE_CHARS = 4_000;
/** A single prose paragraph longer than this may be split into two bubbles at a sentence boundary. */
export const LONG_PARAGRAPH_CHARS = 260;

const between = (min: number, max: number, rand: Rand) => Math.round(min + (max - min) * clamp01(rand()));
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);

export const readDelayMs = (rand: Rand = Math.random) => between(READ_DELAY_MIN_MS, READ_DELAY_MAX_MS, rand);
export const readToTypingMs = (rand: Rand = Math.random) => between(READ_TO_TYPING_MIN_MS, READ_TO_TYPING_MAX_MS, rand);
export const betweenBubblesMs = (rand: Rand = Math.random) => between(BETWEEN_BUBBLES_MIN_MS, BETWEEN_BUBBLES_MAX_MS, rand);
export const betweenImagesMs = (rand: Rand = Math.random) => between(BETWEEN_IMAGES_MIN_MS, BETWEEN_IMAGES_MAX_MS, rand);

/** How long a person would take to type `text`, clamped to [TYPING_MIN_MS, TYPING_MAX_MS]. */
export function typingDurationMs(text: string, rand: Rand = Math.random): number {
  const perChar = between(TYPING_MS_PER_CHAR_MIN, TYPING_MS_PER_CHAR_MAX, rand);
  const raw = [...text].length * perChar;
  return Math.min(TYPING_MAX_MS, Math.max(TYPING_MIN_MS, raw));
}

export type TimedBubble = { text: string; typingMs: number; pauseBeforeMs: number };

/**
 * Typing time per bubble plus the pause before each one (0 for the first). When the total exceeds
 * TYPING_TOTAL_BUDGET_MS, every typing time is scaled down (but not below 600 ms).
 */
export function planBubbles(bubbles: string[], rand: Rand = Math.random): TimedBubble[] {
  const planned = bubbles.map((text, i) => ({ text, typingMs: typingDurationMs(text, rand), pauseBeforeMs: i === 0 ? 0 : betweenBubblesMs(rand) }));
  const total = planned.reduce((s, b) => s + b.typingMs + b.pauseBeforeMs, 0);
  if (total <= TYPING_TOTAL_BUDGET_MS) return planned;
  const scale = TYPING_TOTAL_BUDGET_MS / total;
  return planned.map((b) => ({ ...b, typingMs: Math.max(600, Math.round(b.typingMs * scale)), pauseBeforeMs: Math.round(b.pauseBeforeMs * scale) }));
}

// ---- burst debounce ----

export type PendingMessage = { id: string; createdAtMs: number };

export type BurstDecision =
  /** The message was already answered (by the bot or a team member). */
  | { action: "answered" }
  /** A newer customer message exists; its job answers the whole burst. */
  | { action: "superseded" }
  /** This job owns the burst but the customer may still be typing: check again at `untilMs`. */
  | { action: "wait"; untilMs: number }
  /** Answer now. `batch` is the burst, oldest -> newest. */
  | { action: "reply"; batch: PendingMessage[] };

type StoredMessage = { id: string; direction: "IN" | "OUT"; sender: string; type: string; createdAt: Date };

/**
 * Customer messages after the last real reply, oldest -> newest. A reply is a bot TEXT message or
 * anything from a team member; product photos sent mid-turn don't count, so a turn that failed
 * after sending photos is still retried.
 */
export function unansweredInbound(messages: StoredMessage[]): PendingMessage[] {
  let start = 0;
  messages.forEach((m, i) => {
    if (m.direction === "OUT" && (m.sender !== "BOT" || m.type === "text")) start = i + 1;
  });
  return messages.slice(start).filter((m) => m.direction === "IN").map((m) => ({ id: m.id, createdAtMs: m.createdAt.getTime() }));
}

/**
 * Decides what the job for `ownId` should do. `unanswered` = customer messages after the last
 * bot/team text reply, oldest -> newest. Exactly one job (the newest message's) ever replies, so a
 * burst gets one answer; older jobs exit and nothing is lost because the reply covers them all.
 */
export function decideBurst(input: {
  ownId: string;
  unanswered: PendingMessage[];
  nowMs: number;
  /** When the webhook last accepted a message for this chat (may not be stored yet); extends the quiet window. */
  lastAcceptedMs?: number | null;
}): BurstDecision {
  const { ownId, unanswered, nowMs } = input;
  const idx = unanswered.findIndex((m) => m.id === ownId);
  if (idx === -1) return { action: "answered" };
  if (idx !== unanswered.length - 1) return { action: "superseded" };

  const newest = unanswered[idx];
  const batch = unanswered.filter((m) => newest.createdAtMs - m.createdAtMs <= BURST_LOOKBACK_MS).slice(-BURST_MAX_MESSAGES);
  const quietAt = Math.max(newest.createdAtMs, input.lastAcceptedMs ?? 0) + BURST_QUIET_MS;
  const capAt = batch[0].createdAtMs + BURST_MAX_WAIT_MS;
  const untilMs = Math.min(quietAt, capAt);
  return nowMs >= untilMs ? { action: "reply", batch } : { action: "wait", untilMs };
}

// ---- reply text: WhatsApp formatting + bubble splitting ----

/**
 * Cleans model output for WhatsApp: removes any leaked reasoning/control tokens, turns markdown
 * into WhatsApp formatting (*bold*, _italic_, "-" lists), and flattens headings and tables.
 */
export function toWhatsAppText(raw: string): string {
  let t = raw.replace(/\r\n?/g, "\n");
  t = t.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "");
  t = t.replace(/<think(?:ing)?>[\s\S]*$/i, ""); // unterminated reasoning block
  t = t.replace(/<\|[^|>]{1,40}\|>/g, ""); // chat-template control tokens (e.g. gpt-oss harmony)
  t = t.replace(/\*\*(.+?)\*\*/g, "*$1*").replace(/__(.+?)__/g, "_$1_");
  t = t.replace(/^#{1,6}\s+(.+?)\s*#*$/gm, "*$1*");
  t = t.replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*(\n|$)/gm, ""); // table separator rows
  t = t.replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_m, row: string) => row.split("|").map((c) => c.trim()).filter(Boolean).join(" — "));
  t = t.replace(/^(\s*)[*•]\s+/gm, "$1- ");
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)");
  t = t.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

const LIST_LINE = /^\s*(?:[-•]|\d+[.)]|\*\s)/;

function isStructured(paragraph: string): boolean {
  return paragraph.includes("\n") || LIST_LINE.test(paragraph);
}

/** Splits one long prose paragraph into two halves at the sentence boundary closest to the middle. */
function splitProse(p: string): string[] {
  if (p.length <= LONG_PARAGRAPH_CHARS || isStructured(p)) return [p];
  const cuts = [...p.matchAll(/[.!?](?=\s+[A-Z0-9*_"'(])/g)].map((m) => (m.index ?? 0) + 1);
  if (!cuts.length) return [p];
  const mid = p.length / 2;
  const cut = cuts.reduce((best, c) => (Math.abs(c - mid) < Math.abs(best - mid) ? c : best));
  const a = p.slice(0, cut).trim();
  const b = p.slice(cut).trim();
  return a && b ? [a, b] : [p];
}

function hardWrap(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const slice = rest.slice(0, max);
    const at = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
    const cut = at > max / 2 ? at : max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Splits a reply into at most `max` WhatsApp bubbles at paragraph boundaries. Lists and multi-line
 * blocks (menus, order summaries) are never cut, and a line ending in ":" stays with what follows.
 * When there are too many paragraphs, the shortest adjacent pair is merged first.
 */
export function splitIntoBubbles(text: string, max = MAX_BUBBLES): string[] {
  const clean = toWhatsAppText(text);
  if (!clean) return [];

  const paragraphs = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  // Keep an intro ("Here's what we have:") with the block it introduces.
  const joined: string[] = [];
  for (const p of paragraphs) {
    const prev = joined.at(-1);
    if (prev !== undefined && /:\s*$/.test(prev)) joined[joined.length - 1] = `${prev}\n${p}`;
    else joined.push(p);
  }

  let parts = joined.length === 1 ? splitProse(joined[0]) : joined;
  while (parts.length > max) {
    let best = 0;
    for (let i = 1; i < parts.length - 1; i++) {
      if (parts[i].length + parts[i + 1].length < parts[best].length + parts[best + 1].length) best = i;
    }
    parts = [...parts.slice(0, best), `${parts[best]}\n\n${parts[best + 1]}`, ...parts.slice(best + 2)];
  }
  return parts.flatMap((p) => (p.length > MAX_BUBBLE_CHARS ? hardWrap(p, MAX_BUBBLE_CHARS) : [p]));
}

// ---- inbound media ----

/** Inbound message types we accept from OpenWA (`message.received` `type`). */
export const INBOUND_TYPES = ["text", "image", "video", "voice", "audio", "sticker", "location", "document"] as const;
export type InboundType = (typeof INBOUND_TYPES)[number];

export function isInboundType(t: string): t is InboundType {
  return (INBOUND_TYPES as readonly string[]).includes(t);
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Emoji_Component}|‍|️|\s)+$/u;

/** True for messages made only of emoji (e.g. "👍", "😂😂"). Digits alone are not emoji-only. */
export function isEmojiOnly(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && EMOJI_ONLY.test(t) && /\p{Extended_Pictographic}/u.test(t);
}

export type LocationInfo = { latitude: number; longitude: number; description?: string; address?: string };

/** Message body we store for a shared location: readable text the team and the model can both use. */
export function formatLocation(loc: LocationInfo): string {
  const label = [loc.description, loc.address].map((s) => s?.trim()).filter(Boolean).join(", ");
  const coords = `${loc.latitude.toFixed(6)},${loc.longitude.toFixed(6)}`;
  return `${label ? `${label} ` : ""}(pin: https://maps.google.com/?q=${coords})`;
}

/**
 * What the model sees for one customer message. Non-text messages become a bracketed note that
 * tells the model what happened and what it can't do, so it answers naturally instead of guessing.
 */
export function describeInbound(type: string, body: string): string {
  const text = body.trim();
  switch (type) {
    case "text":
      if (!text) return "(empty message)";
      return isEmojiOnly(text) ? `${text} [emoji only: reply briefly in kind]` : text;
    case "image":
    case "video":
      return `[Customer sent a ${type === "image" ? "photo" : "video"}. You can't see it.${text ? ` Caption: "${text}"` : " No caption."} Acknowledge it and ask what they'd like.]`;
    case "voice":
    case "audio":
      return "[Customer sent a voice note. You can't listen to voice notes. Kindly ask them to type their message.]";
    case "sticker":
      return "[Customer sent a sticker. Reply briefly and warmly in kind.]";
    case "location":
      return `[Customer shared a location: ${text || "no details"}. Treat it as their delivery location; confirm it with them (ask for a landmark or house number if missing).]`;
    case "document":
      return `[Customer sent a document. You can't open it.${text ? ` Caption: "${text}"` : ""} Ask what they need.]`;
    default:
      return `[Customer sent a ${type} message.${text ? ` Text: "${text}"` : ""}]`;
  }
}

// ---- customer + time-of-day context for the prompt ----

/** WhatsApp display names are user-controlled: keep letters/spaces only, short. Returns the first name or null. */
export function firstNameFrom(displayName: string | null | undefined): string | null {
  const cleaned = (displayName ?? "").normalize("NFKC").replace(/[^\p{L}\p{M}' -]/gu, " ").replace(/\s+/g, " ").trim();
  const first = cleaned.split(" ")[0] ?? "";
  if (first.length < 2 || first.length > 20) return null;
  return first;
}

export type DayPart = "early morning" | "morning" | "afternoon" | "evening" | "late night";

export function dayPart(timezone: string, now: Date): DayPart {
  const { minutes } = localDayAndMinutes(timezone, now);
  const h = minutes / 60;
  if (h < 5) return "late night";
  if (h < 8) return "early morning";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 22) return "evening";
  return "late night";
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** When the business next opens, e.g. "today at 08:00", "tomorrow at 09:00", "Monday at 10:00"; null if no hours set. */
export function nextOpening(businessHours: unknown, timezone: string, now: Date): string | null {
  const hours = parseBusinessHours(businessHours);
  if (!hours || Object.keys(hours).length === 0) return null;
  const { day, minutes } = localDayAndMinutes(timezone, now);
  const start = DAYS.indexOf(day);
  for (let offset = 0; offset < 8; offset++) {
    const d = DAYS[(start + offset) % 7];
    const opens = (hours[d] ?? []).map((r) => r.open).filter((o) => offset > 0 || toMin(o) > minutes).sort();
    if (opens.length) {
      const when = offset === 0 ? "today" : offset === 1 ? "tomorrow" : DAY_LABELS[d];
      return `${when} at ${opens[0]}`;
    }
  }
  return null;
}

// ---- the "person at the shop" send sequence (I/O injected) ----

export type ChatIo = {
  /** Sends one bubble; returns nothing, the caller's implementation stores it. Errors propagate. */
  sendText(text: string, quotedMessageId?: string): Promise<void>;
  setTyping(state: "typing" | "paused"): Promise<void>;
  markRead(messageIds: string[]): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** Cosmetic calls (typing, read receipts) never fail a reply; their errors are reported here. */
  warn(err: unknown, what: string): void;
};

export type Replier = {
  /** Blue ticks ~1-3 s after the newest message (minus time already passed), then a short pause. */
  seen(messageIds: string[], newestAtMs: number): Promise<void>;
  /** Shows "typing…" (e.g. while the model thinks). Counts toward the first bubble's typing time. */
  startTyping(): Promise<void>;
  /** Splits `text` into bubbles and sends each after a typing pause. Returns the bubbles sent. */
  say(text: string, opts?: { quotedMessageId?: string }): Promise<string[]>;
  /** Clears a typing indicator left on (e.g. when nothing will be sent). */
  stopTyping(): Promise<void>;
  /** Bubbles sent so far. */
  readonly sent: number;
};

export function createReplier(io: ChatIo, rand: Rand = Math.random): Replier {
  let typingSince: number | null = null;
  let sent = 0;

  const bestEffort = async (fn: () => Promise<unknown>, what: string) => {
    try {
      await fn();
    } catch (err) {
      io.warn(err, what);
    }
  };

  const replier: Replier = {
    get sent() {
      return sent;
    },
    async seen(messageIds, newestAtMs) {
      const wait = readDelayMs(rand) - (io.now() - newestAtMs);
      if (wait > 0) await io.sleep(wait);
      await bestEffort(() => io.markRead(messageIds), "mark chat read");
      await io.sleep(readToTypingMs(rand));
    },
    async startTyping() {
      await bestEffort(() => io.setTyping("typing"), "typing indicator");
      typingSince = io.now();
    },
    async say(text, opts = {}) {
      const bubbles = planBubbles(splitIntoBubbles(text), rand);
      const out: string[] = [];
      for (const [i, b] of bubbles.entries()) {
        if (i > 0 && b.pauseBeforeMs > 0) await io.sleep(b.pauseBeforeMs);
        if (typingSince === null) await replier.startTyping();
        const remaining = b.typingMs - (io.now() - (typingSince ?? io.now()));
        if (remaining > 0) await io.sleep(remaining);
        await io.sendText(b.text, i === 0 ? opts.quotedMessageId : undefined);
        typingSince = null; // WhatsApp clears the indicator when a message arrives
        sent++;
        out.push(b.text);
      }
      return out;
    },
    async stopTyping() {
      if (typingSince === null) return;
      typingSince = null;
      await bestEffort(() => io.setTyping("paused"), "clear typing indicator");
    },
  };
  return replier;
}
