import type { GenerateResult, LlmMessage, LlmToolCall, ToolDef } from "./types";

/** OpenAI-style chat message (also used by Groq, which is OpenAI-compatible). */
export type OaiMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OaiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type OaiToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type OaiTool = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

export type OaiChoice = {
  finish_reason: string | null;
  message: { content: string | null; tool_calls?: OaiToolCall[] | null };
};

export function toOaiMessages(system: string, messages: LlmMessage[]): OaiMessage[] {
  const out: OaiMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    switch (m.role) {
      case "system":
      case "user":
        out.push({ role: m.role, content: m.content });
        break;
      case "assistant":
        out.push({
          role: "assistant",
          content: m.content || null,
          ...(m.toolCalls?.length
            ? { tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: "function" as const, function: { name: tc.name, arguments: tc.arguments } })) }
            : {}),
        });
        break;
      case "tool":
        out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
        break;
    }
  }
  return out;
}

export function toOaiTools(tools: ToolDef[] | undefined): OaiTool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

export function fromOaiChoice(choice: OaiChoice | undefined): GenerateResult {
  if (!choice) return { text: "", toolCalls: [], finishReason: "other" };
  const toolCalls: LlmToolCall[] = (choice.message.tool_calls ?? [])
    .filter((tc) => tc.type === "function" || tc.type === undefined)
    .map((tc) => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments || "{}" }));
  const reason = choice.finish_reason;
  const finishReason: GenerateResult["finishReason"] =
    toolCalls.length > 0 || reason === "tool_calls"
      ? "tool_calls"
      : reason === "stop"
        ? "stop"
        : reason === "length"
          ? "length"
          : reason === "content_filter"
            ? "refusal"
            : "other";
  return { text: stripReasoning(choice.message.content ?? ""), toolCalls, finishReason };
}

/**
 * Removes reasoning that some models put inside `content` (<think>…</think>, or an unterminated
 * <think> block cut off by max tokens) so it can never be sent to a customer.
 */
export function stripReasoning(content: string): string {
  return content
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .replace(/<think(?:ing)?>[\s\S]*$/i, "")
    .trim();
}
