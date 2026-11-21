import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** The OrderBot logo tile. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm", className)}>
      <MessageCircle className="size-[55%]" aria-hidden strokeWidth={2.25} />
    </span>
  );
}
