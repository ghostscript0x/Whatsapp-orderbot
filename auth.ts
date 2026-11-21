import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { prisma } from "./lib/prisma";
import { verifyPassword } from "./lib/password";
import { rateLimit } from "./lib/redis";

const credentialsSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        // Brute-force guard: 10 attempts per email per 15 minutes.
        if (!(await rateLimit(`login:${parsed.data.email.toLowerCase()}`, 10, 900))) return null;
        const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
        if (!user) return null;
        if (!(await verifyPassword(user.passwordHash, parsed.data.password))) return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
});
