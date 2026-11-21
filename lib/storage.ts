import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, requireEnv } from "./env";

/** Image types accepted for product uploads, mapped to the file extension used in the key. */
export const IMAGE_CONTENT_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;
export type ImageContentType = keyof typeof IMAGE_CONTENT_TYPES;

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const PRESIGN_EXPIRES_S = 5 * 60;

let client: S3Client | undefined;

function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: requireEnv("S3_ENDPOINT"),
      region: env().S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: requireEnv("S3_ACCESS_KEY"), secretAccessKey: requireEnv("S3_SECRET_KEY") },
      // The SDK otherwise bakes a CRC32 of the (empty) body into presigned PUT URLs, which
      // S3-compatible servers (Garage, R2, MinIO) reject with InvalidDigest when the browser uploads the file.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return client;
}

export function isImageContentType(value: string): value is ImageContentType {
  return Object.prototype.hasOwnProperty.call(IMAGE_CONTENT_TYPES, value);
}

/** Prefix every object of a tenant lives under. Used to stop a tenant attaching another tenant's object. */
export function tenantKeyPrefix(tenantId: string): string {
  return `t/${tenantId}/`;
}

const PRODUCT_KEY_RE = /^t\/([^/]+)\/products\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

/** True only for keys this module generates for `tenantId` (exact shape, no traversal). */
export function isTenantProductKey(tenantId: string, storageKey: string): boolean {
  const m = PRODUCT_KEY_RE.exec(storageKey);
  return !!m && m[1] === tenantId && storageKey.startsWith(tenantKeyPrefix(tenantId));
}

/**
 * Presigned PUT (5 min). Content-Type and Content-Length are signed, so the browser must
 * upload exactly the declared type and size; that is what enforces the 5 MB limit.
 */
export async function presignUpload(opts: {
  tenantId: string;
  contentType: string;
  size: number;
}): Promise<{ uploadUrl: string; storageKey: string; publicUrl: string }> {
  const { tenantId, contentType, size } = opts;
  if (!tenantId) throw new Error("presignUpload requires a tenantId");
  if (!isImageContentType(contentType)) throw new Error(`Unsupported content type ${contentType}`);
  if (!Number.isInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) throw new Error(`Invalid upload size ${size}`);

  const storageKey = `${tenantKeyPrefix(tenantId)}products/${randomUUID()}.${IMAGE_CONTENT_TYPES[contentType]}`;
  const command = new PutObjectCommand({
    Bucket: env().S3_BUCKET,
    Key: storageKey,
    ContentType: contentType,
    ContentLength: size,
  });
  const uploadUrl = await getSignedUrl(s3(), command, {
    expiresIn: PRESIGN_EXPIRES_S,
    signableHeaders: new Set(["content-type", "content-length"]),
  });
  return { uploadUrl, storageKey, publicUrl: publicUrlFor(storageKey) };
}

/** Storage answered with something other than "exists" / "not found" (after a retry). */
export class StorageUnavailableError extends Error {
  constructor(public status: number | undefined) {
    super(`Storage check failed${status ? ` (HTTP ${status})` : ""}`);
  }
}

const HEAD_RETRY_DELAY_MS = 750;

/**
 * True if the object exists in the bucket (used to confirm an upload finished before attaching it).
 * Retries once on unexpected errors: some S3-compatible servers (e.g. a multi-node Garage cluster
 * right after a permission change) briefly answer 403 for an object that is there.
 */
export async function objectExists(storageKey: string): Promise<boolean> {
  let lastStatus: number | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, HEAD_RETRY_DELAY_MS));
    try {
      await s3().send(new HeadObjectCommand({ Bucket: env().S3_BUCKET, Key: storageKey }));
      return true;
    } catch (err) {
      lastStatus = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (lastStatus === 404) return false;
    }
  }
  throw new StorageUnavailableError(lastStatus);
}

/** Deletes an object. S3 treats deleting a missing key as success, so this is safe to retry. */
export async function deleteObject(storageKey: string): Promise<void> {
  if (!storageKey) throw new Error("deleteObject requires a storageKey");
  await s3().send(new DeleteObjectCommand({ Bucket: env().S3_BUCKET, Key: storageKey }));
}

export function publicUrlFor(storageKey: string): string {
  return `${requireEnv("S3_PUBLIC_URL").replace(/\/+$/, "")}/${storageKey}`;
}
