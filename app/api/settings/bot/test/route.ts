import { NextResponse } from "next/server";
import type { MessageDirection, MessageSender } from "@prisma/client";
import { ApiError, errors, parseJson, requireTenant, route } from "@/lib/api";
import { rateLimit } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { runAgent, type HistoryMessage } from "@/lib/agent";
import { botTestInputSchema } from "@/lib/agent/settings-schema";
import { LlmError } from "@/lib/llm/types";
import { planBubbles, splitIntoBubbles } from "@/lib/humanize";

const TEST_RATE_LIMIT = 20;
const TEST_RATE_WINDOW_S = 60;

/**
 * POST /api/settings/bot/test — try the bot from the dashboard (OWNER and STAFF).
 * Runs the real agent with dryRun: product/order lookups are real, but nothing is sent to
 * WhatsApp, no order is saved and no conversation is flagged. Nothing is stored.
 * Response: `{ replies: string[], bubbles: { text, typingMs, delayBeforeMs }[], actions, handedOff }`;
 * `replies` are the WhatsApp bubbles (same split as the worker), `bubbles` adds suggested timing.
 */
export const POST = route(async (req: Request) => {
  const ctx = await requireTenant();
  if (!(await rateLimit(`bottest:${ctx.tenantId}`, TEST_RATE_LIMIT, TEST_RATE_WINDOW_S))) throw errors.tooMany();
  const input = await parseJson(req, botTestInputSchema);

  const history: HistoryMessage[] = input.history.map((m) => ({
    direction: (m.from === "customer" ? "IN" : "OUT") as MessageDirection,
    sender: (m.from === "customer" ? "CUSTOMER" : "BOT") as MessageSender,
    type: "text",
    body: m.text,
  }));

  try {
    const result = await runAgent({
      tenantId: ctx.tenantId,
      db: ctx.db,
      // Synthetic test customer: never persisted; order lookups for it return nothing.
      customer: { id: `dry-run-${ctx.userId}`, name: "Test customer", phone: "0000000000" },
      conversation: { id: "dry-run" },
      recentMessages: history,
      inbound: { type: "text", body: input.message },
      dryRun: true,
      log: logger.child({ userId: ctx.userId }),
    });
    // Same splitting and timing the worker uses on WhatsApp, so the panel can replay it realistically.
    const bubbles = planBubbles(result.replies.flatMap((r) => splitIntoBubbles(r)));
    return NextResponse.json({
      replies: bubbles.map((b) => b.text),
      bubbles: bubbles.map((b) => ({ text: b.text, typingMs: b.typingMs, delayBeforeMs: b.pauseBeforeMs })),
      actions: result.actions,
      handedOff: result.handedOff,
    });
  } catch (err) {
    if (err instanceof LlmError) {
      logger.warn({ tenantId: ctx.tenantId, kind: err.kind, provider: err.provider, status: err.status }, "bot test: llm error");
      const message =
        err.kind === "config" || err.kind === "auth"
          ? "The AI provider is not configured correctly. Check the server's LLM settings."
          : "The AI provider is busy or unreachable. Please try again in a moment.";
      throw new ApiError(502, "llm_error", message);
    }
    throw err;
  }
});
