import { NextResponse } from "next/server";
import { z } from "zod";
import { errors, parseJson, requireTenant, route } from "@/lib/api";
import { rateLimit } from "@/lib/redis";
import { randomToken, sha256 } from "@/lib/crypto";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { INVITE_TTL_MS } from "@/lib/tenants";

const inviteSchema = z.object({ email: z.string().trim().email().max(254) });
const revokeSchema = z.object({ inviteId: z.string().min(1).max(64) });

/** OWNER invites a staff member by email. Re-inviting the same email replaces the pending invite. */
export const POST = route(async (req) => {
  const ctx = await requireTenant({ role: "OWNER" });
  if (!(await rateLimit(`invite:${ctx.tenantId}`, 20, 60 * 60))) throw errors.tooMany();
  const email = (await parseJson(req, inviteSchema)).email.toLowerCase();

  const existing = await ctx.db.membership.findFirst({ where: { user: { email } }, select: { id: true } });
  if (existing) throw errors.conflict("That person is already on your team");

  const tenant = await ctx.db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { name: true } });
  const token = randomToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const invite = await ctx.db.$transaction(async (tx) => {
    await tx.invite.deleteMany({ where: { email, acceptedAt: null } });
    return tx.invite.create({
      data: { tenantId: ctx.tenantId, email, role: "STAFF", tokenHash: sha256(token), expiresAt },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    });
  });

  const link = `${env().APP_URL}/invite/${encodeURIComponent(token)}`;
  await sendEmail(
    email,
    `You've been invited to ${tenant.name}`,
    `You've been invited to help manage orders for ${tenant.name}.\n\nAccept the invite here (expires in 7 days):\n${link}`,
  );

  return NextResponse.json({ invite }, { status: 201 });
});

/** OWNER revokes a pending invite. */
export const DELETE = route(async (req) => {
  const ctx = await requireTenant({ role: "OWNER" });
  const { inviteId } = await parseJson(req, revokeSchema);
  const res = await ctx.db.invite.deleteMany({ where: { id: inviteId, acceptedAt: null } });
  if (res.count === 0) throw errors.notFound("Invite");
  return NextResponse.json({ ok: true });
});
