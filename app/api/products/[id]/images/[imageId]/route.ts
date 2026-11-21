import { NextResponse } from "next/server";
import { errors, requireTenant, route } from "@/lib/api";
import { findProduct, productDtoInclude, toProductDto } from "@/lib/products";
import { deleteObject } from "@/lib/storage";

/**
 * DELETE -> { product } (owner). Removes the image and its stored object (external CSV image URLs
 * have no stored object). Remaining images are renumbered so the next one becomes the cover.
 */

type Params = { params: Promise<{ id: string; imageId: string }> };

export const DELETE = route(async (_req: Request, { params }: Params) => {
  const { id, imageId } = await params;
  const { db } = await requireTenant({ role: "OWNER" });
  const product = await findProduct(db, id);
  if (!product) throw errors.notFound("Product");
  const image = product.images.find((i) => i.id === imageId);
  if (!image) throw errors.notFound("Image");

  // Object first: if storage fails nothing changes and the request can be retried
  // (deleting an already-missing object succeeds).
  if (image.storageKey) await deleteObject(image.storageKey);

  const remaining = product.images.filter((i) => i.id !== imageId);
  await db.$transaction([
    db.productImage.deleteMany({ where: { id: imageId, productId: id } }),
    ...remaining.map((img, position) => db.productImage.updateMany({ where: { id: img.id, productId: id }, data: { position } })),
  ]);

  const updated = await db.product.findFirstOrThrow({ where: { id }, include: productDtoInclude });
  return NextResponse.json({ product: toProductDto(updated) });
});
