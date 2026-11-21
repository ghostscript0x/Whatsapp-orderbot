import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { parseJson, parseQuery, requireTenant, route } from "@/lib/api";
import { getTenantCurrency, MAX_PRODUCT_IMAGES, productDtoInclude, toProductDto } from "@/lib/products";
import { assertCategory, productFields, storageKeySchema, validateUploadedKeys } from "./_lib";
import { insensitive } from "@/lib/db-compat";

/**
 * GET  ?q=&categoryId=&includeUnavailable=true|false (default false)
 *      -> { products: ProductDto[], canEdit, currency }. Soft-deleted products are never returned.
 *      categoryId=none returns uncategorised products.
 * POST { name, description?, priceKobo, categoryId?, available?, sortOrder?, imageKeys? } -> { product } (owner)
 *      imageKeys are storage keys from /api/uploads/presign, in display order (first = cover).
 */

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: z.string().min(1).optional(),
  includeUnavailable: z.enum(["true", "false"]).optional(),
});

const createSchema = z.object({
  name: productFields.name,
  description: productFields.description.default(""),
  priceKobo: productFields.priceKobo,
  categoryId: productFields.categoryId.optional(),
  available: productFields.available.default(true),
  sortOrder: productFields.sortOrder.optional(),
  imageKeys: z.array(storageKeySchema).max(MAX_PRODUCT_IMAGES).default([]),
});

export const GET = route(async (req: Request) => {
  const { db, tenantId, role } = await requireTenant();
  const query = parseQuery(req, listQuery);

  const where: Prisma.ProductWhereInput = { deletedAt: null };
  if (query.includeUnavailable !== "true") where.available = true;
  if (query.categoryId) where.categoryId = query.categoryId === "none" ? null : query.categoryId;
  if (query.q) {
    where.OR = [
      { name: { contains: query.q, ...insensitive() } },
      { description: { contains: query.q, ...insensitive() } },
    ];
  }

  const [rows, currency] = await Promise.all([
    db.product.findMany({
      where,
      include: productDtoInclude,
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
    }),
    getTenantCurrency(db, tenantId),
  ]);
  return NextResponse.json({ products: rows.map(toProductDto), canEdit: role === "OWNER", currency });
});

export const POST = route(async (req: Request) => {
  const { db, tenantId } = await requireTenant({ role: "OWNER" });
  const input = await parseJson(req, createSchema);
  await assertCategory(db, input.categoryId);
  const images = await validateUploadedKeys(tenantId, input.imageKeys ?? []);

  let sortOrder = input.sortOrder;
  if (sortOrder === undefined) {
    const max = await db.product.aggregate({ where: { deletedAt: null }, _max: { sortOrder: true } });
    sortOrder = (max._max.sortOrder ?? -1) + 1;
  }

  const product = await db.product.create({
    data: {
      tenantId,
      name: input.name,
      description: input.description,
      priceKobo: input.priceKobo,
      categoryId: input.categoryId ?? null,
      available: input.available,
      sortOrder,
      // Nested creates are not auto-scoped: tenantId is set explicitly.
      images: { create: images.map((img, position) => ({ tenantId, ...img, position })) },
    },
    include: productDtoInclude,
  });
  return NextResponse.json({ product: toProductDto(product) }, { status: 201 });
});
