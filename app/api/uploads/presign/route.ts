import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, requireTenant, route } from "@/lib/api";
import { IMAGE_CONTENT_TYPES, MAX_UPLOAD_BYTES, presignUpload, type ImageContentType } from "@/lib/storage";

/**
 * POST { contentType: image/jpeg|image/png|image/webp, size: bytes (<= 5 MB) }
 *   -> { uploadUrl, storageKey, publicUrl } (owner)
 * The client PUTs the file to uploadUrl with the same Content-Type within 5 minutes,
 * then attaches storageKey to a product.
 */

const contentTypes = Object.keys(IMAGE_CONTENT_TYPES) as [ImageContentType, ...ImageContentType[]];

const schema = z.object({
  contentType: z.enum(contentTypes, { errorMap: () => ({ message: "Only JPEG, PNG or WebP images are allowed" }) }),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES, "Image must be 5 MB or smaller"),
});

export const POST = route(async (req: Request) => {
  const { tenantId } = await requireTenant({ role: "OWNER" });
  const { contentType, size } = await parseJson(req, schema);
  const result = await presignUpload({ tenantId, contentType, size });
  return NextResponse.json(result);
});
