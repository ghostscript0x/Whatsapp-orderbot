"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { Field, FormMessage } from "./form-bits";

/** Form for a signed-in user to create another business. Used inline (no memberships) and in a dialog. */
export function CreateBusinessForm({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    setPending(true);
    try {
      await apiFetch("/api/tenants/new", {
        method: "POST",
        json: { businessName: String(form.get("businessName") ?? ""), whatsappPhone: String(form.get("whatsappPhone") ?? "") },
      });
      toast.success("Business created");
      onDone?.();
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the business. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      <Field id="new-businessName" label="Business name">
        <Input id="new-businessName" name="businessName" autoComplete="organization" required minLength={2} maxLength={100} />
      </Field>
      <Field id="new-whatsappPhone" label="Your WhatsApp number" hint="With country code, e.g. 2348012345678. New-order alerts go here.">
        <Input
          id="new-whatsappPhone"
          name="whatsappPhone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          maxLength={25}
          aria-describedby="new-whatsappPhone-hint"
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending && <Spinner />}
        {pending ? "Creating…" : "Create business"}
      </Button>
    </form>
  );
}

export function CreateBusinessDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Create another business"
        description="You'll be its owner. It gets its own WhatsApp number, products and orders."
      >
        <CreateBusinessForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
