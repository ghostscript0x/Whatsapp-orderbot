import { NextResponse } from "next/server";
import { errors, parseJson, requireTenant, route } from "@/lib/api";
import { businessInputSchema } from "@/lib/agent/settings-schema";

const select = { name: true, timezone: true, currency: true } as const;

/** GET /api/settings/business — OWNER and STAFF. */
export const GET = route(async () => {
  const ctx = await requireTenant();
  // Tenant is not a tenant-scoped model; the id comes from the session, never the request.
  const tenant = await ctx.db.tenant.findUnique({ where: { id: ctx.tenantId }, select });
  if (!tenant) throw errors.notFound("Business");
  return NextResponse.json({ business: tenant, canEdit: ctx.role === "OWNER" });
});

/** PUT /api/settings/business — OWNER only. */
export const PUT = route(async (req: Request) => {
  const ctx = await requireTenant({ role: "OWNER" });
  const input = await parseJson(req, businessInputSchema);
  const tenant = await ctx.db.tenant.update({ where: { id: ctx.tenantId }, data: input, select });
  return NextResponse.json({ business: tenant, canEdit: true });
});
