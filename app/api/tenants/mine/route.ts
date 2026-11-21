import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { ACTIVE_TENANT_COOKIE, errors, route } from "@/lib/api";
import { getMyTenants } from "@/lib/tenants";

/** The signed-in user's businesses and which one is active. */
export const GET = route(async () => {
  const userId = (await auth())?.user?.id;
  if (!userId) throw errors.unauthorized();
  const { tenants, active } = await getMyTenants(userId, (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value);
  return NextResponse.json({ tenants, activeTenantId: active?.tenantId ?? null });
});
