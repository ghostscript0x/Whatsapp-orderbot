import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ACTIVE_TENANT_COOKIE, errors, parseJson, route } from "@/lib/api";
import { ACTIVE_TENANT_COOKIE_OPTIONS } from "@/lib/tenants";

const schema = z.object({ tenantId: z.string().min(1).max(64) });

/** Sets the active tenant cookie after checking the user is a member. */
export const POST = route(async (req) => {
  const userId = (await auth())?.user?.id;
  if (!userId) throw errors.unauthorized();
  const { tenantId } = await parseJson(req, schema);
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    include: { tenant: { select: { status: true } } },
  });
  if (!membership) throw errors.notFound("Business");
  if (membership.tenant.status === "SUSPENDED") throw errors.forbidden("This business is suspended");
  (await cookies()).set(ACTIVE_TENANT_COOKIE, tenantId, ACTIVE_TENANT_COOKIE_OPTIONS);
  return NextResponse.json({ tenantId, role: membership.role });
});
