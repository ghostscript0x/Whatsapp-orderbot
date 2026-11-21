"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { apiFetch } from "@/lib/fetcher";
import { Input } from "@/components/ui/input";
import { Field, FormMessage, PasswordInput, SubmitButton, fieldAria, useFieldErrors, validate } from "@/components/shell/form-bits";

type Key = "ownerName" | "email" | "password" | "businessName" | "whatsappPhone";

export function SignupForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { errors, clear, check } = useFieldErrors<Key>();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const body = {
      ownerName: String(form.get("ownerName") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      businessName: String(form.get("businessName") ?? ""),
      whatsappPhone: String(form.get("whatsappPhone") ?? ""),
    };
    const ok = check(formEl, {
      ownerName: validate.required(body.ownerName, "your name"),
      email: validate.email(body.email),
      password: validate.password(body.password),
      businessName: body.businessName.trim().length >= 2 ? null : "Enter your business name.",
      whatsappPhone: validate.phone(body.whatsappPhone),
    });
    if (!ok) return;

    setPending(true);
    try {
      await apiFetch("/api/tenants", { method: "POST", json: body });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed. Try again.");
      setPending(false);
      return;
    }
    try {
      const res = await signIn("credentials", { email: body.email, password: body.password, redirect: false });
      if (!res || res.error) {
        router.replace("/login");
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      // The account exists; only the automatic sign-in failed.
      router.replace("/login");
    }
  }

  const input = (key: Key, hasHint = false) => ({ onChange: () => clear(key), ...fieldAria(key, errors[key], hasHint) });

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1 text-sm text-muted-foreground">Takes about a minute. Next you&apos;ll connect WhatsApp and add your products.</p>

      <form onSubmit={onSubmit} noValidate className="mt-8 grid gap-5">
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        <Field id="ownerName" label="Your name" error={errors.ownerName}>
          <Input id="ownerName" name="ownerName" autoComplete="name" required maxLength={100} {...input("ownerName")} />
        </Field>
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
            {...input("email")}
          />
        </Field>
        <Field id="password" label="Password" hint="At least 8 characters." error={errors.password}>
          <PasswordInput id="password" name="password" autoComplete="new-password" required minLength={8} maxLength={200} {...input("password", true)} />
        </Field>

        <div className="grid gap-5 border-t pt-5">
          <Field id="businessName" label="Business name" error={errors.businessName}>
            <Input
              id="businessName"
              name="businessName"
              autoComplete="organization"
              placeholder="e.g. Mama Tee's Kitchen"
              required
              minLength={2}
              maxLength={100}
              {...input("businessName")}
            />
          </Field>
          <Field
            id="whatsappPhone"
            label="Your WhatsApp number"
            hint="With country code, e.g. 2348012345678. We send new-order alerts here."
            error={errors.whatsappPhone}
          >
            <Input
              id="whatsappPhone"
              name="whatsappPhone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="2348012345678"
              required
              maxLength={25}
              {...input("whatsappPhone", true)}
            />
          </Field>
        </div>

        <SubmitButton pending={pending} pendingLabel="Creating your account…" size="lg">
          Create account
        </SubmitButton>
      </form>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
