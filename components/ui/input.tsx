import * as React from "react";
import { cn } from "@/lib/utils";

/** Shared field look: 44px tall on phones, 16px text there (prevents iOS zoom), clear focus + invalid states. */
const fieldBase =
  "w-full rounded-lg border border-input bg-card px-3 text-base shadow-sm transition-[border-color,box-shadow] md:text-sm " +
  "placeholder:text-muted-foreground/80 hover:border-muted-foreground/40 " +
  "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/25 " +
  "aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/25 " +
  "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      fieldBase,
      "flex h-11 py-2 md:h-10 file:border-0 file:bg-transparent file:text-sm file:font-medium",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea className={cn(fieldBase, "flex min-h-24 py-2.5 leading-relaxed", className)} ref={ref} {...props} />
));
Textarea.displayName = "Textarea";

export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select
    className={cn(
      fieldBase,
      "flex h-11 py-2 md:h-10",
      className,
    )}
    ref={ref}
    {...props}
  />
));
NativeSelect.displayName = "NativeSelect";
