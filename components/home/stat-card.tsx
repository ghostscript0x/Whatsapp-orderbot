import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: string | number;
  icon: LucideIcon;
  hint?: string;
  href?: string;
  /** Draws attention (e.g. conversations waiting for a person). */
  attention?: boolean;
};

export function StatCard({ label, value, icon: Icon, hint, href, attention }: Props) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-lg",
            attention ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-primary-soft text-primary",
          )}
        >
          <Icon aria-hidden className="size-4" />
        </span>
      </div>
      <div className="mt-3 truncate text-2xl font-semibold tracking-tight tabular-nums sm:text-[1.75rem]">{value}</div>
      {hint && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
    </>
  );

  const base = cn(
    "block rounded-xl border bg-card p-4 text-card-foreground shadow-sm",
    attention && "border-amber-500/50 bg-amber-500/[0.06]",
  );

  if (!href) return <div className={base}>{body}</div>;
  return (
    <Link
      href={href}
      className={cn(
        base,
        "transition-[box-shadow,border-color] hover:border-muted-foreground/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {body}
    </Link>
  );
}
