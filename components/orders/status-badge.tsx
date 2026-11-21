import type { OrderStatus } from "@prisma/client";
import { Badge } from "@/components/ui/misc";
import { STATUS_LABELS } from "@/lib/orders-rules";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<OrderStatus, string> = {
  NEW: "border-transparent bg-sky-500/15 text-sky-700 dark:text-sky-300",
  CONFIRMED: "border-transparent bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  OUT_FOR_DELIVERY: "border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300",
  DELIVERED: "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  CANCELLED: "border-transparent bg-muted text-muted-foreground line-through decoration-1",
};

export function StatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return <Badge className={cn(STATUS_STYLES[status], "whitespace-nowrap", className)}>{STATUS_LABELS[status]}</Badge>;
}
