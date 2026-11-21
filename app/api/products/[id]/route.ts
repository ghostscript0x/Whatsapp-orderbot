import { NextResponse } from "next/server";
import { z } from "zod";
import { errors, parseJson, requireTenant, route } from "@/lib/api";
import { findProduct, getTenantCurrency, productDtoInclude, toProductDto } from "@/lib/products";
import { assertCategory, productFields } from "../_lib";

/**
 * GET    -> { product: ProductDto, canEdit, currency }
 * PATCH  { name?, description?, priceKobo?, categoryId?, available?, sortOrder? } -> { product } (owner)
 * DELETE -> { ok: true } (owner). Soft delete: sets deletedAt; past orders keep referencing the product.
 * Images are managed under ./images.
 */

type Params = { params: Promise<{ id: string }> };

const updateSchema = z
  .object({
    name: productFields.name,
    description: productFields.description,
    priceKobo: productFields.priceKobo,
    categoryId: productFields.categoryId,
    available: productFields.available,
    sortOrder: productFields.sortOrder,
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update");

export const GET = route(async (_req: Request, { params }: Params) => {
  const { id } = await params;
  const { db, tenantId, role } = await requireTenant();
  const [product, currency] = await Promise.all([findProduct(db, id), getTenantCurrency(db, tenantId)]);
  if (!product) throw errors.notFound("Product");
  return NextResponse.json({ product: toProductDto(product), canEdit: role === "OWNER", currency });
});

export const PATCH = route(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const { db } = await requireTenant({ role: "OWNER" });
  const input = await parseJson(req, updateSchema);
  if (!(await findProduct(db, id))) throw errors.notFound("Product");
  await assertCategory(db, input.categoryId);

  const product = await db.product.update({ where: { id }, data: input, include: productDtoInclude });
  return NextResponse.json({ product: toProductDto(product) });
});

export const DELETE = route(async (_req: Request, { params }: Params) => {
  const { id } = await params;
  const { db } = await requireTenant({ role: "OWNER" });
  const { count } = await db.product.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), available: false } });
  if (count === 0) throw errors.notFound("Product");
  return NextResponse.json({ ok: true });
});
