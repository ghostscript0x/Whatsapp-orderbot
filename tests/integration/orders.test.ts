import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture notifications instead of talking to Redis.
const added: { name: string; data: unknown }[] = [];
vi.mock("@/lib/queues", () => ({
  notifyQueue: () => ({ add: async (name: string, data: unknown) => void added.push({ name, data }) }),
}));

import { prisma } from "@/lib/prisma";
import { createTestTenant, resetDb } from "../helpers";
import { changeOrderStatus, countOrdersByStatus, createOrder, getCustomerOrders, listOrders, OrderValidationError } from "@/lib/orders";

async function seedTenant(label: string) {
  const t = await createTestTenant(label);
  await prisma.botSettings.update({ where: { tenantId: t.tenant.id }, data: { deliveryFeeKobo: 50000 } });
  const rice = await prisma.product.create({ data: { tenantId: t.tenant.id, name: "Jollof Rice", priceKobo: 250000 } });
  const coke = await prisma.product.create({ data: { tenantId: t.tenant.id, name: "Coke", priceKobo: 30000 } });
  const customer = await prisma.customer.create({ data: { tenantId: t.tenant.id, waChatId: `234800${label.length}@c.us`, phone: "2348000000001" } });
  return { ...t, rice, coke, customer };
}

const base = { customerName: "Ada", deliveryAddress: "1 Main St" };

describe("createOrder", () => {
  beforeEach(async () => {
    await resetDb();
    added.length = 0;
  });

  it("numbers orders atomically under concurrency", async () => {
    const a = await seedTenant("num");
    const orders = await Promise.all(
      Array.from({ length: 8 }, () => createOrder(a.tenant.id, { ...base, customerId: a.customer.id, items: [{ productId: a.rice.id, quantity: 1 }] })),
    );
    const numbers = orders.map((o) => Number(o.number.replace("ORD-", ""))).sort((x, y) => x - y);
    expect(new Set(numbers).size).toBe(8);
    expect(numbers).toEqual(Array.from({ length: 8 }, (_, i) => 1001 + i));
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: a.tenant.id } });
    expect(tenant.orderCounter).toBe(1008);
  });

  it("uses server-side prices, merges duplicates, adds the delivery fee and records NEW", async () => {
    const a = await seedTenant("price");
    const order = await createOrder(a.tenant.id, {
      ...base,
      customerId: a.customer.id,
      items: [
        { productId: a.rice.id, quantity: 1 },
        { productId: a.coke.id, quantity: 2 },
        { productId: a.rice.id, quantity: 1 },
      ],
    });
    expect(order.items).toHaveLength(2);
    expect(order.items.every((i) => i.tenantId === a.tenant.id)).toBe(true);
    expect(order.subtotalKobo).toBe(2 * 250000 + 2 * 30000);
    expect(order.deliveryFeeKobo).toBe(50000);
    expect(order.totalKobo).toBe(560000 + 50000);
    const events = await prisma.orderStatusEvent.findMany({ where: { orderId: order.id } });
    expect(events).toMatchObject([{ fromStatus: null, toStatus: "NEW", tenantId: a.tenant.id }]);
    expect(added).toEqual([{ name: "owner-new-order", data: { kind: "owner-new-order", tenantId: a.tenant.id, orderId: order.id } }]);
  });

  it("rejects another tenant's product and creates nothing", async () => {
    const a = await seedTenant("iso-a");
    const b = await seedTenant("iso-b");
    await expect(
      createOrder(a.tenant.id, { ...base, customerId: a.customer.id, items: [{ productId: b.rice.id, quantity: 1 }] }),
    ).rejects.toBeInstanceOf(OrderValidationError);
    expect(await prisma.order.count()).toBe(0);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: a.tenant.id } })).orderCounter).toBe(1000);
    expect(added).toHaveLength(0);
  });

  it("rejects another tenant's customer", async () => {
    const a = await seedTenant("cust-a");
    const b = await seedTenant("cust-b");
    await expect(
      createOrder(a.tenant.id, { ...base, customerId: b.customer.id, items: [{ productId: a.rice.id, quantity: 1 }] }),
    ).rejects.toBeInstanceOf(OrderValidationError);
  });

  it("rejects unavailable products by name", async () => {
    const a = await seedTenant("avail");
    await prisma.product.update({ where: { id: a.coke.id }, data: { available: false } });
    await expect(
      createOrder(a.tenant.id, { ...base, customerId: a.customer.id, items: [{ productId: a.coke.id, quantity: 1 }] }),
    ).rejects.toThrow('"Coke" is currently unavailable.');
  });
});

describe("changeOrderStatus", () => {
  beforeEach(async () => {
    await resetDb();
    added.length = 0;
  });

  it("follows allowed transitions, records events and is tenant-scoped", async () => {
    const a = await seedTenant("st-a");
    const b = await seedTenant("st-b");
    const order = await createOrder(a.tenant.id, { ...base, customerId: a.customer.id, items: [{ productId: a.rice.id, quantity: 1 }] });
    added.length = 0;

    await expect(changeOrderStatus(a.tenant.id, order.id, "DELIVERED", a.user.id)).rejects.toBeInstanceOf(OrderValidationError);
    await expect(changeOrderStatus(b.tenant.id, order.id, "CONFIRMED", b.user.id)).rejects.toThrow("Order not found");

    const confirmed = await changeOrderStatus(a.tenant.id, order.id, "CONFIRMED", a.user.id);
    expect(confirmed.status).toBe("CONFIRMED");
    await changeOrderStatus(a.tenant.id, order.id, "CONFIRMED", a.user.id); // no-op
    expect(await prisma.orderStatusEvent.count({ where: { orderId: order.id } })).toBe(2);
    expect(added).toHaveLength(1);

    const recent = await getCustomerOrders(a.db, a.customer.id, order.number.replace("ORD-", ""));
    expect(recent.map((o) => o.id)).toEqual([order.id]);
    expect(await getCustomerOrders(b.db, a.customer.id)).toEqual([]);
  });
});

describe("order list extras", () => {
  beforeEach(async () => {
    await resetDb();
    added.length = 0;
  });

  it("adds itemSummary per row and status counts that ignore the status filter but honour q/dates", async () => {
    const a = await seedTenant("list-a");
    const b = await seedTenant("list-b");
    const mk = (items: { productId: string; quantity: number }[]) => createOrder(a.tenant.id, { ...base, customerId: a.customer.id, items });
    const o1 = await mk([{ productId: a.rice.id, quantity: 2 }, { productId: a.coke.id, quantity: 1 }]);
    const o2 = await mk([{ productId: a.coke.id, quantity: 3 }]);
    await mk([{ productId: a.rice.id, quantity: 1 }]);
    await changeOrderStatus(a.tenant.id, o1.id, "CONFIRMED", a.user.id);
    await changeOrderStatus(a.tenant.id, o2.id, "CANCELLED", a.user.id);
    await createOrder(b.tenant.id, { ...base, customerId: b.customer.id, items: [{ productId: b.rice.id, quantity: 1 }] });

    const page = await listOrders(a.db, { status: "CONFIRMED" }, { limit: 10 });
    expect(page.orders.map((o) => [o.number, o.itemSummary, o.itemCount])).toEqual([[o1.number, "2× Jollof Rice, 1× Coke", 2]]);

    expect(await countOrdersByStatus(a.db, { status: "CONFIRMED" })).toEqual({ NEW: 1, CONFIRMED: 1, OUT_FOR_DELIVERY: 0, DELIVERED: 0, CANCELLED: 1 });
    expect(await countOrdersByStatus(a.db, { q: o2.number })).toEqual({ NEW: 0, CONFIRMED: 0, OUT_FOR_DELIVERY: 0, DELIVERED: 0, CANCELLED: 1 });
    expect(await countOrdersByStatus(a.db, { from: new Date(Date.now() + 60_000) })).toEqual({ NEW: 0, CONFIRMED: 0, OUT_FOR_DELIVERY: 0, DELIVERED: 0, CANCELLED: 0 });
  });
});
