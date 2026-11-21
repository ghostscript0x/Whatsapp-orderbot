import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ZodError, type z, type ZodTypeAny } from "zod";
import { Prisma, type Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "./prisma";
import { forTenant, type TenantDb } from "./tenant";
import { logger } from "./logger";

export const ACTIVE_TENANT_COOKIE = "active_tenant";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const errors = {
  unauthorized: () => new ApiError(401, "unauthorized", "Sign in required"),
  forbidden: (msg = "You don't have permission to do that") => new ApiError(403, "forbidden", msg),
  notFound: (what = "Resource") => new ApiError(404, "not_found", `${what} not found`),
  badRequest: (msg: string) => new ApiError(400, "bad_request", msg),
  conflict: (msg: string) => new ApiError(409, "conflict", msg),
  tooMany: () => new ApiError(429, "rate_limited", "Too many requests"),
};

export function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * Prisma errors that mean "the request lost a race or referenced something that is gone",
 * not a server bug: a row deleted between our check and the write (P2025), or a unique
 * constraint hit by a concurrent insert (P2002). Routes handle the expected cases themselves;
 * this is the safety net so those races answer 404/409 instead of 500.
 */
function prismaToApiError(err: unknown): ApiError | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return null;
  if (err.code === "P2025") return errors.notFound();
  if (err.code === "P2002") return errors.conflict("That already exists");
  return null;
}

/**
 * Wraps a route handler: converts ApiError / ZodError / race-type Prisma errors into the
 * standard `{ error: { code, message } }` shape and logs unexpected errors.
 */
export function route<Ctx>(handler: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) return jsonError(err.status, err.code, err.message);
      if (err instanceof ZodError) {
        return jsonError(400, "validation_error", err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
      }
      const mapped = prismaToApiError(err);
      if (mapped) {
        logger.warn({ err, url: req.url, method: req.method }, "route hit a database race");
        return jsonError(mapped.status, mapped.code, mapped.message);
      }
      logger.error({ err, url: req.url, method: req.method }, "unhandled route error");
      return jsonError(500, "internal_error", "Something went wrong");
    }
  };
}

export async function parseJson<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw errors.badRequest("Body must be valid JSON");
  }
  return schema.parse(body);
}

export function parseQuery<S extends ZodTypeAny>(req: Request, schema: S): z.infer<S> {
  return schema.parse(Object.fromEntries(new URL(req.url).searchParams));
}

export type TenantContext = {
  userId: string;
  tenantId: string;
  role: Role;
  db: TenantDb;
};

/**
 * Resolves the signed-in user and their ACTIVE tenant (from the active_tenant cookie,
 * falling back to their first membership). tenantId never comes from the request body.
 * Throws 401 if not signed in, 403 if the user has no membership or the tenant is suspended.
 */
export async function requireTenant(opts: { role?: Role } = {}): Promise<TenantContext> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw errors.unauthorized();

  const wanted = (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value;
  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: { tenant: { select: { status: true } } },
    orderBy: { createdAt: "asc" },
  });
  const membership = memberships.find((m) => m.tenantId === wanted) ?? memberships[0];
  if (!membership) throw errors.forbidden("You are not a member of any business");
  if (membership.tenant.status === "SUSPENDED") throw errors.forbidden("This business is suspended");
  if (opts.role === "OWNER" && membership.role !== "OWNER") throw errors.forbidden("Only the owner can do that");

  return { userId, tenantId: membership.tenantId, role: membership.role, db: forTenant(membership.tenantId) };
}

/** Requires a signed-in platform admin. Uses the raw client by design. */
export async function requirePlatformAdmin(): Promise<{ userId: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw errors.unauthorized();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isPlatformAdmin: true } });
  if (!user?.isPlatformAdmin) throw errors.forbidden();
  return { userId };
}
