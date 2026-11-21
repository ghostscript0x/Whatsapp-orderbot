import { NextResponse } from "next/server";
import { z } from "zod";
import { errors, parseJson, requireTenant, route } from "@/lib/api";
import { findProduct, MAX_PRODUCT_IMAGES, productDtoInclude, toProductDto } from "@/lib/products";
import { assertImageCapacity, storageKeySchema, validateUploadedKeys } from "../../_lib";

/**
 * POST  { storageKey } -> { product } (owner). Attaches an uploaded image as the last image.
 * PATCH { imageIds: string[] } -> { product } (owner). New order; must list every image exactly once.
 *       The first image is the cover.
 */

type Params = { params: Promise<{ id: string }> };

const attachSchema = z.object({ storageKey: storageKeySchema });
const reorderSchema = z.object({ imageIds: z.array(z.string().min(1)).min(1).max(MAX_PRODUCT_IMAGES) });

export const POST = route(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const { db, tenantId } = await requireTenant({ role: "OWNER" });
  const { storageKey } = await parseJson(req, attachSchema);
  const product = await findProduct(db, id);
  if (!product) throw errors.notFound("Product");
  assertImageCapacity(product.images.length, 1);
  if (product.images.some((i) => i.storageKey === storageKey)) throw errors.conflict("Image is already attached");
  const [image] = await validateUploadedKeys(tenantId, [storageKey]);

  const position = product.images.reduce((max, i) => Math.max(max, i.position + 1), 0);
  await db.productImage.create({ data: { tenantId, productId: id, ...image, position } });

  const updated = await db.product.findFirstOrThrow({ where: { id }, include: productDtoInclude });
  return NextResponse.json({ product: toProductDto(updated) }, { status: 201 });
});

export const PATCH = route(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const { db } = await requireTenant({ role: "OWNER" });
  const { imageIds } = await parseJson(req, reorderSchema);
  const product = await findProduct(db, id);
  if (!product) throw errors.notFound("Product");

  const current = new Set(product.images.map((i) => i.id));
  if (imageIds.length !== current.size || new Set(imageIds).size !== imageIds.length || imageIds.some((i) => !current.has(i))) {
    throw errors.badRequest("imageIds must list each of the product's images exactly once");
  }

  await db.$transaction(
    imageIds.map((imageId, position) => db.productImage.updateMany({ where: { id: imageId, productId: id }, data: { position } })),
  );
  const updated = await db.product.findFirstOrThrow({ where: { id }, include: productDtoInclude });
  return NextResponse.json({ product: toProductDto(updated) });
});
