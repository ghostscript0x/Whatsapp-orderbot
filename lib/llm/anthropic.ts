import { postJson, type FetchLike } from "./http";
import { DEFAULT_MAX_TOKENS, DEFAULT_TIMEOUT_MS, LlmError, type GenerateInput, type GenerateResult, type LlmMessage, type LlmProvider } from "./types";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
/** Thinking counts toward max_tokens on current models; leave headroom so replies are not cut off. */
const MIN_MAX_TOKENS = 4096;

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string }
  | { type: string; [k: string]: unknown };

type AMessage = { role: "user" | "assistant"; content: string | Block[] };

type AnthropicResponse = {
  content?: Block[];
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
};

function parseArgs(json: string): unknown {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function toAnthropicMessages(messages: LlmMessage[]): AMessage[] {
  const out: AMessage[] = [];
  const pushUserBlocks = (blocks: Block[]) => {
    const last = out[out.length - 1];
    if (last?.role === "user" && Array.isArray(last.content)) last.content.push(...blocks);
    else out.push({ role: "user", content: blocks });
  };

  for (const m of messages) {
    switch (m.role) {
      case "system":
        pushUserBlocks([{ type: "text", text: `[System note] ${m.content}` }]);
        break;
      case "user":
        pushUserBlocks([{ type: "text", text: m.content }]);
        break;
      case "assistant": {
        if (m.providerData?.provider === "anthropic" && Array.isArray(m.providerData.content)) {
          out.push({ role: "assistant", content: m.providerData.content as Block[] });
          break;
        }
        const blocks: Block[] = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const tc of m.toolCalls ?? []) blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: parseArgs(tc.arguments) });
        if (blocks.length) out.push({ role: "assistant", content: blocks });
        break;
      }
      case "tool":
        // All results for one assistant turn must share a single user message.
        pushUserBlocks([{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }]);
        break;
    }
  }
  // The Messages API requires the first turn to be from the user.
  if (out[0]?.role === "assistant") out.unshift({ role: "user", content: "(earlier conversation)" });
  return out;
}

export function fromAnthropicResponse(data: AnthropicResponse): GenerateResult {
  if (!Array.isArray(data.content)) throw new LlmError("invalid_response", "Response has no content", "anthropic");
  let text = "";
  const toolCalls: GenerateResult["toolCalls"] = [];
  for (const b of data.content) {
    if (b.type === "text" && typeof b.text === "string") text += b.text;
    else if (b.type === "tool_use") {
      const tu = b as { id: string; name: string; input: unknown };
      toolCalls.push({ id: tu.id, name: tu.name, arguments: JSON.stringify(tu.input ?? {}) });
    }
  }
  const sr = data.stop_reason;
  const finishReason: GenerateResult["finishReason"] =
    sr === "refusal" ? "refusal" : toolCalls.length || sr === "tool_use" ? "tool_calls" : sr === "end_turn" ? "stop" : sr === "max_tokens" ? "length" : "other";
  return {
    text: finishReason === "refusal" ? "" : text.trim(),
    toolCalls: finishReason === "refusal" ? [] : toolCalls,
    finishReason,
    providerData: { provider: "anthropic", content: data.content },
    usage: data.usage ? { inputTokens: data.usage.input_tokens ?? 0, outputTokens: data.usage.output_tokens ?? 0 } : undefined,
  };
}

export function createAnthropicProvider(opts: {
  apiKey?: string;
  model: string;
  effort?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): LlmProvider {
  if (!opts.apiKey) throw new LlmError("config", "ANTHROPIC_API_KEY is not set", "anthropic");
  const apiKey = opts.apiKey;
  const useFallbacks = FALLBACK_MODELS.has(opts.model);

  return {
    name: "anthropic",
    async generate(input: GenerateInput): Promise<GenerateResult> {
      const headers: Record<string, string> = { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION };
      if (useFallbacks) headers["anthropic-beta"] = FALLBACK_BETA;
      const data = await postJson<AnthropicResponse>({
        provider: "anthropic",
        url: ANTHROPIC_URL,
        headers,
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        fetchImpl: opts.fetchImpl,
        body: {
          model: opts.model,
          max_tokens: Math.max(input.maxTokens ?? DEFAULT_MAX_TOKENS, MIN_MAX_TOKENS),
          system: input.system,
          messages: toAnthropicMessages(input.messages),
          ...(input.tools?.length
            ? {
                tools: input.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
                tool_choice: { type: input.toolChoice ?? "auto" },
              }
            : {}),
          ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
          ...(useFallbacks ? { fallbacks: "default" } : {}),
        },
      });
      return fromAnthropicResponse(data);
    },
  };
}
