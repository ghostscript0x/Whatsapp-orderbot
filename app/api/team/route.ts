import { NextResponse } from "next/server";
import { z } from "zod";
import { errors, parseJson, requireTenant, route } from "@/lib/api";

/** Members of the active business, plus pending invites (owners only). */
export const GET = route(async () => {
  const ctx = await requireTenant();
  const members = await ctx.db.membership.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
  });
  const invites =
    ctx.role === "OWNER"
      ? await ctx.db.invite.findMany({
          where: { acceptedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
          select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
        })
      : [];
  return NextResponse.json({ members, invites, me: { userId: ctx.userId, role: ctx.role } });
});

const removeSchema = z.object({ membershipId: z.string().min(1).max(64) });

/** OWNER removes a member. Owners can't remove themselves, and the last owner can't be removed. */
export const DELETE = route(async (req) => {
  const ctx = await requireTenant({ role: "OWNER" });
  const { membershipId } = await parseJson(req, removeSchema);

  await ctx.db.$transaction(async (tx) => {
    const target = await tx.membership.findUnique({ where: { id: membershipId } });
    if (!target) throw errors.notFound("Member");
    if (target.userId === ctx.userId) throw errors.badRequest("You can't remove yourself");
    if (target.role === "OWNER") {
      const owners = await tx.membership.count({ where: { role: "OWNER" } });
      if (owners <= 1) throw errors.badRequest("A business needs at least one owner");
    }
    await tx.membership.delete({ where: { id: target.id } });
  });
  return NextResponse.json({ ok: true });
});
