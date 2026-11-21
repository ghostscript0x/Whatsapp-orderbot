import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { auth } from "@/auth";
import { ACTIVE_TENANT_COOKIE, errors, parseJson, route } from "@/lib/api";
import { rateLimit } from "@/lib/redis";
import { ACTIVE_TENANT_COOKIE_OPTIONS, createTenantForUser } from "@/lib/tenants";

const schema = z.object({
  businessName: z.string().trim().min(2).max(100),
  whatsappPhone: z.string().trim().min(5).max(25),
});

/** A signed-in user creates another business (they become its OWNER) and switches to it. */
export const POST = route(async (req) => {
  const userId = (await auth())?.user?.id;
  if (!userId) throw errors.unauthorized();
  if (!(await rateLimit(`tenant-new:${userId}`, 5, 60 * 60))) throw errors.tooMany();
  const input = await parseJson(req, schema);
  const tenant = await createTenantForUser(userId, input);
  (await cookies()).set(ACTIVE_TENANT_COOKIE, tenant.id, ACTIVE_TENANT_COOKIE_OPTIONS);
  return NextResponse.json({ tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug } }, { status: 201 });
});
