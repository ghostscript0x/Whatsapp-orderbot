"use client";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * Floating save bar shown while there are unsaved changes (or a save just failed).
 * Sits above the mobile bottom tab bar.
 */
export function SaveBar({
  visible,
  saving,
  error,
  onDiscard,
}: {
  visible: boolean;
  saving: boolean;
  error: string | null;
  onDiscard: () => void;
}) {
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 transition-all duration-200 md:bottom-4",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
      )}
    >
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card/95 p-3 pl-4 shadow-lg backdrop-blur">
        <p aria-live="polite" className="mr-auto min-w-0 text-sm">
          {error ? <span className="text-destructive">{error}</span> : <span className="font-medium">You have unsaved changes</span>}
        </p>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button type="button" variant="ghost" onClick={onDiscard} disabled={saving} tabIndex={visible ? 0 : -1} className="flex-1 sm:flex-none">
            Discard
          </Button>
          <Button type="submit" disabled={saving} tabIndex={visible ? 0 : -1} className="flex-1 sm:flex-none">
            {saving && <Spinner />}
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
