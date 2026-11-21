import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { ApiError, requirePlatformAdmin, requireTenant, type TenantContext } from "@/lib/api";

export type PageAuth<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Page-friendly wrappers around requireTenant/requirePlatformAdmin: 401 redirects to /login,
 * 403 comes back as a message for the page to render. Anything else is rethrown.
 * redirect() is called outside the try because it works by throwing.
 */
async function guard<T>(fn: () => Promise<T>, callbackUrl: string): Promise<PageAuth<T>> {
  let failure: ApiError;
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    failure = err;
  }
  if (failure.status === 401) redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  return { ok: false, message: failure.message };
}

export function tenantForPage(callbackUrl: string, opts: { role?: Role } = {}): Promise<PageAuth<TenantContext>> {
  return guard(() => requireTenant(opts), callbackUrl);
}

export function platformAdminForPage(callbackUrl: string): Promise<PageAuth<{ userId: string }>> {
  return guard(() => requirePlatformAdmin(), callbackUrl);
}
