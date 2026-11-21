import { NextResponse } from "next/server";
import { z } from "zod";
import { errors, parseJson, route } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/redis";
import { sha256 } from "@/lib/crypto";
import { hashPassword } from "@/lib/password";
import { clientIp } from "@/lib/tenants";

const schema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

const INVALID = "This reset link is invalid or has expired. Request a new one.";

export const POST = route(async (req) => {
  if (!(await rateLimit(`pwreset:${clientIp(req)}`, 20, 60 * 60))) throw errors.tooMany();
  const { token, password } = await parseJson(req, schema);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.usedAt || record.expiresAt <= new Date()) throw errors.badRequest(INVALID);

  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    // Claim the token atomically so two concurrent requests can't both use it.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw errors.badRequest(INVALID);
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    // Any other outstanding links for this user stop working too.
    await tx.passwordResetToken.updateMany({ where: { userId: record.userId, usedAt: null }, data: { usedAt: new Date() } });
  });
  return NextResponse.json({ ok: true });
});
