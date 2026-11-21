import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { ACTIVE_TENANT_COOKIE, errors, parseJson, route } from "@/lib/api";
import { rateLimit } from "@/lib/redis";
import { ACTIVE_TENANT_COOKIE_OPTIONS, clientIp, createTenantWithOwner } from "@/lib/tenants";

const signUpSchema = z.object({
  ownerName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  businessName: z.string().trim().min(2).max(100),
  whatsappPhone: z.string().trim().min(5).max(25),
});

/** Public sign-up. The client signs in with the same credentials afterwards. */
export const POST = route(async (req) => {
  if (!(await rateLimit(`signup:${clientIp(req)}`, 5, 60 * 60))) throw errors.tooMany();
  const input = await parseJson(req, signUpSchema);
  const { user, tenant } = await createTenantWithOwner(input);
  (await cookies()).set(ACTIVE_TENANT_COOKIE, tenant.id, ACTIVE_TENANT_COOKIE_OPTIONS);
  return NextResponse.json({ user, tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug } }, { status: 201 });
});
