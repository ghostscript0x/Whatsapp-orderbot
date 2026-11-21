import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { auth } from "@/auth";
import { ACTIVE_TENANT_COOKIE, errors, parseJson, route } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/redis";
import { sha256 } from "@/lib/crypto";
import { isUniqueViolation } from "@/lib/db-compat";
import { hashPassword } from "@/lib/password";
import { ACTIVE_TENANT_COOKIE_OPTIONS, addUserToTenant, clientIp } from "@/lib/tenants";

const schema = z.object({
  token: z.string().min(10).max(200),
  name: z.string().trim().min(1).max(100).optional(),
  password: z.string().min(8, "Password must be at least 8 characters").max(200).optional(),
});

const INVALID = "This invite link is invalid or has expired. Ask the owner to send a new one.";

/**
 * Accepts an invite. Two paths:
 * - signed in: the account's email must match the invited email;
 * - signed out: creates a new account (name + password required). If an account already
 *   exists for that email, the user must log in first (409, code "conflict").
 * Uses the raw client: there is no tenant context until the membership exists.
 */
export const POST = route(async (req) => {
  if (!(await rateLimit(`invite-accept:${clientIp(req)}`, 20, 60 * 60))) throw errors.tooMany();
  const input = await parseJson(req, schema);

  const invite = await prisma.invite.findUnique({
    where: { tokenHash: sha256(input.token) },
    include: { tenant: { select: { status: true } } },
  });
  if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) throw errors.badRequest(INVALID);
  if (invite.tenant.status === "SUSPENDED") throw errors.forbidden("This business is suspended");

  const sessionUserId = (await auth())?.user?.id;
  let newAccount: { name: string; passwordHash: string } | null = null;

  if (sessionUserId) {
    const me = await prisma.user.findUnique({ where: { id: sessionUserId }, select: { email: true } });
    if (!me) throw errors.unauthorized();
    if (me.email !== invite.email) {
      throw errors.forbidden(`This invite was sent to ${invite.email}. Log out and sign in with that email to accept it.`);
    }
  } else {
    const existing = await prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } });
    if (existing) throw errors.conflict("You already have an account. Log in to accept this invite.");
    if (!input.name || !input.password) throw errors.badRequest("Enter your name and a password to create your account");
    newAccount = { name: input.name, passwordHash: await hashPassword(input.password) };
  }

  const membership = await prisma
    .$transaction(async (tx) => {
      const claimed = await tx.invite.updateMany({
        where: { id: invite.id, acceptedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw errors.badRequest(INVALID);
      const userId = sessionUserId ?? (await tx.user.create({ data: { email: invite.email, ...newAccount! }, select: { id: true } })).id;
      return addUserToTenant({ userId, tenantId: invite.tenantId, role: invite.role }, tx);
    })
    .catch((err: unknown) => {
      // An account for this email was created between our check and the insert (e.g. a double submit).
      // The transaction rolled back, so the invite is still unclaimed and can be accepted after logging in.
      if (isUniqueViolation(err)) throw errors.conflict("You already have an account. Log in to accept this invite.");
      throw err;
    });

  (await cookies()).set(ACTIVE_TENANT_COOKIE, invite.tenantId, ACTIVE_TENANT_COOKIE_OPTIONS);
  return NextResponse.json({ tenantId: membership.tenantId, role: membership.role, email: invite.email, createdAccount: newAccount !== null });
});
