import { postJson, type FetchLike } from "./http";
import { fromOaiChoice, toOaiMessages, toOaiTools, type OaiChoice } from "./openai-format";
import { DEFAULT_MAX_TOKENS, DEFAULT_TIMEOUT_MS, LlmError, type GenerateInput, type GenerateResult, type LlmProvider } from "./types";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

type OpenAiResponse = { choices?: OaiChoice[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };

export function createOpenAiProvider(opts: { apiKey?: string; model: string; fetchImpl?: FetchLike; timeoutMs?: number }): LlmProvider {
  if (!opts.apiKey) throw new LlmError("config", "OPENAI_API_KEY is not set", "openai");
  const apiKey = opts.apiKey;

  return {
    name: "openai",
    async generate(input: GenerateInput): Promise<GenerateResult> {
      const tools = toOaiTools(input.tools);
      const data = await postJson<OpenAiResponse>({
        provider: "openai",
        url: OPENAI_URL,
        headers: { authorization: `Bearer ${apiKey}` },
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        fetchImpl: opts.fetchImpl,
        body: {
          model: opts.model,
          messages: toOaiMessages(input.system, input.messages),
          ...(tools ? { tools, tool_choice: input.toolChoice ?? "auto" } : {}),
          max_completion_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        },
      });
      if (!Array.isArray(data.choices)) throw new LlmError("invalid_response", "Response has no choices", "openai");
      const result = fromOaiChoice(data.choices[0]);
      if (data.usage) result.usage = { inputTokens: data.usage.prompt_tokens ?? 0, outputTokens: data.usage.completion_tokens ?? 0 };
      return result;
    },
  };
}
