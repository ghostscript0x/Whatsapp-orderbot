"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Input } from "@/components/ui/input";
import { Field, FormMessage, PasswordInput, SubmitButton, fieldAria, useFieldErrors, validate } from "@/components/shell/form-bits";

export function LoginForm({ callbackUrl, passwordReset }: { callbackUrl: string; passwordReset: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { errors, clear, check } = useFieldErrors<"email" | "password">();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    if (!check(formEl, { email: validate.email(email), password: password ? null : "Enter your password." })) return;

    setPending(true);
    try {
      const res = await signIn("credentials", { email, password, redirect: false });
      if (!res || res.error) {
        setError("That email and password don't match. Check them and try again.");
        setPending(false);
        return;
      }
      router.replace(callbackUrl);
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-sm text-muted-foreground">Log in to see your orders and chats.</p>

      <form onSubmit={onSubmit} noValidate className="mt-8 grid gap-5">
        {passwordReset ? <FormMessage tone="success">Password updated. Log in with your new password.</FormMessage> : null}
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
        <div className="grid gap-1.5">
          <Field id="password" label="Password" error={errors.password}>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              required
              maxLength={200}
              onChange={() => clear("password")}
              {...fieldAria("password", errors.password)}
            />
          </Field>
          <Link
            href="/forgot-password"
            className="justify-self-end rounded py-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Forgot password?
          </Link>
        </div>
        <SubmitButton pending={pending} pendingLabel="Logging in…" size="lg">
          Log in
        </SubmitButton>
      </form>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        New to OrderBot?{" "}
        <Link href="/signup" className="font-medium text-primary underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
