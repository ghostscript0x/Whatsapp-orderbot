import { Prisma } from "@prisma/client";
import type { TenantDb } from "./tenant";
import { MAX_PRODUCT_IMAGES } from "./products-csv";
import { insensitive } from "@/lib/db-compat";

export { MAX_PRODUCT_IMAGES };

/** Shape the bot/agent sees. Contract: docs/CONTRACTS.md. */
export type BotProduct = {
  id: string;
  name: string;
  priceKobo: number;
  description: string;
  category: string | null;
  coverImageUrl: string | null;
};

const DEFAULT_BOT_LIMIT = 30;
const MAX_BOT_LIMIT = 100;

const botSelect = {
  id: true,
  name: true,
  priceKobo: true,
  description: true,
  category: { select: { name: true } },
  images: { select: { url: true }, orderBy: { position: "asc" }, take: 1 },
} satisfies Prisma.ProductSelect;

type BotRow = Prisma.ProductGetPayload<{ select: typeof botSelect }>;

function toBotProduct(p: BotRow): BotProduct {
  return {
    id: p.id,
    name: p.name,
    priceKobo: p.priceKobo,
    description: p.description,
    category: p.category?.name ?? null,
    coverImageUrl: p.images[0]?.url ?? null,
  };
}

/** Available, non-deleted products ordered by category sortOrder then product sortOrder. */
export async function listAvailableProducts(
  db: TenantDb,
  opts: { query?: string; category?: string; limit?: number } = {},
): Promise<BotProduct[]> {
  const query = opts.query?.trim();
  const category = opts.category?.trim();
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? DEFAULT_BOT_LIMIT), 1), MAX_BOT_LIMIT);

  const where: Prisma.ProductWhereInput = { available: true, deletedAt: null };
  if (query) {
    where.OR = [
      { name: { contains: query, ...insensitive() } },
      { description: { contains: query, ...insensitive() } },
    ];
  }
  if (category) where.category = { name: { contains: category, ...insensitive() } };

  const rows = await db.product.findMany({
    where,
    select: botSelect,
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
    take: limit,
  });
  return rows.map(toBotProduct);
}

/** Available, non-deleted products among `ids`, returned in the order of `ids` (unknown ids dropped). */
export async function getAvailableProductsByIds(db: TenantDb, ids: string[]): Promise<BotProduct[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];
  const rows = await db.product.findMany({
    where: { id: { in: unique }, available: true, deletedAt: null },
    select: botSelect,
  });
  const byId = new Map(rows.map((r) => [r.id, toBotProduct(r)]));
  return unique.flatMap((id) => byId.get(id) ?? []);
}

// ---------------------------------------------------------------------------
// Dashboard DTOs (JSON returned by /api/products and /api/categories)
// ---------------------------------------------------------------------------

export type ProductImageDto = { id: string; url: string; position: number; external: boolean };

export type ProductDto = {
  id: string;
  name: string;
  description: string;
  priceKobo: number;
  available: boolean;
  sortOrder: number;
  categoryId: string | null;
  categoryName: string | null;
  images: ProductImageDto[];
  createdAt: string;
  updatedAt: string;
};

export type CategoryDto = { id: string; name: string; sortOrder: number; productCount: number };

export const productDtoInclude = {
  category: { select: { name: true } },
  images: { orderBy: { position: "asc" } },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof productDtoInclude }>;

export function toProductDto(p: ProductRow): ProductDto {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    priceKobo: p.priceKobo,
    available: p.available,
    sortOrder: p.sortOrder,
    categoryId: p.categoryId,
    categoryName: p.category?.name ?? null,
    images: p.images.map((i) => ({ id: i.id, url: i.url, position: i.position, external: i.storageKey === "" })),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** Loads a non-deleted product of this tenant with images, or null. */
export async function findProduct(db: TenantDb, id: string) {
  return db.product.findFirst({ where: { id, deletedAt: null }, include: productDtoInclude });
}

export function isPrismaError(err: unknown, code: "P2002" | "P2025" | "P2003"): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;
}

export async function getTenantCurrency(db: TenantDb, tenantId: string): Promise<string> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } });
  if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
  return tenant.currency;
}
