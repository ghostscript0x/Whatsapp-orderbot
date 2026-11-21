"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/fetcher";
import { Field, FormMessage, PasswordInput, SubmitButton, fieldAria, useFieldErrors, validate } from "@/components/shell/form-bits";

export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { errors, clear, check } = useFieldErrors<"password" | "confirm">();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    const ok = check(formEl, {
      password: validate.password(password),
      confirm: password === confirm ? null : "The two passwords don't match.",
    });
    if (!ok) return;
    setPending(true);
    try {
      await apiFetch("/api/password/reset", { method: "POST", json: { token, password } });
      router.replace("/login?reset=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {error ? (
        <FormMessage tone="error">
          {error}{" "}
          <Link href="/forgot-password" className="font-medium underline underline-offset-4">
            Request a new link
          </Link>
        </FormMessage>
      ) : null}
      <Field id="password" label="New password" hint="At least 8 characters." error={errors.password}>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={200}
          onChange={() => clear("password")}
          {...fieldAria("password", errors.password, true)}
        />
      </Field>
      <Field id="confirm" label="Type it again" error={errors.confirm}>
        <PasswordInput
          id="confirm"
          name="confirm"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={200}
          onChange={() => clear("confirm")}
          {...fieldAria("confirm", errors.confirm)}
        />
      </Field>
      <SubmitButton pending={pending} pendingLabel="Saving…" size="lg">
        Save new password
      </SubmitButton>
    </form>
  );
}
