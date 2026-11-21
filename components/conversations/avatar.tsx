import { cn } from "@/lib/utils";
import { initials } from "@/components/orders/format";

/** Initials avatar; `attention` adds an amber ring for chats waiting on a person. */
export function Avatar({ name, phone, attention, className }: { name: string | null; phone: string; attention?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary",
        attention && "ring-2 ring-amber-500 ring-offset-2 ring-offset-background",
        className,
      )}
    >
      {initials(name, phone)}
    </span>
  );
}
