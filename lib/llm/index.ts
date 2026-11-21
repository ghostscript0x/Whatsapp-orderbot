import { env } from "@/lib/env";
import { createAnthropicProvider } from "./anthropic";
import { createGroqProvider, type GroqReasoningEffort } from "./groq";
import { createOpenAiProvider } from "./openai";
import type { GenerateInput, GenerateResult, LlmProvider } from "./types";

export * from "./types";

const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
/** Chat replies are short and latency-sensitive; "low" effort keeps them fast. */
const DEFAULT_ANTHROPIC_EFFORT = "low";

let cached: LlmProvider | undefined;

/** Builds the provider selected by LLM_PROVIDER. Model overrides: GROQ_MODEL, OPENAI_MODEL, ANTHROPIC_MODEL. */
export function getLlmProvider(): LlmProvider {
  cached ??= buildProvider();
  return cached;
}

function buildProvider(): LlmProvider {
  const e = env();
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS) || undefined;
  switch (e.LLM_PROVIDER) {
    case "openai":
      return createOpenAiProvider({ apiKey: e.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL, timeoutMs });
    case "anthropic":
      return createAnthropicProvider({
        apiKey: e.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL,
        effort: process.env.ANTHROPIC_EFFORT || DEFAULT_ANTHROPIC_EFFORT,
        timeoutMs,
      });
    case "groq":
      return createGroqProvider({ apiKey: e.GROQ_API_KEY, model: e.GROQ_MODEL, timeoutMs, reasoningEffort: groqEffort(process.env.GROQ_REASONING_EFFORT) });
  }
}

/** GROQ_REASONING_EFFORT (GPT-OSS models only): low | medium | high; anything else means the default (medium). */
function groqEffort(value: string | undefined): GroqReasoningEffort | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

/** One model call with the configured provider. */
export function generate(input: GenerateInput): Promise<GenerateResult> {
  return getLlmProvider().generate(input);
}
