import Groq, { APIConnectionTimeoutError, APIConnectionError, APIError } from "groq-sdk";
import type { ChatCompletionCreateParamsNonStreaming } from "groq-sdk/resources/chat/completions";
import { fromOaiChoice, toOaiMessages, toOaiTools, type OaiChoice } from "./openai-format";
import { DEFAULT_MAX_TOKENS, DEFAULT_TIMEOUT_MS, LlmError, type GenerateInput, type GenerateResult, type LlmProvider } from "./types";

/** The subset of the Groq client we use; lets tests inject a fake. */
export type GroqLike = {
  chat: { completions: { create(body: ChatCompletionCreateParamsNonStreaming): Promise<{ choices: unknown[]; usage?: { prompt_tokens?: number; completion_tokens?: number } | null }> } };
};

export function mapGroqError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof APIConnectionTimeoutError) return new LlmError("timeout", err.message, "groq");
  if (err instanceof APIConnectionError) return new LlmError("network", err.message, "groq");
  if (err instanceof APIError) {
    const status = typeof err.status === "number" ? err.status : undefined;
    const kind =
      status === 401 || status === 403 ? "auth" : status === 429 ? "rate_limit" : status !== undefined && status >= 500 ? "server" : "bad_request";
    return new LlmError(kind, err.message, "groq", status);
  }
  return new LlmError("invalid_response", err instanceof Error ? err.message : String(err), "groq");
}

export type GroqReasoningEffort = "low" | "medium" | "high";

/**
 * Reasoning controls per model family (https://console.groq.com/docs/reasoning):
 * - GPT-OSS: `reasoning_format` is not supported; `include_reasoning: false` keeps the reasoning out
 *   of the response entirely, `reasoning_effort` low|medium|high.
 * - Qwen3 / DeepSeek-R1 style models: `reasoning_format: "hidden"` (otherwise reasoning can arrive
 *   inside `content` as <think> tags).
 * - Other models: no reasoning parameters (they are not documented for non-reasoning models).
 * We never read `message.reasoning`, so model reasoning can't reach customers either way.
 */
export function groqReasoningParams(model: string, effort: GroqReasoningEffort = "medium"): Record<string, unknown> {
  if (/^openai\/gpt-oss/i.test(model)) return { include_reasoning: false, reasoning_effort: effort };
  if (/qwen3|qwq|deepseek-r1/i.test(model)) return { reasoning_format: "hidden" };
  return {};
}

export function createGroqProvider(opts: { apiKey?: string; model: string; client?: GroqLike; timeoutMs?: number; reasoningEffort?: GroqReasoningEffort }): LlmProvider {
  if (!opts.client && !opts.apiKey) throw new LlmError("config", "GROQ_API_KEY is not set", "groq");
  // The SDK already retries 429/5xx/timeouts; maxRetries: 1 gives exactly one retry.
  const client: GroqLike = opts.client ?? new Groq({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxRetries: 1 });

  return {
    name: "groq",
    async generate(input: GenerateInput): Promise<GenerateResult> {
      const tools = toOaiTools(input.tools);
      const body = {
        model: opts.model,
        messages: toOaiMessages(input.system, input.messages),
        ...(tools ? { tools, tool_choice: input.toolChoice ?? "auto" } : {}),
        max_completion_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: 0.5,
        ...groqReasoningParams(opts.model, opts.reasoningEffort),
      } as ChatCompletionCreateParamsNonStreaming;

      let res: Awaited<ReturnType<GroqLike["chat"]["completions"]["create"]>>;
      try {
        res = await client.chat.completions.create(body);
      } catch (err) {
        throw mapGroqError(err);
      }
      const result = fromOaiChoice(res.choices[0] as OaiChoice | undefined);
      if (res.usage) result.usage = { inputTokens: res.usage.prompt_tokens ?? 0, outputTokens: res.usage.completion_tokens ?? 0 };
      return result;
    },
  };
}
