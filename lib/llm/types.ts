/** Provider-neutral LLM types. Every provider maps to and from these shapes. */

export type LlmToolCall = {
  id: string;
  name: string;
  /** Raw JSON string produced by the model. Always validate before use. */
  arguments: string;
};

export type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      toolCalls?: LlmToolCall[];
      /**
       * Opaque provider payload that must be replayed verbatim on the next request of the
       * same tool loop (e.g. Anthropic thinking blocks). Never persisted.
       */
      providerData?: { provider: string; content: unknown };
    }
  | { role: "tool"; toolCallId: string; name: string; content: string };

/** JSON Schema object describing a tool's arguments. */
export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolDef = {
  name: string;
  description: string;
  parameters: JsonSchema;
};

export type GenerateInput = {
  system: string;
  messages: LlmMessage[];
  tools?: ToolDef[];
  /** "none" forbids tool calls (tools must still be sent when history contains tool calls). */
  toolChoice?: "auto" | "none";
  maxTokens?: number;
};

export type GenerateResult = {
  text: string;
  toolCalls: LlmToolCall[];
  /** Normalised stop reason; "refusal" means the provider declined to answer. */
  finishReason: "stop" | "tool_calls" | "length" | "refusal" | "other";
  /** Assistant payload to replay (see LlmMessage.providerData). */
  providerData?: { provider: string; content: unknown };
  usage?: { inputTokens: number; outputTokens: number };
};

export interface LlmProvider {
  readonly name: string;
  generate(input: GenerateInput): Promise<GenerateResult>;
}

export type LlmErrorKind = "config" | "auth" | "rate_limit" | "timeout" | "server" | "bad_request" | "network" | "invalid_response";

export class LlmError extends Error {
  constructor(
    public readonly kind: LlmErrorKind,
    message: string,
    public readonly provider: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }

  get retryable(): boolean {
    return this.kind === "rate_limit" || this.kind === "server" || this.kind === "timeout" || this.kind === "network";
  }
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_TOKENS = 1024;
