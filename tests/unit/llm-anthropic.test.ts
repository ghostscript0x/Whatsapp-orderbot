import { describe, expect, it, vi } from "vitest";
import { createAnthropicProvider, fromAnthropicResponse, toAnthropicMessages } from "@/lib/llm/anthropic";
import { createOpenAiProvider } from "@/lib/llm/openai";
import { LlmError } from "@/lib/llm/types";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("anthropic mapping", () => {
  it("groups parallel tool results into one user turn and replays provider content verbatim", () => {
    const raw = [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "tu_1", name: "a", input: {} }];
    const out = toAnthropicMessages([
      { role: "assistant", content: "earlier bot text" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "", toolCalls: [{ id: "tu_1", name: "a", arguments: "{}" }], providerData: { provider: "anthropic", content: raw } },
      { role: "tool", toolCallId: "tu_1", name: "a", content: "r1" },
      { role: "tool", toolCallId: "tu_2", name: "b", content: "r2" },
    ]);
    expect(out[0]).toEqual({ role: "user", content: "(earlier conversation)" });
    expect(out[3]).toEqual({ role: "assistant", content: raw });
    expect(out[4]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tu_1", content: "r1" },
        { type: "tool_result", tool_use_id: "tu_2", content: "r2" },
      ],
    });
  });

  it("parses text and tool_use blocks and treats refusals as empty", () => {
    const res = fromAnthropicResponse({
      content: [
        { type: "text", text: "Checking " },
        { type: "tool_use", id: "tu_1", name: "list_products", input: { query: "rice" } },
      ],
      stop_reason: "tool_use",
    });
    expect(res).toMatchObject({ text: "Checking", finishReason: "tool_calls", toolCalls: [{ id: "tu_1", name: "list_products", arguments: '{"query":"rice"}' }] });
    expect(fromAnthropicResponse({ content: [{ type: "text", text: "no" }], stop_reason: "refusal" })).toMatchObject({ text: "", toolCalls: [], finishReason: "refusal" });
  });
});

describe("http providers", () => {
  it("retries once on 429 and then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(429, { error: { message: "rate limited" } }, { "retry-after": "0" }))
      .mockResolvedValueOnce(json(200, { content: [{ type: "text", text: "Hello" }], stop_reason: "end_turn" }));
    const provider = createAnthropicProvider({ apiKey: "test-key", model: "claude-sonnet-5-5", fetchImpl });
    const res = await provider.generate({ system: "S", messages: [{ role: "user", content: "hi" }] });
    expect(res.text).toBe("Hello");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: "claude-sonnet-5-5", system: "S", fallbacks: "default" });
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({ "x-api-key": "test-key", "anthropic-version": "2023-06-01" });
  });

  it("does not retry 400s and throws a typed error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(400, { error: { message: "bad tool schema" } }));
    const provider = createOpenAiProvider({ apiKey: "test-key", model: "gpt-test", fetchImpl });
    const err = await provider.generate({ system: "S", messages: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ kind: "bad_request", status: 400 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up after one retry on repeated 5xx", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => json(503, { error: "overloaded" }, { "retry-after": "0" }));
    const provider = createOpenAiProvider({ apiKey: "test-key", model: "gpt-test", fetchImpl });
    await expect(provider.generate({ system: "S", messages: [] })).rejects.toMatchObject({ kind: "server", status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
