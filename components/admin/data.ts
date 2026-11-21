import type { Prisma, TenantStatus, WaStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { insensitive } from "@/lib/db-compat";

/** Platform-admin queries. Raw (unscoped) prisma by design: admins see every tenant. */

export const ADMIN_PAGE_SIZE = 25;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const listTenantsQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(ADMIN_PAGE_SIZE),
  q: z.string().trim().max(100).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});
export type ListTenantsQuery = z.infer<typeof listTenantsQuery>;

export type AdminTenantRow = {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  whatsappStatus: WaStatus | null;
  ordersLast7Days: number;
  ownerEmail: string | null;
  createdAt: string;
};

export type AdminTenantPage = { tenants: AdminTenantRow[]; page: number; pageSize: number; total: number; totalPages: number };

export async function listTenants(query: ListTenantsQuery, now: Date = new Date()): Promise<AdminTenantPage> {
  const { page, pageSize, q, status } = query;
  const where: Prisma.TenantWhereInput = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, ...insensitive() } },
            { slug: { contains: q, ...insensitive() } },
            { memberships: { some: { role: "OWNER", user: { email: { contains: q, ...insensitive() } } } } },
          ],
        }
      : {}),
  };

  const [total, tenants] = await Promise.all([
    prisma.tenant.count({ where }),
    prisma.tenant.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        whatsappSession: { select: { status: true } },
        memberships: {
          where: { role: "OWNER" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { user: { select: { email: true } } },
        },
      },
    }),
  ]);

  const ids = tenants.map((t) => t.id);
  const counts = ids.length
    ? await prisma.order.groupBy({
        by: ["tenantId"],
        where: { tenantId: { in: ids }, createdAt: { gte: new Date(now.getTime() - WEEK_MS) } },
        _count: { _all: true },
      })
    : [];
  const ordersByTenant = new Map(counts.map((c) => [c.tenantId, c._count._all]));

  return {
    tenants: tenants.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      whatsappStatus: t.whatsappSession?.status ?? null,
      ordersLast7Days: ordersByTenant.get(t.id) ?? 0,
      ownerEmail: t.memberships[0]?.user.email ?? null,
      createdAt: t.createdAt.toISOString(),
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
