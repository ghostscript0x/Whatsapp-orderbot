import { beforeEach, describe, expect, it, vi } from "vitest";
import pino from "pino";

vi.mock("@/lib/products", () => ({
  listAvailableProducts: vi.fn(),
  getAvailableProductsByIds: vi.fn(),
}));
vi.mock("@/lib/orders", () => {
  class OrderValidationError extends Error {}
  return { OrderValidationError, createOrder: vi.fn(), getCustomerOrders: vi.fn() };
});
vi.mock("@/lib/conversations", () => ({ flagNeedsHuman: vi.fn(), storeMessage: vi.fn() }));
vi.mock("@/lib/openwa", () => ({
  sendTenantImage: vi.fn(),
  OpenWaError: class OpenWaError extends Error {
    constructor(public status: number, public code: string | undefined, message: string) {
      super(message);
    }
  },
  WhatsAppNotConnectedError: class WhatsAppNotConnectedError extends Error {},
}));

import { listAvailableProducts, getAvailableProductsByIds } from "@/lib/products";
import { OrderValidationError, createOrder, getCustomerOrders } from "@/lib/orders";
import { flagNeedsHuman, storeMessage } from "@/lib/conversations";
import { sendTenantImage } from "@/lib/openwa";
import { FALLBACK_REPLY, HANDOFF_REPLY, MAX_TOOL_ITERATIONS, runAgent, type RunAgentInput } from "@/lib/agent/run";
import { DEFAULT_BOT_CONFIG } from "@/lib/agent/config";
import { mentionsAmount, type HistoryMessage } from "@/lib/agent/tools";
import type { GenerateInput, GenerateResult, LlmProvider, LlmToolCall } from "@/lib/llm/types";
import type { TenantDb } from "@/lib/tenant";

const JOLLOF = { id: "p_jollof", name: "Jollof Rice", priceKobo: 150_000, description: "Smoky party jollof", category: "Mains", coverImageUrl: "https://cdn.example/j.jpg" };
const CHIPS = { id: "p_chips", name: "Chips", priceKobo: 80_000, description: "", category: "Sides", coverImageUrl: null };
const PRODUCTS = [JOLLOF, CHIPS];

/** Scripted provider: returns the queued results in order, then a plain text reply. Records every input. */
function fakeProvider(script: Array<Partial<GenerateResult>>) {
  const calls: GenerateInput[] = [];
  const provider: LlmProvider = {
    name: "fake",
    generate: vi.fn(async (input: GenerateInput) => {
      calls.push(structuredClone(input));
      const next = script.shift() ?? { text: "Done." };
      return { text: "", toolCalls: [], finishReason: next.toolCalls?.length ? "tool_calls" : "stop", ...next } as GenerateResult;
    }),
  };
  return { provider, calls };
}

let callSeq = 0;
const call = (name: string, args: unknown): LlmToolCall => ({ id: `call_${++callSeq}`, name, arguments: typeof args === "string" ? args : JSON.stringify(args) });

/** The tool result the model received for the first tool message after `afterCall`. */
function toolResults(calls: GenerateInput[]): Array<{ name: string; content: Record<string, unknown> }> {
  const last = calls[calls.length - 1];
  return last.messages.filter((m) => m.role === "tool").map((m) => ({ name: (m as { name: string }).name, content: JSON.parse((m as { content: string }).content) }));
}

function input(provider: LlmProvider, overrides: Partial<RunAgentInput> = {}): RunAgentInput {
  return {
    tenantId: "t_1",
    db: {} as TenantDb,
    customer: { id: "c_1", name: "Ada", phone: "2348000000001" },
    conversation: { id: "conv_1" },
    recentMessages: [],
    inbound: { type: "text", body: "Hi" },
    chatId: "2348000000001@c.us",
    tenant: { name: "Mama Put", currency: "NGN", timezone: "Africa/Lagos" },
    settings: { ...DEFAULT_BOT_CONFIG, deliveryFeeKobo: 50_000 },
    provider,
    log: pino({ level: "silent" }),
    now: new Date("2026-11-23T12:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listAvailableProducts).mockResolvedValue(PRODUCTS);
  vi.mocked(getAvailableProductsByIds).mockImplementation(async (_db, ids) => PRODUCTS.filter((p) => ids.includes(p.id)));
  vi.mocked(getCustomerOrders).mockResolvedValue([]);
  vi.mocked(sendTenantImage).mockResolvedValue({ messageId: "wa_img_1" });
});

describe("keyword handoff", () => {
  it.each(["agent", "  HUMAN ", "Agent"])("hands off on %j without calling the LLM", async (body) => {
    const { provider } = fakeProvider([]);
    const res = await runAgent(input(provider, { inbound: { type: "text", body } }));
    expect(provider.generate).not.toHaveBeenCalled();
    expect(flagNeedsHuman).toHaveBeenCalledWith(expect.anything(), "t_1", "conv_1", expect.any(String));
    expect(res).toMatchObject({ replies: [HANDOFF_REPLY], handedOff: true, iterations: 0 });
  });

  it("does not trigger on sentences that merely contain the word", async () => {
    const { provider } = fakeProvider([{ text: "Sure!" }]);
    await runAgent(input(provider, { inbound: { type: "text", body: "is there an agent for delivery?" } }));
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(flagNeedsHuman).not.toHaveBeenCalled();
  });

  it("only simulates the handoff in dry-run mode", async () => {
    const { provider } = fakeProvider([]);
    const res = await runAgent(input(provider, { inbound: { type: "text", body: "agent" }, dryRun: true }));
    expect(flagNeedsHuman).not.toHaveBeenCalled();
    expect(res.actions[0]).toMatchObject({ tool: "request_human", simulated: true });
  });
});

describe("tool loop", () => {
  it(`caps tool iterations at ${MAX_TOOL_ITERATIONS} and forces a final text answer`, async () => {
    const looping = Array.from({ length: 10 }, () => ({ toolCalls: [call("list_products", {})] }));
    const { provider, calls } = fakeProvider([...looping]);
    // After the cap the provider is asked with toolChoice "none"; make that call answer with text.
    vi.mocked(provider.generate).mockImplementation(async (i: GenerateInput) => {
      calls.push(structuredClone(i));
      return i.toolChoice === "none"
        ? { text: "Here is our menu.", toolCalls: [], finishReason: "stop" }
        : { text: "", toolCalls: [call("list_products", {})], finishReason: "tool_calls" };
    });

    const res = await runAgent(input(provider));
    expect(provider.generate).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS + 1);
    expect(listAvailableProducts).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS);
    expect(calls.at(-1)?.toolChoice).toBe("none");
    expect(res).toMatchObject({ replies: ["Here is our menu."], iterations: MAX_TOOL_ITERATIONS });
  });

  it("falls back and hands off when the model returns no text", async () => {
    const { provider } = fakeProvider([{ text: "", finishReason: "refusal" }]);
    const res = await runAgent(input(provider));
    expect(res.replies).toEqual([FALLBACK_REPLY]);
    expect(res.handedOff).toBe(true);
    expect(flagNeedsHuman).toHaveBeenCalledTimes(1);
  });

  it("lets unexpected errors bubble so the job can retry", async () => {
    vi.mocked(listAvailableProducts).mockRejectedValueOnce(new Error("db down"));
    const { provider } = fakeProvider([{ toolCalls: [call("list_products", {})] }]);
    await expect(runAgent(input(provider))).rejects.toThrow("db down");
  });

  it("sends the inbound message last, after mapped history", async () => {
    const history: HistoryMessage[] = [
      { direction: "IN", sender: "CUSTOMER", type: "text", body: "hello" },
      { direction: "OUT", sender: "STAFF", type: "text", body: "Hi from the team" },
    ];
    const { provider, calls } = fakeProvider([{ text: "ok" }]);
    await runAgent(input(provider, { recentMessages: history, inbound: { type: "text", body: "menu?" } }));
    expect(calls[0].messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "[Team member] Hi from the team" },
      { role: "user", content: "menu?" },
    ]);
  });
});

describe("tool argument validation", () => {
  it("returns schema errors to the model instead of throwing", async () => {
    const { provider, calls } = fakeProvider([{ toolCalls: [call("quote_order", { items: [{ productId: "p_jollof", quantity: 0 }] })] }, { text: "How many?" }]);
    const res = await runAgent(input(provider));
    expect(toolResults(calls)[0].content.error).toMatch(/Invalid arguments/);
    expect(res.replies).toEqual(["How many?"]);
  });

  it("rejects malformed JSON and unknown tools", async () => {
    const { provider, calls } = fakeProvider([{ toolCalls: [call("list_products", "{not json"), call("drop_tables", {})] }]);
    await runAgent(input(provider));
    const [bad, unknown] = toolResults(calls);
    expect(bad.content.error).toMatch(/not valid JSON/);
    expect(unknown.content.error).toMatch(/Unknown tool/);
  });

  it("rejects extra fields such as a smuggled customerId", async () => {
    const args = { items: [{ productId: "p_jollof", quantity: 1 }], customerName: "Ada", deliveryAddress: "1 Allen Avenue, Ikeja", customerId: "c_other" };
    const { provider, calls } = fakeProvider([{ toolCalls: [call("create_order", args)] }]);
    await runAgent(input(provider));
    expect(toolResults(calls)[0].content.error).toMatch(/Invalid arguments/);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("limits send_product_images to 5 products", async () => {
    const { provider, calls } = fakeProvider([{ toolCalls: [call("send_product_images", { productIds: ["a", "b", "c", "d", "e", "f"] })] }]);
    await runAgent(input(provider));
    expect(toolResults(calls)[0].content.error).toMatch(/Invalid arguments/);
    expect(sendTenantImage).not.toHaveBeenCalled();
  });
});

describe("quote_order and create_order", () => {
  const items = [{ productId: "p_jollof", quantity: 2 }];
  const orderArgs = { items, customerName: "Ada", deliveryAddress: "1 Allen Avenue, Ikeja" };
  const summaryShown: HistoryMessage[] = [
    { direction: "IN", sender: "CUSTOMER", type: "text", body: "2 jollof to 1 Allen Avenue, I'm Ada" },
    { direction: "OUT", sender: "BOT", type: "text", body: "2x Jollof Rice, delivery ₦500. Total ₦3,500. Confirm?" },
  ];

  it("quotes with server-side prices and the delivery fee", async () => {
    const { provider, calls } = fakeProvider([{ toolCalls: [call("quote_order", { items: [...items, { productId: "p_chips", quantity: 1 }] })] }]);
    await runAgent(input(provider));
    const q = toolResults(calls)[0].content;
    expect(q.subtotal).toMatch(/3,800/);
    expect(q.deliveryFee).toMatch(/500/);
    expect(q.total).toMatch(/4,300/);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("reports unknown product ids as a tool error", async () => {
    const { provider, calls } = fakeProvider([{ toolCalls: [call("quote_order", { items: [{ productId: "p_ghost", quantity: 1 }] })] }]);
    await runAgent(input(provider));
    expect(toolResults(calls)[0].content.error).toMatch(/Not available: p_ghost/);
  });

  it("refuses to create an order whose total was never shown to the customer", async () => {
    const { provider, calls } = fakeProvider([{ toolCalls: [call("create_order", orderArgs)] }]);
    await runAgent(input(provider, { inbound: { type: "text", body: "yes" } }));
    expect(toolResults(calls)[0].content.error).toMatch(/Order NOT placed/);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("refuses quote + create in the same run", async () => {
    const { provider, calls } = fakeProvider([{ toolCalls: [call("quote_order", { items })] }, { toolCalls: [call("create_order", orderArgs)] }]);
    await runAgent(input(provider, { recentMessages: summaryShown, inbound: { type: "text", body: "yes" } }));
    expect(toolResults(calls)[1].content.error).toMatch(/Order NOT placed/);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("creates the order for the context customer after the summary was confirmed", async () => {
    vi.mocked(createOrder).mockResolvedValue({ number: "ORD-1001", subtotalKobo: 300_000, deliveryFeeKobo: 50_000, totalKobo: 350_000, status: "NEW", items: [] } as never);
    const { provider, calls } = fakeProvider([{ toolCalls: [call("create_order", orderArgs)] }, { text: "Order ORD-1001 placed!" }]);
    const res = await runAgent(input(provider, { recentMessages: summaryShown, inbound: { type: "text", body: "yes" } }));
    expect(createOrder).toHaveBeenCalledWith("t_1", { customerId: "c_1", items, customerName: "Ada", deliveryAddress: "1 Allen Avenue, Ikeja", notes: undefined });
    expect(toolResults(calls)[0].content).toMatchObject({ orderNumber: "ORD-1001" });
    expect(res.replies).toEqual(["Order ORD-1001 placed!"]);
  });

  it("accepts a summary split across several bot messages in the last turn", async () => {
    vi.mocked(createOrder).mockResolvedValue({ number: "ORD-1002", subtotalKobo: 300_000, deliveryFeeKobo: 50_000, totalKobo: 350_000, status: "NEW", items: [] } as never);
    const split: HistoryMessage[] = [...summaryShown, { direction: "OUT", sender: "BOT", type: "text", body: "Reply YES to confirm." }];
    const { provider } = fakeProvider([{ toolCalls: [call("create_order", orderArgs)] }]);
    await runAgent(input(provider, { recentMessages: split, inbound: { type: "text", body: "yes" } }));
    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it("ignores totals shown before the customer's previous message", async () => {
    const stale: HistoryMessage[] = [...summaryShown, { direction: "IN", sender: "CUSTOMER", type: "text", body: "add chips" }, { direction: "OUT", sender: "BOT", type: "text", body: "Sure, anything else?" }];
    const { provider } = fakeProvider([{ toolCalls: [call("create_order", orderArgs)] }]);
    await runAgent(input(provider, { recentMessages: stale, inbound: { type: "text", body: "yes" } }));
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("returns OrderValidationError messages to the model", async () => {
    vi.mocked(createOrder).mockRejectedValue(new OrderValidationError("Jollof Rice is sold out."));
    const { provider, calls } = fakeProvider([{ toolCalls: [call("create_order", orderArgs)] }]);
    await runAgent(input(provider, { recentMessages: summaryShown, inbound: { type: "text", body: "yes" } }));
    expect(toolResults(calls)[0].content.error).toBe("Jollof Rice is sold out.");
  });

  it("does not create a duplicate when the same order was just placed", async () => {
    vi.mocked(getCustomerOrders).mockResolvedValue([
      { number: "ORD-1000", status: "NEW", totalKobo: 350_000, createdAt: new Date(), items: [{ productId: "p_jollof", quantity: 2 }] },
    ] as never);
    const { provider, calls } = fakeProvider([{ toolCalls: [call("create_order", orderArgs)] }]);
    await runAgent(input(provider, { recentMessages: summaryShown, inbound: { type: "text", body: "yes" } }));
    expect(createOrder).not.toHaveBeenCalled();
    expect(toolResults(calls)[0].content).toMatchObject({ alreadyPlaced: true, orderNumber: "ORD-1000" });
  });

  it("simulates create_order in dry-run mode", async () => {
    const { provider, calls } = fakeProvider([{ toolCalls: [call("create_order", orderArgs)] }]);
    const res = await runAgent(input(provider, { recentMessages: summaryShown, inbound: { type: "text", body: "yes" }, dryRun: true }));
    expect(createOrder).not.toHaveBeenCalled();
    expect(toolResults(calls)[0].content).toMatchObject({ simulated: true });
    expect(res.actions.find((a) => a.tool === "create_order")).toMatchObject({ simulated: true });
  });
});

describe("send_product_images and request_human", () => {
  it("sends cover images with '*name* — price' + short description captions and stores them", async () => {
    const { provider, calls } = fakeProvider([{ toolCalls: [call("send_product_images", { productIds: ["p_jollof", "p_chips", "p_ghost"] })] }]);
    await runAgent(input(provider));
    expect(sendTenantImage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendTenantImage).mock.calls[0]).toEqual(["t_1", "2348000000001@c.us", JOLLOF.coverImageUrl, "*Jollof Rice* — ₦1,500\nSmoky party jollof"]);
    expect(storeMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ direction: "OUT", sender: "BOT", type: "image", waMessageId: "wa_img_1" }));
    expect(toolResults(calls)[0].content).toEqual({ sent: ["Jollof Rice"], noImage: ["Chips"], notFound: ["p_ghost"] });
  });

  it("keeps going when the gateway can't deliver a photo, and tells the model", async () => {
    const { OpenWaError } = await import("@/lib/openwa");
    vi.mocked(sendTenantImage).mockRejectedValueOnce(new OpenWaError(400, undefined, "Media fetch failed"));
    const { provider, calls } = fakeProvider([{ toolCalls: [call("send_product_images", { productIds: ["p_jollof"] })] }]);
    await runAgent(input(provider));
    expect(storeMessage).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "image" }));
    expect(toolResults(calls)[0].content).toMatchObject({ sent: [], failed: ["Jollof Rice"], note: expect.stringContaining("describe") });
  });

  it("does not send images in dry-run mode", async () => {
    const { provider } = fakeProvider([{ toolCalls: [call("send_product_images", { productIds: ["p_jollof"] })] }]);
    await runAgent(input(provider, { dryRun: true }));
    expect(sendTenantImage).not.toHaveBeenCalled();
    expect(storeMessage).not.toHaveBeenCalled();
  });

  it("request_human flags the conversation in scope", async () => {
    const { provider } = fakeProvider([{ toolCalls: [call("request_human", { reason: "refund request" })] }, { text: "A team member will reply soon." }]);
    const res = await runAgent(input(provider));
    expect(flagNeedsHuman).toHaveBeenCalledWith(expect.anything(), "t_1", "conv_1", "refund request");
    expect(res.handedOff).toBe(true);
  });
});

describe("mentionsAmount", () => {
  it("matches formatted amounts", () => {
    expect(mentionsAmount("Total ₦3,500. Confirm?", 350_000)).toBe(true);
    expect(mentionsAmount("Total NGN 3500.00", 350_000)).toBe(true);
    expect(mentionsAmount("Total ₦3,550", 350_000)).toBe(false);
    expect(mentionsAmount("no numbers", 350_000)).toBe(false);
  });
});
