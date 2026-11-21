import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";

// No Redis or WhatsApp: capture what would be sent and enqueued.
const sent: { tenantId: string; chatId: string; text: string }[] = [];
const enqueued: { name: string; data: unknown }[] = [];
let sendFails: Error | null = null;

vi.mock("@/lib/openwa", () => ({
  WhatsAppNotConnectedError: class WhatsAppNotConnectedError extends Error {},
  sendTenantText: async (tenantId: string, chatId: string, text: string) => {
    if (sendFails) throw sendFails;
    sent.push({ tenantId, chatId, text });
    return { messageId: `wa-${sent.length}` };
  },
}));
vi.mock("@/lib/redis", () => ({ redis: () => ({ del: async () => 0 }), bullConnection: () => ({}) }));
vi.mock("@/lib/queues", () => ({
  QUEUE_NOTIFY: "notifications",
  notifyQueue: () => ({ add: async (name: string, data: unknown) => void enqueued.push({ name, data }) }),
}));

import { prisma } from "@/lib/prisma";
import { WhatsAppNotConnectedError } from "@/lib/openwa";
import type { NotifyJob } from "@/lib/queues";
import { changeOrderStatus, createOrder } from "@/lib/orders";
import { flagNeedsHuman } from "@/lib/conversations";
import { processNotifyJob } from "../../worker/notifications";
import { createTestTenant, resetDb } from "../helpers";

const run = (data: NotifyJob) => processNotifyJob({ data } as Job<NotifyJob>);

async function seed(label: string) {
  const t = await createTestTenant(label);
  await prisma.botSettings.update({ where: { tenantId: t.tenant.id }, data: { ownerAlertPhone: "2348099999999" } });
  const rice = await prisma.product.create({ data: { tenantId: t.tenant.id, name: "Jollof Rice", priceKobo: 250000 } });
  const customer = await prisma.customer.create({
    data: { tenantId: t.tenant.id, waChatId: `2348000${label.length}@c.us`, phone: "2348000000001", conversation: { create: { tenantId: t.tenant.id } } },
    include: { conversation: true },
  });
  const order = await createOrder(t.tenant.id, { customerId: customer.id, customerName: "Ada Obi", deliveryAddress: "1 Main St", items: [{ productId: rice.id, quantity: 2 }] });
  return { ...t, customer, conversationId: customer.conversation!.id, order };
}

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
  enqueued.length = 0;
  sendFails = null;
});

describe("order-status notifications", () => {
  it("announces each status that was queued, even after the order moved on", async () => {
    const a = await seed("seq");
    await changeOrderStatus(a.tenant.id, a.order.id, "CONFIRMED", a.user.id);
    await changeOrderStatus(a.tenant.id, a.order.id, "OUT_FOR_DELIVERY", a.user.id);
    const jobs = enqueued.filter((j) => j.name === "order-status").map((j) => j.data as NotifyJob);
    expect(jobs.map((j) => (j as { status?: string }).status)).toEqual(["CONFIRMED", "OUT_FOR_DELIVERY"]);

    for (const job of jobs) await run(job);
    expect(sent.map((s) => s.text)).toEqual([
      expect.stringMatching(/^Hi Ada! 🎉 Your order ORD-1001 \(.+\) is confirmed/),
      expect.stringMatching(/^Good news, Ada! 🛵 Your order ORD-1001 is on its way/),
    ]);
    expect(sent.every((s) => s.chatId === a.customer.waChatId)).toBe(true);

    const stored = await prisma.message.findMany({ where: { conversationId: a.conversationId }, orderBy: { createdAt: "asc" } });
    expect(stored.map((m) => [m.direction, m.sender, m.waMessageId])).toEqual([
      ["OUT", "BOT", "wa-1"],
      ["OUT", "BOT", "wa-2"],
    ]);
  });

  it("drops a stale update once the order has been cancelled", async () => {
    const a = await seed("stale");
    await changeOrderStatus(a.tenant.id, a.order.id, "CONFIRMED", a.user.id);
    await changeOrderStatus(a.tenant.id, a.order.id, "CANCELLED", a.user.id);
    const [confirmed, cancelled] = enqueued.filter((j) => j.name === "order-status").map((j) => j.data as NotifyJob);
    await run(confirmed);
    expect(sent).toHaveLength(0);
    await run(cancelled);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("has been cancelled");
  });

  it("completes without retrying when WhatsApp is not connected, but rethrows other failures", async () => {
    const a = await seed("fail");
    sendFails = new WhatsAppNotConnectedError("not connected");
    await expect(run({ kind: "order-status", tenantId: a.tenant.id, orderId: a.order.id, status: "CONFIRMED" })).resolves.toBeUndefined();
    sendFails = new Error("gateway 502");
    await expect(run({ kind: "order-status", tenantId: a.tenant.id, orderId: a.order.id, status: "CONFIRMED" })).rejects.toThrow("gateway 502");
    expect(await prisma.message.count()).toBe(0);
  });

  it("is tenant-scoped: another tenant's id finds nothing and sends nothing", async () => {
    const a = await seed("iso-a");
    const b = await seed("iso-b");
    await run({ kind: "order-status", tenantId: b.tenant.id, orderId: a.order.id, status: "CONFIRMED" });
    await run({ kind: "owner-new-order", tenantId: b.tenant.id, orderId: a.order.id });
    expect(sent).toHaveLength(0);
  });
});

describe("owner alerts", () => {
  it("sends the new-order alert to the owner's alert phone", async () => {
    const a = await seed("owner");
    await run({ kind: "owner-new-order", tenantId: a.tenant.id, orderId: a.order.id });
    expect(sent).toHaveLength(1);
    expect(sent[0].chatId).toBe("2348099999999@c.us");
    expect(sent[0].text.split("\n")[0]).toMatch(/^🛒 New order ORD-1001 · /);
    expect(sent[0].text).toContain(`/dashboard/orders/${a.order.id}`);
  });

  it("flagNeedsHuman alerts the owner once even when called concurrently", async () => {
    const a = await seed("human");
    enqueued.length = 0;
    await Promise.all([
      flagNeedsHuman(a.db, a.tenant.id, a.conversationId, "Wants a refund"),
      flagNeedsHuman(a.db, a.tenant.id, a.conversationId, "Wants a refund"),
      flagNeedsHuman(a.db, a.tenant.id, a.conversationId, "Still waiting"),
    ]);
    expect(enqueued.filter((j) => j.name === "owner-needs-human")).toHaveLength(1);
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: a.conversationId } });
    expect(conv).toMatchObject({ needsHuman: true, botPaused: true });

    const other = await seed("human-b");
    await expect(flagNeedsHuman(other.db, other.tenant.id, a.conversationId, "x")).rejects.toThrow("not found");
  });
});
