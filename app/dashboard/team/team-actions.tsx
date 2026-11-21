"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, UserMinus } from "lucide-react";
import { apiFetch } from "@/lib/fetcher";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { validate } from "@/components/shell/form-bits";

export function InviteForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const email = String(new FormData(formEl).get("email") ?? "").trim();
    const invalid = validate.email(email);
    if (invalid) {
      setError(invalid);
      (formEl.elements.namedItem("email") as HTMLInputElement | null)?.focus();
      return;
    }
    setError(null);
    setPending(true);
    try {
      await apiFetch("/api/team/invite", { method: "POST", json: { email } });
      formEl.reset();
      toast.success(`Invite sent to ${email}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the invite");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-1.5">
      <Label htmlFor="invite-email">Their email address</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="invite-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="name@example.com"
          required
          maxLength={254}
          className="sm:max-w-sm"
          onChange={() => setError(null)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "invite-email-error" : undefined}
        />
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : <Send aria-hidden />}
          {pending ? "Sending…" : "Send invite"}
        </Button>
      </div>
      {error ? (
        <p id="invite-email-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function useDelete(url: string, body: unknown, successMessage: string) {
  const router = useRouter();
  return async () => {
    // Errors propagate to ConfirmButton, which keeps the dialog open and shows them.
    await apiFetch(url, { method: "DELETE", json: body });
    toast.success(successMessage);
    router.refresh();
  };
}

export function RemoveMemberButton({ membershipId, name }: { membershipId: string; name: string }) {
  const remove = useDelete("/api/team", { membershipId }, `${name} was removed`);
  return (
    <ConfirmButton
      variant="ghost"
      size="sm"
      destructive
      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      title={`Remove ${name}?`}
      description="They'll lose access to this business straight away. You can invite them again later."
      confirmLabel="Remove"
      onConfirm={remove}
      aria-label={`Remove ${name}`}
    >
      <UserMinus aria-hidden />
      Remove
    </ConfirmButton>
  );
}

export function RevokeInviteButton({ inviteId, email }: { inviteId: string; email: string }) {
  const revoke = useDelete("/api/team/invite", { inviteId }, `Invite for ${email} cancelled`);
  return (
    <ConfirmButton
      variant="ghost"
      size="sm"
      destructive
      title="Cancel this invite?"
      description={`The link sent to ${email} will stop working.`}
      confirmLabel="Cancel invite"
      cancelLabel="Keep it"
      onConfirm={revoke}
      aria-label={`Cancel invite for ${email}`}
    >
      Cancel invite
    </ConfirmButton>
  );
}
