import { Prisma, type Role, type TenantStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { errors } from "./api";
import { hashPassword } from "./password";
import { randomBytes } from "node:crypto";
import { slugify } from "./utils";

/**
 * Tenant lifecycle and membership helpers. These run BEFORE a tenant context exists
 * (sign-up, invite acceptance, tenant switching), so they use the raw client by design.
 */

const SLUG_ATTEMPTS = 4;

/** Digits only. Throws a 400 when the number is clearly not international format. */
export function normalizeWhatsappPhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("0")) throw errors.badRequest("Enter the WhatsApp number with its country code, e.g. 2348012345678");
  if (digits.length < 8 || digits.length > 15) throw errors.badRequest("Enter a valid WhatsApp number with country code");
  return digits;
}

function slugCandidate(businessName: string, attempt: number): string {
  const base = slugify(businessName) || "business";
  return attempt === 0 ? base : `${base.slice(0, 33)}-${randomBytes(3).toString("hex")}`;
}

function uniqueViolationTarget(err: unknown): string[] | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = (err.meta?.target ?? []) as string[] | string;
    return Array.isArray(target) ? target : [target];
  }
  return null;
}

async function createTenantRows(
  tx: Prisma.TransactionClient,
  userId: string,
  businessName: string,
  phoneDigits: string,
  slug: string,
) {
  const tenant = await tx.tenant.create({ data: { name: businessName, slug } });
  await tx.membership.create({ data: { userId, tenantId: tenant.id, role: "OWNER" } });
  await tx.botSettings.create({ data: { tenantId: tenant.id, ownerAlertPhone: phoneDigits } });
  return tenant;
}

/**
 * Runs `fn` with a fresh slug candidate, retrying on a slug collision. The first attempt
 * uses the plain slug; if it is taken (checked up front, and again by the unique index on
 * race), later attempts append a random suffix.
 */
async function withUniqueSlug<T>(businessName: string, fn: (slug: string) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
    const slug = slugCandidate(businessName, attempt);
    if (attempt === 0 && (await prisma.tenant.findUnique({ where: { slug }, select: { id: true } }))) continue;
    try {
      return await fn(slug);
    } catch (err) {
      const target = uniqueViolationTarget(err);
      if (target?.some((t) => t.includes("slug"))) continue;
      throw err;
    }
  }
  throw new Error(`Could not allocate a unique slug for "${businessName}"`);
}

export type CreateTenantWithOwnerInput = {
  ownerName: string;
  email: string;
  password: string;
  businessName: string;
  whatsappPhone: string;
};

/** Sign-up: User + Tenant + OWNER Membership + BotSettings in one transaction. */
export async function createTenantWithOwner(input: CreateTenantWithOwnerInput) {
  const email = input.email.trim().toLowerCase();
  const phone = normalizeWhatsappPhone(input.whatsappPhone);
  const businessName = input.businessName.trim();

  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    throw errors.conflict("An account with this email already exists. Log in instead.");
  }
  const passwordHash = await hashPassword(input.password);

  try {
    return await withUniqueSlug(businessName, (slug) =>
      prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { email, name: input.ownerName.trim(), passwordHash } });
        const tenant = await createTenantRows(tx, user.id, businessName, phone, slug);
        return { user: { id: user.id, email: user.email, name: user.name }, tenant };
      }),
    );
  } catch (err) {
    if (uniqueViolationTarget(err)?.some((t) => t.includes("email"))) {
      throw errors.conflict("An account with this email already exists. Log in instead.");
    }
    throw err;
  }
}

/** An already signed-in user creates another business they own. */
export async function createTenantForUser(userId: string, input: { businessName: string; whatsappPhone: string }) {
  const phone = normalizeWhatsappPhone(input.whatsappPhone);
  const businessName = input.businessName.trim();
  return withUniqueSlug(businessName, (slug) =>
    prisma.$transaction((tx) => createTenantRows(tx, userId, businessName, phone, slug)),
  );
}

/** Idempotent: adds the membership, or leaves an existing one (and its role) unchanged. */
export async function addUserToTenant(
  input: { userId: string; tenantId: string; role: Role },
  tx: Prisma.TransactionClient = prisma,
) {
  return tx.membership.upsert({
    where: { userId_tenantId: { userId: input.userId, tenantId: input.tenantId } },
    create: { userId: input.userId, tenantId: input.tenantId, role: input.role },
    update: {},
  });
}

export type MyTenant = { tenantId: string; name: string; slug: string; role: Role; status: TenantStatus };

/**
 * The user's memberships plus the active one. Mirrors `requireTenant()`: the cookie wins
 * when it names one of the user's tenants, otherwise the oldest membership.
 */
export async function getMyTenants(userId: string, activeCookie: string | undefined) {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: { tenant: { select: { name: true, slug: true, status: true } } },
    orderBy: { createdAt: "asc" },
  });
  const tenants: MyTenant[] = memberships.map((m) => ({
    tenantId: m.tenantId,
    name: m.tenant.name,
    slug: m.tenant.slug,
    role: m.role,
    status: m.tenant.status,
  }));
  const active = tenants.find((t) => t.tenantId === activeCookie) ?? tenants[0] ?? null;
  return { tenants, active };
}

export const ACTIVE_TENANT_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};

/** Client IP for rate limiting (first hop of x-forwarded-for, set by the reverse proxy). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;
