import { beforeEach, describe, expect, it, vi } from "vitest";
import pino from "pino";

vi.mock("@/lib/products", () => ({ listAvailableProducts: vi.fn(), getAvailableProductsByIds: vi.fn() }));
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

import * as products from "@/lib/products";
import * as orders from "@/lib/orders";
import { flagNeedsHuman } from "@/lib/conversations";
import { sendTenantImage } from "@/lib/openwa";
import { HANDOFF_REPLY, runAgent, type RunAgentInput } from "@/lib/agent/run";
import { buildCustomerProfile } from "@/lib/agent/profile";
import { DEFAULT_BOT_CONFIG } from "@/lib/agent/config";
import type { GenerateInput, GenerateResult, LlmProvider } from "@/lib/llm/types";
import type { TenantDb } from "@/lib/tenant";

const JOLLOF = { id: "p_jollof", name: "Jollof Rice", priceKobo: 150_000, description: "Smoky. Party jollof.", category: "Mains", coverImageUrl: "https://cdn.example/j.jpg" };
const RICE = { id: "p_rice", name: "Fried Rice", priceKobo: 180_000, description: "", category: "Mains", coverImageUrl: "https://cdn.example/r.jpg" };

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

function input(provider: LlmProvider, overrides: Partial<RunAgentInput> = {}): RunAgentInput {
  return {
    tenantId: "t_1",
    db: {} as TenantDb,
    customer: { id: "c_1", name: "Ada Obi", phone: "2348000000001" },
    conversation: { id: "conv_1" },
    recentMessages: [],
    inbound: { type: "text", body: "Hi" },
    chatId: "2348000000001@c.us",
    tenant: { name: "Mama Put", currency: "NGN", timezone: "Africa/Lagos" },
    settings: { ...DEFAULT_BOT_CONFIG },
    provider,
    log: pino({ level: "silent" }),
    now: new Date("2026-11-23T12:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(products.listAvailableProducts).mockResolvedValue([JOLLOF, RICE] as never);
  vi.mocked(products.getAvailableProductsByIds).mockImplementation(async (_db, ids) => [JOLLOF, RICE].filter((p) => ids.includes(p.id)) as never);
  vi.mocked(orders.getCustomerOrders).mockResolvedValue([]);
  vi.mocked(sendTenantImage).mockResolvedValue({ messageId: "wa_img" });
});

describe("bursts", () => {
  it("answers a burst of messages in one user turn and one model call", async () => {
    const { provider, calls } = fakeProvider([{ text: "Hey Ada! Yes we do, ₦1,500 a plate." }]);
    const res = await runAgent(
      input(provider, { inbound: [{ type: "text", body: "hi" }, { type: "text", body: "do you have jollof" }, { type: "text", body: "how much" }] }),
    );
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(calls[0].messages).toEqual([{ role: "user", content: "hi\ndo you have jollof\nhow much" }]);
    expect(res.replies).toEqual(["Hey Ada! Yes we do, ₦1,500 a plate."]);
  });

  it("hands off when any message of the burst is the handoff keyword", async () => {
    const { provider } = fakeProvider([]);
    const res = await runAgent(input(provider, { inbound: [{ type: "text", body: "hello" }, { type: "text", body: "human" }] }));
    expect(provider.generate).not.toHaveBeenCalled();
    expect(flagNeedsHuman).toHaveBeenCalledTimes(1);
    expect(res.replies).toEqual([HANDOFF_REPLY]);
    expect(HANDOFF_REPLY).toMatch(/someone from the team/);
  });
});

describe("media", () => {
  it("tells the model about voice notes, stickers, photos and locations", async () => {
    const { provider, calls } = fakeProvider([{ text: "ok" }]);
    await runAgent(
      input(provider, {
        recentMessages: [{ direction: "IN", sender: "CUSTOMER", type: "sticker", body: "" }, { direction: "OUT", sender: "BOT", type: "text", body: "😄" }],
        inbound: [
          { type: "voice", body: "" },
          { type: "image", body: "this one" },
          { type: "location", body: "Ikeja City Mall (pin: https://maps.google.com/?q=6.6,3.35)" },
        ],
      }),
    );
    const msgs = calls[0].messages;
    expect(msgs[0]).toEqual({ role: "user", content: expect.stringMatching(/sticker/) });
    const last = msgs.at(-1)!;
    expect(last.role).toBe("user");
    expect((last as { content: string }).content).toMatch(/voice note[\s\S]*photo[\s\S]*Caption: "this one"[\s\S]*location: Ikeja City Mall/);
  });
});

describe("interim text and photos", () => {
  it("sends text written alongside tool calls before the tools run, and paces photos", async () => {
    const order: string[] = [];
    vi.mocked(sendTenantImage).mockImplementation(async (_t, _c, url) => {
      order.push(`image:${url}`);
      return { messageId: "wa" };
    });
    const pause = vi.fn(async () => {
      order.push("pause");
    });
    const { provider } = fakeProvider([
      { text: "Let me show you 👀", toolCalls: [{ id: "c1", name: "send_product_images", arguments: JSON.stringify({ productIds: ["p_jollof", "p_rice"] }) }] },
      { text: "Which one catches your eye?" },
    ]);
    const res = await runAgent(
      input(provider, {
        pause,
        onInterimText: async (t) => {
          order.push(`text:${t}`);
        },
      }),
    );
    expect(order).toEqual(["text:Let me show you 👀", `image:${JOLLOF.coverImageUrl}`, "pause", `image:${RICE.coverImageUrl}`]);
    expect(res.replies).toEqual(["Which one catches your eye?"]);
  });

  it("returns interim text as a reply when no callback is given", async () => {
    const { provider } = fakeProvider([{ text: "One sec", toolCalls: [{ id: "c1", name: "list_products", arguments: "{}" }] }, { text: "We have jollof." }]);
    const res = await runAgent(input(provider));
    expect(res.replies).toEqual(["One sec", "We have jollof."]);
  });
});

describe("customer profile", () => {
  it("summarises order history and the last chat", async () => {
    const now = new Date("2026-11-23T12:00:00Z");
    const db = { order: { count: vi.fn().mockResolvedValue(4) } } as unknown as TenantDb;
    vi.mocked(orders.getCustomerOrders).mockResolvedValue([
      { createdAt: new Date("2026-11-20T12:00:00Z"), items: [{ quantity: 2, nameSnapshot: "Jollof Rice" }] },
    ] as never);
    const p = await buildCustomerProfile(db, { id: "c_1", name: "Ada" }, new Date("2026-11-22T12:00:00Z"), now);
    expect(p).toEqual({ displayName: "Ada", orderCount: 4, lastOrderItems: ["2x Jollof Rice"], lastOrderDaysAgo: 3, lastChatDaysAgo: 1 });
  });

  it("marks a first-time customer", async () => {
    const db = { order: { count: vi.fn().mockResolvedValue(0) } } as unknown as TenantDb;
    expect(await buildCustomerProfile(db, { id: "c_2", name: null }, undefined)).toEqual({ displayName: null, orderCount: 0 });
  });
});
