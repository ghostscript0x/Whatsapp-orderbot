import { PrismaClient } from "@prisma/client";

/**
 * RAW, UNSCOPED client. Only use in auth, webhook routing, admin and the tenant
 * extension itself. Everything tenant-facing must use `forTenant()` from lib/tenant.ts.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
