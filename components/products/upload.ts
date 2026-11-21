import { apiFetch } from "@/lib/fetcher";

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Client-side check so the user hears about a bad file before any network call. */
export function imageFileError(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return `${file.name}: only JPEG, PNG or WebP images are allowed`;
  if (file.size > MAX_IMAGE_BYTES) return `${file.name}: image must be 5 MB or smaller`;
  return null;
}

/** Presign, then PUT the file straight to storage. Returns the key to attach to a product. */
export async function uploadImage(file: File): Promise<{ storageKey: string; publicUrl: string }> {
  const { uploadUrl, storageKey, publicUrl } = await apiFetch<{ uploadUrl: string; storageKey: string; publicUrl: string }>(
    "/api/uploads/presign",
    { method: "POST", json: { contentType: file.type, size: file.size } },
  );
  const res = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "content-type": file.type } });
  if (!res.ok) throw new Error(`Upload of ${file.name} failed (${res.status})`);
  return { storageKey, publicUrl };
}
