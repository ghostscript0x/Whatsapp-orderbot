import { describe, expect, it, vi } from "vitest";
import { RateLimitError } from "groq-sdk";
import { createGroqProvider, mapGroqError, type GroqLike } from "@/lib/llm/groq";
import { LlmError, type LlmMessage, type ToolDef } from "@/lib/llm/types";

const TOOLS: ToolDef[] = [
  { name: "list_products", description: "List products", parameters: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false } },
];

function fakeClient(response: unknown) {
  const create = vi.fn().mockResolvedValue(response);
  const client: GroqLike = { chat: { completions: { create } } };
  return { client, create };
}

describe("groq provider", () => {
  it("maps system, history, tool calls and tool results to OpenAI-style messages", async () => {
    const { client, create } = fakeClient({ choices: [{ finish_reason: "stop", message: { content: "Hi!" } }] });
    const provider = createGroqProvider({ model: "llama-test", client });
    const messages: LlmMessage[] = [
      { role: "user", content: "menu?" },
      { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "list_products", arguments: '{"query":"rice"}' }] },
      { role: "tool", toolCallId: "call_1", name: "list_products", content: '{"products":[]}' },
    ];

    await provider.generate({ system: "SYS", messages, tools: TOOLS, maxTokens: 300 });

    const body = create.mock.calls[0][0];
    expect(body.model).toBe("llama-test");
    expect(body.max_completion_tokens).toBe(300);
    expect(body.tool_choice).toBe("auto");
    expect(body.messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "menu?" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "list_products", arguments: '{"query":"rice"}' } }] },
      { role: "tool", tool_call_id: "call_1", content: '{"products":[]}' },
    ]);
    expect(body.tools).toEqual([{ type: "function", function: { name: "list_products", description: "List products", parameters: TOOLS[0].parameters } }]);
  });

  it("omits tools when none are given and passes toolChoice none through", async () => {
    const { client, create } = fakeClient({ choices: [{ finish_reason: "stop", message: { content: "x" } }] });
    const provider = createGroqProvider({ model: "m", client });
    await provider.generate({ system: "S", messages: [{ role: "user", content: "hi" }] });
    expect(create.mock.calls[0][0]).not.toHaveProperty("tools");
    await provider.generate({ system: "S", messages: [{ role: "user", content: "hi" }], tools: TOOLS, toolChoice: "none" });
    expect(create.mock.calls[1][0].tool_choice).toBe("none");
  });

  it("maps tool calls and usage from the response", async () => {
    const { client } = fakeClient({
      choices: [
        {
          finish_reason: "tool_calls",
          message: { content: null, tool_calls: [{ id: "c9", type: "function", function: { name: "list_products", arguments: "" } }] },
        },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 15 },
    });
    const res = await createGroqProvider({ model: "m", client }).generate({ system: "S", messages: [{ role: "user", content: "hi" }], tools: TOOLS });
    expect(res).toEqual({
      text: "",
      toolCalls: [{ id: "c9", name: "list_products", arguments: "{}" }],
      finishReason: "tool_calls",
      usage: { inputTokens: 120, outputTokens: 15 },
    });
  });

  it("returns trimmed text with stop finish reason", async () => {
    const { client } = fakeClient({ choices: [{ finish_reason: "stop", message: { content: "  Hello  " } }] });
    const res = await createGroqProvider({ model: "m", client }).generate({ system: "S", messages: [] });
    expect(res).toMatchObject({ text: "Hello", toolCalls: [], finishReason: "stop" });
  });

  it("wraps SDK errors in typed LlmErrors", async () => {
    const client: GroqLike = { chat: { completions: { create: vi.fn().mockRejectedValue(new RateLimitError(429, { message: "slow down" }, "slow down", new Headers())) } } };
    const err = await createGroqProvider({ model: "m", client })
      .generate({ system: "S", messages: [] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ kind: "rate_limit", provider: "groq", status: 429, retryable: true });
  });

  it("classifies unknown errors as invalid_response and requires an API key without a client", () => {
    expect(mapGroqError(new Error("boom"))).toMatchObject({ kind: "invalid_response", retryable: false });
    expect(() => createGroqProvider({ model: "m" })).toThrow(LlmError);
  });
});
