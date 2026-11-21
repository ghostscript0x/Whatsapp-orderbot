import { describe, expect, it, vi } from "vitest";
import { createGroqProvider, groqReasoningParams, type GroqLike } from "@/lib/llm/groq";
import { stripReasoning } from "@/lib/llm/openai-format";

function fakeClient(content: string, extra: Record<string, unknown> = {}) {
  const create = vi.fn().mockResolvedValue({ choices: [{ finish_reason: "stop", message: { content, ...extra } }] });
  const client: GroqLike = { chat: { completions: { create } } };
  return { client, create };
}

describe("groq reasoning handling", () => {
  it("hides GPT-OSS reasoning and sets the effort", async () => {
    const { client, create } = fakeClient("Hi Ada!", { reasoning: "The user greets; reply warmly." });
    const res = await createGroqProvider({ model: "openai/gpt-oss-20b", client }).generate({ system: "S", messages: [{ role: "user", content: "hi" }] });
    const body = create.mock.calls[0][0];
    expect(body).toMatchObject({ include_reasoning: false, reasoning_effort: "medium" });
    expect(body).not.toHaveProperty("reasoning_format"); // not supported on GPT-OSS
    expect(res.text).toBe("Hi Ada!"); // the reasoning field is never read
  });

  it("honours a configured effort", () => {
    expect(groqReasoningParams("openai/gpt-oss-120b", "low")).toEqual({ include_reasoning: false, reasoning_effort: "low" });
  });

  it("uses reasoning_format hidden for <think>-style models and nothing for plain models", () => {
    expect(groqReasoningParams("qwen/qwen3-32b")).toEqual({ reasoning_format: "hidden" });
    expect(groqReasoningParams("llama-3.3-70b-versatile")).toEqual({});
  });

  it("strips <think> blocks that leak into content", async () => {
    const { client } = fakeClient("<think>they want rice</think>\nSure, we have jollof!");
    const res = await createGroqProvider({ model: "llama-3.3-70b-versatile", client }).generate({ system: "S", messages: [] });
    expect(res.text).toBe("Sure, we have jollof!");
  });

  it("drops an unterminated reasoning block cut off by max tokens", () => {
    expect(stripReasoning("<think>long reasoning that never ends")).toBe("");
    expect(stripReasoning("Plain reply")).toBe("Plain reply");
  });
});
