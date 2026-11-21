import { z } from "zod";
import { ApiError, errors } from "@/lib/api";
import { logger } from "@/lib/logger";
import { PRODUCT_LIMITS } from "@/lib/products-csv";
import { MAX_PRODUCT_IMAGES } from "@/lib/products";
import { isTenantProductKey, objectExists, publicUrlFor, StorageUnavailableError } from "@/lib/storage";
import type { TenantDb } from "@/lib/tenant";

/** Shared by the products routes (not a route itself). */

export const productFields = {
  name: z.string().trim().min(1, "Name is required").max(PRODUCT_LIMITS.nameMax),
  description: z.string().trim().max(PRODUCT_LIMITS.descriptionMax),
  priceKobo: z.number().int("Price must be in kobo (integer)").min(1, "Price must be greater than 0").max(PRODUCT_LIMITS.priceKoboMax),
  categoryId: z.string().min(1).nullable(),
  available: z.boolean(),
  sortOrder: z.number().int().min(-100000).max(100000),
};

export const storageKeySchema = z.string().min(1).max(300);

/** 404s unless the category belongs to this tenant (db is tenant-scoped). */
export async function assertCategory(db: TenantDb, categoryId: string | null | undefined): Promise<void> {
  if (!categoryId) return;
  const found = await db.category.findFirst({ where: { id: categoryId }, select: { id: true } });
  if (!found) throw errors.badRequest("Category not found");
}

/**
 * Validates uploaded keys before they are attached to a product: the key must be one we
 * presigned for THIS tenant (so nobody can attach another tenant's object) and the upload must exist.
 */
export async function validateUploadedKeys(tenantId: string, keys: string[]): Promise<{ storageKey: string; url: string }[]> {
  if (new Set(keys).size !== keys.length) throw errors.badRequest("Duplicate image");
  for (const key of keys) {
    if (!isTenantProductKey(tenantId, key)) throw errors.badRequest("Invalid image key");
  }
  let exists: boolean[];
  try {
    exists = await Promise.all(keys.map((k) => objectExists(k)));
  } catch (err) {
    if (err instanceof StorageUnavailableError) {
      logger.warn({ tenantId, status: err.status }, "storage HEAD failed while attaching product images");
      throw new ApiError(502, "storage_unavailable", "Couldn't confirm the image with storage. Please try again.");
    }
    throw err;
  }
  if (exists.some((e) => !e)) throw errors.badRequest("Image upload not found. Upload it again.");
  return keys.map((storageKey) => ({ storageKey, url: publicUrlFor(storageKey) }));
}

export function assertImageCapacity(current: number, adding: number): void {
  if (current + adding > MAX_PRODUCT_IMAGES) throw errors.badRequest(`A product can have at most ${MAX_PRODUCT_IMAGES} images`);
}
