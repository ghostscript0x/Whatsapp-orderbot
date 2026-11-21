import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestTenant, resetDb } from "../helpers";

/**
 * PRD 11: tenant A must not be able to read, update or delete tenant B's products,
 * orders or conversations through forTenant(A). B's rows are created with the raw client.
 */
type Fixture = Awaited<ReturnType<typeof setup>>;

async function setup() {
  await resetDb();
  const a = await createTestTenant("a");
  const b = await createTestTenant("b");

  const product = await prisma.product.create({ data: { tenantId: b.tenant.id, name: "B Jollof", priceKobo: 250000 } });
  const customer = await prisma.customer.create({ data: { tenantId: b.tenant.id, waChatId: "2348011111111@c.us", phone: "2348011111111" } });
  const conversation = await prisma.conversation.create({ data: { tenantId: b.tenant.id, customerId: customer.id } });
  await prisma.message.create({
    data: { tenantId: b.tenant.id, conversationId: conversation.id, direction: "IN", sender: "CUSTOMER", body: "hi" },
  });
  const order = await prisma.order.create({
    data: {
      tenantId: b.tenant.id,
      number: "ORD-1001",
      customerId: customer.id,
      subtotalKobo: 250000,
      deliveryFeeKobo: 0,
      totalKobo: 250000,
      customerName: "Bola",
      deliveryAddress: "1 B Street",
      items: {
        create: [{ tenantId: b.tenant.id, productId: product.id, nameSnapshot: "B Jollof", unitPriceKobo: 250000, quantity: 1 }],
      },
    },
  });
  return { a, b, product, customer, conversation, order };
}

let f: Fixture;
beforeAll(async () => {
  f = await setup();
});

describe("tenant isolation via forTenant(A)", () => {
  it("cannot read B's products, orders, conversations, customers or messages", async () => {
    const db = f.a.db;
    expect(await db.product.findUnique({ where: { id: f.product.id } })).toBeNull();
    expect(await db.product.findFirst({ where: { name: "B Jollof" } })).toBeNull();
    expect(await db.product.findMany()).toHaveLength(0);
    expect(await db.order.findUnique({ where: { id: f.order.id } })).toBeNull();
    expect(await db.order.findMany({ where: { number: "ORD-1001" } })).toHaveLength(0);
    expect(await db.orderItem.count()).toBe(0);
    expect(await db.conversation.findUnique({ where: { id: f.conversation.id } })).toBeNull();
    expect(await db.conversation.findMany()).toHaveLength(0);
    expect(await db.customer.findMany()).toHaveLength(0);
    expect(await db.message.findMany({ where: { conversationId: f.conversation.id } })).toHaveLength(0);
    await expect(db.order.findUniqueOrThrow({ where: { id: f.order.id } })).rejects.toThrow();
  });

  it("cannot update B's rows", async () => {
    const db = f.a.db;
    await expect(db.product.update({ where: { id: f.product.id }, data: { priceKobo: 1 } })).rejects.toThrow();
    await expect(db.order.update({ where: { id: f.order.id }, data: { status: "CANCELLED" } })).rejects.toThrow();
    await expect(db.conversation.update({ where: { id: f.conversation.id }, data: { botPaused: true } })).rejects.toThrow();
    expect((await db.product.updateMany({ data: { available: false } })).count).toBe(0);
    expect((await db.order.updateMany({ where: { id: f.order.id }, data: { status: "CANCELLED" } })).count).toBe(0);
    expect((await db.conversation.updateMany({ data: { needsHuman: true } })).count).toBe(0);

    const product = await prisma.product.findUniqueOrThrow({ where: { id: f.product.id } });
    expect(product.priceKobo).toBe(250000);
    expect(product.available).toBe(true);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("NEW");
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: f.conversation.id } });
    expect(conv.botPaused).toBe(false);
    expect(conv.needsHuman).toBe(false);
  });

  it("cannot delete B's rows", async () => {
    const db = f.a.db;
    await expect(db.product.delete({ where: { id: f.product.id } })).rejects.toThrow();
    await expect(db.conversation.delete({ where: { id: f.conversation.id } })).rejects.toThrow();
    await expect(db.order.delete({ where: { id: f.order.id } })).rejects.toThrow();
    expect((await db.product.deleteMany()).count).toBe(0);
    expect((await db.order.deleteMany()).count).toBe(0);
    expect((await db.message.deleteMany()).count).toBe(0);
    expect((await db.conversation.deleteMany()).count).toBe(0);

    expect(await prisma.product.count({ where: { tenantId: f.b.tenant.id } })).toBe(1);
    expect(await prisma.order.count({ where: { tenantId: f.b.tenant.id } })).toBe(1);
    expect(await prisma.conversation.count({ where: { tenantId: f.b.tenant.id } })).toBe(1);
    expect(await prisma.message.count({ where: { tenantId: f.b.tenant.id } })).toBe(1);
  });

  it("cannot write into B by passing B's tenantId", async () => {
    const created = await f.a.db.product.create({
      data: { tenantId: f.b.tenant.id, name: "Sneaky", priceKobo: 100 },
    });
    expect(created.tenantId).toBe(f.a.tenant.id);
    expect(await prisma.product.count({ where: { tenantId: f.b.tenant.id } })).toBe(1);
  });

  it("B still sees its own data", async () => {
    expect(await f.b.db.product.findUnique({ where: { id: f.product.id } })).not.toBeNull();
    expect(await f.b.db.order.findMany()).toHaveLength(1);
    expect(await f.b.db.conversation.findMany()).toHaveLength(1);
  });
});
