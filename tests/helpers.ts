import { prisma } from "@/lib/prisma";
import { forTenant } from "@/lib/tenant";

let counter = 0;

/** Creates an isolated tenant with an owner user and default bot settings. */
export async function createTestTenant(label = "t") {
  const suffix = `${label}-${Date.now()}-${++counter}`;
  const tenant = await prisma.tenant.create({
    data: { name: `Test ${suffix}`, slug: `test-${suffix}`, botSettings: { create: {} } },
  });
  const user = await prisma.user.create({
    data: { email: `owner-${suffix}@test.local`, passwordHash: "x", name: "Owner" },
  });
  await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: "OWNER" } });
  return { tenant, user, db: forTenant(tenant.id) };
}

/**
 * Deletes every row, children first (works on SQLite and Postgres).
 * Only ever runs against TEST_DATABASE_URL (see tests/env-setup.ts).
 */
export async function resetDb() {
  if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("resetDb refused: not the test database");
  await prisma.$transaction([
    prisma.orderStatusEvent.deleteMany(),
    prisma.orderItem.deleteMany(),
    prisma.order.deleteMany(),
    prisma.message.deleteMany(),
    prisma.conversation.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.productImage.deleteMany(),
    prisma.product.deleteMany(),
    prisma.category.deleteMany(),
    prisma.webhookEvent.deleteMany(),
    prisma.whatsAppSession.deleteMany(),
    prisma.botSettings.deleteMany(),
    prisma.invite.deleteMany(),
    prisma.membership.deleteMany(),
    prisma.passwordResetToken.deleteMany(),
    prisma.tenant.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}
