import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/redis", () => ({ redis: () => ({ del: async () => 0 }), bullConnection: () => ({}) }));
vi.mock("@/lib/queues", () => ({ notifyQueue: () => ({ add: async () => undefined }) }));

import { prisma } from "@/lib/prisma";
import { conversationCounts, listConversations } from "@/lib/conversations";
import { createTestTenant, resetDb } from "../helpers";

async function seedConversation(tenantId: string, phone: string, flags: { needsHuman?: boolean; botPaused?: boolean }) {
  const customer = await prisma.customer.create({ data: { tenantId, waChatId: `${phone}@c.us`, phone, name: `C${phone.slice(-2)}` } });
  return prisma.conversation.create({ data: { tenantId, customerId: customer.id, ...flags } });
}

describe("conversation inbox", () => {
  beforeEach(resetDb);

  it("filters by botPaused/needsHuman and returns tenant-wide counts", async () => {
    const a = await createTestTenant("inbox-a");
    const b = await createTestTenant("inbox-b");
    const paused = await seedConversation(a.tenant.id, "2348000000001", { botPaused: true });
    const both = await seedConversation(a.tenant.id, "2348000000002", { botPaused: true, needsHuman: true });
    const active = await seedConversation(a.tenant.id, "2348000000003", {});
    await seedConversation(b.tenant.id, "2348000000004", { botPaused: true, needsHuman: true });

    const ids = async (filters: Parameters<typeof listConversations>[1]) =>
      (await listConversations(a.db, filters, { limit: 10 })).conversations.map((c) => c.id).sort();

    expect(await ids({ botPaused: true })).toEqual([paused.id, both.id].sort());
    expect(await ids({ botPaused: false })).toEqual([active.id]);
    expect(await ids({ botPaused: true, needsHuman: true })).toEqual([both.id]);
    expect(await ids({})).toHaveLength(3);

    expect(await conversationCounts(a.db)).toEqual({ needsHuman: 1, botPaused: 2 });
    expect(await conversationCounts(b.db)).toEqual({ needsHuman: 1, botPaused: 1 });
  });
});
