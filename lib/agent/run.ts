import type { Logger } from "pino";
import type { TenantDb } from "@/lib/tenant";
import { logger as rootLogger } from "@/lib/logger";
import { flagNeedsHuman } from "@/lib/conversations";
import { getLlmProvider } from "@/lib/llm";
import type { LlmMessage, LlmProvider } from "@/lib/llm/types";
import { toBotConfig, type BotConfig, type TenantInfo } from "./config";
import { PROMPT_VERSION, buildSystemPrompt, type CustomerProfile } from "./prompt";
import { describeInbound } from "@/lib/humanize";
import { TOOL_DEFS, executeToolCall, type AgentAction, type AgentCustomer, type HistoryMessage, type ToolContext } from "./tools";

export const MAX_TOOL_ITERATIONS = 5;
export const MAX_INBOUND_CHARS = 2000;
const MAX_HISTORY = 20;
const MAX_REPLY_TOKENS = 800;
const MAX_BURST_ITEMS = 10;

export const HANDOFF_REPLY = "Sure! Let me get someone from the team to help you with that 🙏 They'll reply here shortly.";
export const FALLBACK_REPLY = "Sorry, I'm having a little trouble with that one. Let me get someone from the team to help you 🙏 They'll reply here shortly.";

const HANDOFF_KEYWORDS = new Set(["agent", "human"]);

export function isHandoffKeyword(text: string): boolean {
  return HANDOFF_KEYWORDS.has(text.trim().toLowerCase());
}

export type RunAgentInput = {
  tenantId: string;
  db: TenantDb;
  customer: AgentCustomer;
  conversation: { id: string };
  /** Messages BEFORE the inbound one, oldest -> newest. Extra entries are trimmed to the last 20. */
  recentMessages: HistoryMessage[];
  /** The customer's new message, or a burst of messages sent in quick succession (oldest -> newest). */
  inbound: InboundItem | InboundItem[];
  /** Returning-customer context for the prompt (order history, last chat). */
  customerProfile?: CustomerProfile;
  /**
   * Called with text the model writes alongside tool calls ("One sec, let me check 👀"), before the
   * tools run, so it reaches the customer before e.g. product photos. When omitted, that text is
   * returned in `replies` instead.
   */
  onInterimText?: (text: string) => Promise<void>;
  /** Used between product photos (see ToolContext.pause). Omitted = no waiting (tests, dry runs). */
  pause?: (ms: number) => Promise<void>;
  /** WhatsApp chat id for image sends. Defaults to the customer's phone chat id. */
  chatId?: string;
  /** Loaded from the DB when omitted. */
  tenant?: TenantInfo;
  settings?: BotConfig;
  /** No WhatsApp sends, no orders, no flags: send/create tools return clearly labelled simulated results. */
  dryRun?: boolean;
  provider?: LlmProvider;
  now?: Date;
  log?: Logger;
};

export type InboundItem = { type: string; body: string };

export type RunAgentResult = {
  /** Text replies to send, in order (raw model text; split into bubbles with splitIntoBubbles). */
  replies: string[];
  actions: AgentAction[];
  handedOff: boolean;
  iterations: number;
};

function historyToMessages(history: HistoryMessage[]): LlmMessage[] {
  return history.map((m): LlmMessage => {
    if (m.direction === "IN") return { role: "user", content: describeInbound(m.type, m.body.slice(0, MAX_INBOUND_CHARS)) };
    const prefix = m.sender === "STAFF" ? "[Team member] " : "";
    return { role: "assistant", content: m.type === "text" ? `${prefix}${m.body}` : `${prefix}[Sent a ${m.type}: ${m.body}]` };
  });
}

/** A burst becomes one user turn (one line per message) so every provider sees strict alternation. */
function inboundToMessage(items: InboundItem[]): LlmMessage {
  const lines = items.map((i) => describeInbound(i.type, i.body.slice(0, MAX_INBOUND_CHARS)));
  return { role: "user", content: lines.join("\n") };
}

async function loadContext(input: RunAgentInput): Promise<{ tenant: TenantInfo; settings: BotConfig }> {
  const [tenant, settings] = await Promise.all([
    input.tenant ??
      input.db.tenant.findUniqueOrThrow({ where: { id: input.tenantId }, select: { name: true, currency: true, timezone: true } }),
    input.settings ?? input.db.botSettings.findFirst().then(toBotConfig),
  ]);
  return { tenant, settings };
}

/**
 * Runs the ordering agent for one inbound customer message.
 * Tool failures go back to the model as tool results; unexpected errors (DB, WhatsApp, LLM) throw
 * so the caller (the queue worker) can retry.
 */
export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const dryRun = input.dryRun ?? false;
  const log = (input.log ?? rootLogger).child({ tenantId: input.tenantId, conversationId: input.conversation.id, dryRun });
  const actions: AgentAction[] = [];

  const inbound = (Array.isArray(input.inbound) ? input.inbound : [input.inbound]).slice(-MAX_BURST_ITEMS);
  if (inbound.length === 0) throw new Error("runAgent needs at least one inbound message");

  // Keyword shortcut: no LLM call.
  if (inbound.some((i) => i.type === "text" && isHandoffKeyword(i.body))) {
    if (!dryRun) await flagNeedsHuman(input.db, input.tenantId, input.conversation.id, "Customer asked for a human");
    actions.push({
      tool: "request_human",
      ok: true,
      simulated: dryRun,
      summary: dryRun ? "DRY RUN: would alert the team (keyword)" : "Team alerted (keyword)",
    });
    return { replies: [HANDOFF_REPLY], actions, handedOff: true, iterations: 0 };
  }

  const { tenant, settings } = await loadContext(input);
  const provider = input.provider ?? getLlmProvider();
  const history = input.recentMessages.slice(-MAX_HISTORY);
  const system = buildSystemPrompt({ tenant, settings, now: input.now, customer: input.customerProfile ?? { displayName: input.customer.name } });

  const ctx: ToolContext = {
    tenantId: input.tenantId,
    db: input.db,
    tenant,
    settings,
    customer: input.customer,
    conversationId: input.conversation.id,
    chatId: input.chatId ?? `${input.customer.phone.replace(/\D/g, "")}@c.us`,
    history,
    dryRun,
    log,
    state: { quotedThisRun: false, handedOff: false, actions },
    pause: input.pause,
  };

  const messages: LlmMessage[] = [...historyToMessages(history), inboundToMessage(inbound)];
  const replies: string[] = [];
  let iterations = 0;

  for (;;) {
    const capReached = iterations >= MAX_TOOL_ITERATIONS;
    const started = Date.now();
    const res = await provider.generate({ system, messages, tools: TOOL_DEFS, toolChoice: capReached ? "none" : "auto", maxTokens: MAX_REPLY_TOKENS });
    log.info(
      { provider: provider.name, promptVersion: PROMPT_VERSION, iteration: iterations, ms: Date.now() - started, finishReason: res.finishReason, toolCalls: res.toolCalls.map((t) => t.name), usage: res.usage },
      "llm call",
    );

    const done = capReached || res.toolCalls.length === 0;
    if (res.text) {
      if (!done && input.onInterimText) await input.onInterimText(res.text);
      else replies.push(res.text);
    }
    if (done) break;

    iterations++;
    messages.push({ role: "assistant", content: res.text, toolCalls: res.toolCalls, providerData: res.providerData });
    for (const call of res.toolCalls) {
      const content = await executeToolCall(ctx, call);
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content });
    }
  }

  // Nothing useful came back (refusal, empty output): hand off rather than leave the customer hanging.
  if (replies.length === 0) {
    log.warn({ iterations }, "agent produced no reply; handing off");
    if (!ctx.state.handedOff) {
      ctx.state.handedOff = true;
      if (!dryRun) await flagNeedsHuman(input.db, input.tenantId, input.conversation.id, "The bot could not produce a reply");
      actions.push({ tool: "request_human", ok: true, simulated: dryRun, summary: dryRun ? "DRY RUN: would alert the team (no reply)" : "Team alerted (no reply)" });
    }
    replies.push(FALLBACK_REPLY);
  }

  return { replies, actions, handedOff: ctx.state.handedOff, iterations };
}
