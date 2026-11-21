"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { apiFetch } from "@/lib/fetcher";
import { Input } from "@/components/ui/input";
import { Field, FormMessage, PasswordInput, SubmitButton, fieldAria, useFieldErrors, validate } from "@/components/shell/form-bits";

export function InviteAccept({ token, mode, email }: { token: string; mode: "signed-in" | "new-account"; email: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { errors, clear, check } = useFieldErrors<"name" | "password">();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "");
    const password = String(form.get("password") ?? "");
    if (mode === "new-account" && !check(e.currentTarget, { name: validate.required(name, "your name"), password: validate.password(password) })) return;
    setPending(true);
    try {
      await apiFetch("/api/team/accept", {
        method: "POST",
        json: mode === "new-account" ? { token, name, password } : { token },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't accept the invite. Try again.");
      setPending(false);
      return;
    }
    if (mode === "new-account") {
      try {
        const res = await signIn("credentials", { email, password, redirect: false });
        if (!res || res.error) {
          router.replace("/login");
          return;
        }
      } catch {
        // The account and membership exist; only the automatic sign-in failed.
        router.replace("/login");
        return;
      }
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      {mode === "new-account" ? (
        <>
          <Field id="name" label="Your name" error={errors.name}>
            <Input id="name" name="name" autoComplete="name" required maxLength={100} onChange={() => clear("name")} {...fieldAria("name", errors.name)} />
          </Field>
          <Field id="password" label="Choose a password" hint="At least 8 characters." error={errors.password}>
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
        </>
      ) : null}
      <SubmitButton pending={pending} pendingLabel="Joining…" size="lg">
        {mode === "new-account" ? "Create account and join" : "Accept invite"}
      </SubmitButton>
    </form>
  );
}
