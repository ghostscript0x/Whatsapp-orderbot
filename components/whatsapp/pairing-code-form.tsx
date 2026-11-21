"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/misc";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/fetcher";

/** Alternative to the QR: owner enters the business number, we show the 8-character code. */
export function PairingCodeForm({ disabled }: { disabled?: boolean }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ code: string }>("/api/whatsapp/pairing-code", { method: "POST", json: { phone } });
      setCode(res.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not get a pairing code");
    } finally {
      setBusy(false);
    }
  }

  const pretty = code && code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-2" noValidate>
        <Label htmlFor="wa-pair-phone">WhatsApp number to link</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="wa-pair-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="2348012345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-describedby="wa-pair-help"
            aria-invalid={error ? true : undefined}
            required
            className="sm:max-w-xs"
          />
          <Button type="submit" disabled={disabled || busy || phone.trim().length < 6}>
            {busy && <Spinner />}
            {busy ? "Requesting…" : "Get pairing code"}
          </Button>
        </div>
        <p id="wa-pair-help" className="text-xs text-muted-foreground">
          Use this if you can&apos;t scan, e.g. you&apos;re on the same phone. Country code first, e.g. 2348012345678.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>

      {pretty && (
        <div className="rounded-2xl border border-primary/30 bg-primary-soft p-5 text-center" aria-live="polite">
          <p className="text-sm text-muted-foreground">Your pairing code</p>
          <p className="mt-2 select-all font-mono text-4xl font-semibold tracking-[0.2em] tabular-nums">{pretty}</p>
          <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">
            On your phone open WhatsApp → Settings → Linked devices → Link a device → <strong>Link with phone number instead</strong>, then enter this code.
          </p>
        </div>
      )}
    </div>
  );
}
