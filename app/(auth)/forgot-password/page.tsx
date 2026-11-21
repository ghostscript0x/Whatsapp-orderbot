"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, MailCheck } from "lucide-react";
import { apiFetch } from "@/lib/fetcher";
import { Input } from "@/components/ui/input";
import { Field, FormMessage, SubmitButton, fieldAria, useFieldErrors, validate } from "@/components/shell/form-bits";

export default function ForgotPasswordPage() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { errors, clear, check } = useFieldErrors<"email">();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formEl = e.currentTarget;
    const email = String(new FormData(formEl).get("email") ?? "");
    if (!check(formEl, { email: validate.email(email) })) return;
    setPending(true);
    try {
      await apiFetch("/api/password/forgot", { method: "POST", json: { email } });
      setSentTo(email);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      {sentTo ? (
        <div role="status">
          <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
            <MailCheck aria-hidden className="size-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            If an account exists for <span className="font-medium text-foreground">{sentTo}</span>, a reset link is on its way. It
            expires in 1 hour. Check your spam folder if you don&apos;t see it.
          </p>
        </div>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Forgot your password?</h1>
          <p className="mt-1 text-sm text-muted-foreground">Enter your account email and we&apos;ll send you a link to choose a new one.</p>
          <form onSubmit={onSubmit} noValidate className="mt-8 grid gap-5">
            {error ? <FormMessage tone="error">{error}</FormMessage> : null}
            <Field id="email" label="Email" error={errors.email}>
              <Input
                id="email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
                maxLength={254}
                onChange={() => clear("email")}
                {...fieldAria("email", errors.email)}
              />
            </Field>
            <SubmitButton pending={pending} pendingLabel="Sending…" size="lg">
              Send reset link
            </SubmitButton>
          </form>
        </>
      )}
      <p className="mt-8 text-center text-sm">
        <Link href="/login" className="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline">
          <ArrowLeft aria-hidden className="size-4" />
          Back to log in
        </Link>
      </p>
    </div>
  );
}
