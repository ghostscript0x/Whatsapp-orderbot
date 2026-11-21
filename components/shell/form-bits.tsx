"use client";

import * as React from "react";
import { CheckCircle2, Eye, EyeOff, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/misc";
import { Input } from "@/components/ui/input";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/** Label + control + optional hint / inline error, used by the auth and team forms. */
export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="flex items-center gap-1.5 text-sm text-destructive">
          <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** aria props for an input inside <Field>, so the hint or error is read with it. */
export function fieldAria(id: string, error: string | null | undefined, hasHint = false) {
  return {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hasHint ? `${id}-hint` : undefined,
  } as const;
}

/** Inline form-level error/success message, announced to screen readers. */
export function FormMessage({ tone, children }: { tone: "error" | "success"; children: React.ReactNode }) {
  const Icon = tone === "error" ? TriangleAlert : CheckCircle2;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm",
        tone === "error" ? "bg-destructive/10 text-destructive" : "bg-primary-soft text-foreground",
      )}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", tone === "success" && "text-primary")} />
      <div>{children}</div>
    </div>
  );
}

/** Password input with a show/hide toggle. */
export const PasswordInput = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);
    return (
      <div className="relative">
        <Input ref={ref} type={visible ? "text" : "password"} className={cn("pr-12", className)} {...props} />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {visible ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";

/** Full-width submit button with a spinner while pending. */
export function SubmitButton({ pending, pendingLabel, children, className, ...props }: ButtonProps & { pending: boolean; pendingLabel: string }) {
  return (
    <Button type="submit" disabled={pending} className={cn("w-full", className)} {...props}>
      {pending && <Spinner />}
      {pending ? pendingLabel : children}
    </Button>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Small client-side checks shared by the auth forms. Server validation still applies. */
export const validate = {
  required: (v: string, label: string) => (v.trim() ? null : `Enter ${label}.`),
  email: (v: string) => (!v.trim() ? "Enter your email." : EMAIL_RE.test(v.trim()) ? null : "Enter a valid email, like name@example.com."),
  password: (v: string) => (v.length >= 8 ? null : "Use at least 8 characters."),
  // Mirrors normalizeWhatsappPhone in lib/tenants.ts.
  phone: (v: string) => {
    const digits = v.replace(/\D/g, "");
    if (!digits) return "Enter your WhatsApp number.";
    if (digits.startsWith("0")) return "Start with the country code instead of 0, e.g. 2348012345678.";
    return digits.length >= 8 && digits.length <= 15 ? null : "Enter a valid WhatsApp number with country code.";
  },
};

/** Tracks per-field errors; clears a field's error as soon as the user edits it. */
export function useFieldErrors<K extends string>() {
  const [errors, setErrors] = React.useState<Partial<Record<K, string>>>({});
  const clear = React.useCallback((key: K) => setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e)), []);
  /** Returns true when there are no errors. Focuses the first invalid field. */
  const check = React.useCallback((form: HTMLFormElement, next: Partial<Record<K, string | null>>) => {
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v)) as Partial<Record<K, string>>;
    setErrors(clean);
    const first = Object.keys(clean)[0];
    if (first) (form.elements.namedItem(first) as HTMLElement | null)?.focus();
    return !first;
  }, []);
  return { errors, clear, check };
}
