import { beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { forTenant } from "@/lib/tenant";

/**
 * No database. Prisma runs query extensions in the order they were applied, so forTenant()
 * is applied first and a recorder extension on top of it sees the args forTenant() passes to
 * `query`, i.e. exactly what would be sent to Postgres. The recorder returns without calling
 * `query`, so the engine never connects.
 */
type Captured = { model?: string; operation: string; args: Record<string, unknown> };
const calls: Captured[] = [];

const base = new PrismaClient({ datasourceUrl: "postgresql://unit:unit@127.0.0.1:1/never_connected" });
const TENANT = "tenant_a";

const db = forTenant(TENANT, base).$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args }) {
        calls.push({ model, operation, args: structuredClone(args ?? {}) as Record<string, unknown> });
        return null;
      },
    },
  },
});

function last() {
  const c = calls.at(-1);
  if (!c) throw new Error("no query was captured");
  return c;
}

beforeEach(() => {
  calls.length = 0;
});

describe("forTenant scoping", () => {
  it("rejects an empty tenantId", () => {
    expect(() => forTenant("", base)).toThrow(/requires a tenantId/);
  });

  it.each([
    ["findMany", () => db.product.findMany({ where: { available: true } })],
    ["findFirst", () => db.product.findFirst({ where: { name: "Zobo" } })],
    ["findUnique", () => db.product.findUnique({ where: { id: "p1" } })],
    ["count", () => db.order.count({ where: { status: "NEW" } })],
    ["update", () => db.product.update({ where: { id: "p1" }, data: { name: "x" } })],
    ["updateMany", () => db.conversation.updateMany({ where: { botPaused: true }, data: { botPaused: false } })],
    ["updateManyAndReturn", () => db.conversation.updateManyAndReturn({ where: { botPaused: true }, data: { botPaused: false } })],
    ["delete", () => db.category.delete({ where: { id: "c1" } })],
    ["deleteMany", () => db.message.deleteMany({ where: { conversationId: "conv1" } })],
  ])("%s ANDs tenantId into where and keeps the caller's filter", async (operation, run) => {
    await run();
    const { args, operation: op } = last();
    expect(op).toBe(operation);
    const where = args.where as Record<string, unknown>;
    expect(where.tenantId).toBe(TENANT);
    expect(Object.keys(where).length).toBeGreaterThan(1);
  });

  it("adds a where clause when the caller passed none", async () => {
    await db.order.findMany();
    expect(last().args.where).toEqual({ tenantId: TENANT });
  });

  it("overrides a tenantId the caller tried to pass in where", async () => {
    await db.product.findMany({ where: { tenantId: "tenant_b" } });
    expect((last().args.where as Record<string, unknown>).tenantId).toBe(TENANT);
  });

  it("create injects tenantId into data, overriding a foreign one", async () => {
    await db.category.create({ data: { name: "Mains", tenantId: "tenant_b" } });
    expect(last().args.data).toEqual({ name: "Mains", tenantId: TENANT });
  });

  it("createMany injects tenantId into every row", async () => {
    await db.category.createMany({ data: [{ name: "A", tenantId: "tenant_b" }, { name: "B", tenantId: "tenant_b" }] });
    expect(last().args.data).toEqual([
      { name: "A", tenantId: TENANT },
      { name: "B", tenantId: TENANT },
    ]);
  });

  it("upsert scopes where and create, leaves update alone", async () => {
    await db.botSettings.upsert({
      where: { tenantId: "tenant_b" },
      create: { tenantId: "tenant_b", botName: "Ada" },
      update: { botName: "Ada" },
    });
    const { args } = last();
    expect((args.where as Record<string, unknown>).tenantId).toBe(TENANT);
    expect(args.create).toEqual({ tenantId: TENANT, botName: "Ada" });
    expect(args.update).toEqual({ botName: "Ada" });
  });

  it("leaves non-tenant models (User, Tenant, PasswordResetToken) untouched", async () => {
    await db.user.findMany({ where: { email: "a@b.c" } });
    expect(last()).toMatchObject({ model: "User", args: { where: { email: "a@b.c" } } });

    await db.tenant.findUnique({ where: { id: "t1" } });
    expect(last()).toMatchObject({ model: "Tenant", args: { where: { id: "t1" } } });

    await db.user.create({ data: { email: "a@b.c", name: "A", passwordHash: "h" } });
    expect(last().args.data).toEqual({ email: "a@b.c", name: "A", passwordHash: "h" });

    await db.passwordResetToken.findMany();
    expect(last().args.where).toBeUndefined();
  });
});
