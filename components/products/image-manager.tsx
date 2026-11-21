"use client";

import * as React from "react";
import { ImagePlus, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/components/orders/format";
import { ACCEPTED_IMAGE_TYPES, imageFileError } from "./upload";

export type ImageItem = { id: string; url: string };

/**
 * Image grid + uploader. The parent decides what upload/delete/cover mean
 * (attach to a saved product, or hold keys for a product that is not saved yet).
 */
export function ImageManager({
  items,
  max,
  disabled,
  onUpload,
  onDelete,
  onMakeCover,
}: {
  items: ImageItem[];
  max: number;
  disabled?: boolean;
  onUpload: (file: File) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onMakeCover: (id: string) => Promise<void>;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState<{ done: number; total: number } | null>(null);
  const [coverBusy, setCoverBusy] = React.useState<string | null>(null);
  const remaining = max - items.length;
  const busy = uploading !== null || coverBusy !== null;

  async function onFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (files.length === 0) return;
    if (files.length > remaining) {
      toast.error(`You can add ${remaining} more photo${remaining === 1 ? "" : "s"} (max ${max}).`);
      return;
    }
    const invalid = files.map(imageFileError).find(Boolean);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    setUploading({ done: 0, total: files.length });
    try {
      for (const [i, file] of files.entries()) {
        await onUpload(file);
        setUploading({ done: i + 1, total: files.length });
      }
      toast.success(files.length === 1 ? "Photo added" : `${files.length} photos added`);
    } catch (err) {
      toast.error(errorMessage(err, "Upload failed"));
    } finally {
      setUploading(null);
    }
  }

  async function makeCover(id: string) {
    setCoverBusy(id);
    try {
      await onMakeCover(id);
      toast.success("Cover photo updated");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't change the cover"));
    } finally {
      setCoverBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Product photos">
        {items.map((img, i) => (
          <li key={img.id} className={cn("overflow-hidden rounded-xl border bg-card", i === 0 && "ring-2 ring-primary ring-offset-2 ring-offset-background")}>
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- images live on tenant storage/external hosts */}
              <img src={img.url} alt={i === 0 ? "Cover photo" : `Photo ${i + 1}`} width={240} height={240} className="aspect-square w-full bg-muted object-cover" />
              {i === 0 && (
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground shadow">
                  <Star className="size-3 fill-current" aria-hidden /> Cover
                </span>
              )}
            </div>
            {!disabled && (
              <div className="flex border-t">
                {i > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 flex-1 rounded-none text-xs"
                    disabled={busy}
                    aria-label={`Make photo ${i + 1} the cover`}
                    onClick={() => void makeCover(img.id)}
                  >
                    {coverBusy === img.id ? <Spinner /> : <Star aria-hidden />}
                    Set cover
                  </Button>
                ) : (
                  <span className="flex h-11 flex-1 items-center justify-center text-xs text-muted-foreground">Sent to customers</span>
                )}
                <ConfirmButton
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 rounded-none border-l text-destructive hover:text-destructive"
                  disabled={busy}
                  aria-label={`Delete photo ${i + 1}`}
                  title="Delete this photo?"
                  description={i === 0 && items.length > 1 ? "The next photo becomes the cover." : "You can upload it again later."}
                  confirmLabel="Delete photo"
                  destructive
                  onConfirm={async () => {
                    await onDelete(img.id);
                    toast.success("Photo deleted");
                  }}
                >
                  <Trash2 aria-hidden />
                </ConfirmButton>
              </div>
            )}
          </li>
        ))}
        {!disabled && remaining > 0 && (
          <li>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              {uploading ? (
                <>
                  <Spinner className="size-6" label="Uploading" />
                  <span>
                    Uploading {Math.min(uploading.done + 1, uploading.total)} of {uploading.total}…
                  </span>
                </>
              ) : (
                <>
                  <ImagePlus className="size-7" aria-hidden />
                  <span className="font-medium">{items.length === 0 ? "Add photos" : "Add photo"}</span>
                  <span className="text-xs">{remaining} left</span>
                </>
              )}
            </button>
          </li>
        )}
      </ul>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => void onFiles(e.target.files)}
      />
      <p className="text-xs text-muted-foreground">Up to {max} photos · JPEG, PNG or WebP · 5 MB each. The cover is the photo the bot sends to customers.</p>
    </div>
  );
}
