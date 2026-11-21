import { NextResponse } from "next/server";
import { z } from "zod";
import { errors, parseJson, route } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/redis";
import { randomToken, sha256 } from "@/lib/crypto";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { RESET_TTL_MS, clientIp } from "@/lib/tenants";

const schema = z.object({ email: z.string().trim().email().max(254) });

/**
 * Always answers 200 with the same body so the endpoint can't be used to discover which
 * emails have accounts. Email delivery failures are logged (not returned) for the same reason.
 */
export const POST = route(async (req) => {
  if (!(await rateLimit(`pwforgot:ip:${clientIp(req)}`, 10, 60 * 60))) throw errors.tooMany();
  const email = (await parseJson(req, schema)).email.toLowerCase();
  const ok = () => NextResponse.json({ ok: true });
  if (!(await rateLimit(`pwforgot:email:${email}`, 3, 60 * 60))) return ok();

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return ok();

  const token = randomToken();
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
  });
  const link = `${env().APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  try {
    await sendEmail(
      email,
      "Reset your password",
      `Someone asked to reset the password for your account.\n\nReset it here (the link works once and expires in 1 hour):\n${link}\n\nIf this wasn't you, ignore this email. Your password stays the same.`,
    );
  } catch (err) {
    logger.error({ err, userId: user.id }, "password reset email failed");
  }
  return ok();
});
