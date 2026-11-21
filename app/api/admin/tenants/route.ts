import { NextResponse } from "next/server";
import { z } from "zod";
import { errors, parseJson, parseQuery, requirePlatformAdmin, route } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { listTenants, listTenantsQuery } from "@/components/admin/data";

export const dynamic = "force-dynamic";

/** GET /api/admin/tenants?page=&pageSize=&q=&status= — platform admins only. */
export const GET = route(async (req: Request) => {
  await requirePlatformAdmin();
  const query = parseQuery(req, listTenantsQuery);
  return NextResponse.json(await listTenants(query), { headers: { "cache-control": "no-store" } });
});

const patchBody = z.object({
  tenantId: z.string().min(1).max(64),
  status: z.enum(["ACTIVE", "SUSPENDED"]),
});

/**
 * PATCH /api/admin/tenants { tenantId, status } — suspend or unsuspend a tenant.
 * The WhatsApp session is deliberately left alone: requireTenant blocks the dashboard and the
 * webhook route acknowledges-and-ignores events for suspended tenants, so unsuspending is instant.
 */
export const PATCH = route(async (req: Request) => {
  const { userId } = await requirePlatformAdmin();
  const { tenantId, status } = await parseJson(req, patchBody);

  const existing = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!existing) throw errors.notFound("Business");

  const tenant = await prisma.tenant.update({
    where: { id: tenantId },
    data: { status },
    select: { id: true, name: true, status: true },
  });
  logger.info({ adminUserId: userId, tenantId, status }, "platform admin changed tenant status");
  return NextResponse.json({ tenant });
});
