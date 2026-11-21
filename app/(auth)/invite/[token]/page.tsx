import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/crypto";
import { buttonVariants } from "@/components/ui/button";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { InviteAccept } from "./invite-accept";

export const metadata: Metadata = { title: "Join a team" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Raw client: the visitor is not (yet) a member of this tenant. Only the invite's own data is read.
  const invite = await prisma.invite.findUnique({
    where: { tokenHash: sha256(token) },
    select: { email: true, acceptedAt: true, expiresAt: true, tenant: { select: { name: true, status: true } } },
  });
  const valid = invite && !invite.acceptedAt && invite.expiresAt > new Date() && invite.tenant.status === "ACTIVE";

  if (!valid) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">This invite can&apos;t be used</h1>
        <p className="mt-2 text-sm text-muted-foreground">
            It may have expired, already been accepted, or been replaced by a newer invite. Ask the business owner to send you a new one.
        </p>
        <Link href="/login" className={buttonVariants({ variant: "outline", className: "mt-8 w-full" })}>
          Go to log in
        </Link>
      </div>
    );
  }

  const session = await auth();
  const sessionUserId = session?.user?.id;
  const me = sessionUserId ? await prisma.user.findUnique({ where: { id: sessionUserId }, select: { email: true } }) : null;
  const accountExists = !me && (await prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } })) !== null;
  const selfUrl = `/invite/${encodeURIComponent(token)}`;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Join {invite.tenant.name}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
          You&apos;ve been invited as staff to manage orders and customer chats. Invite sent to{" "}
          <span className="font-medium text-foreground">{invite.email}</span>.
      </p>
      <div className="mt-8 grid gap-4">
        {me && me.email !== invite.email ? (
          <>
            <p className="text-sm">
              You&apos;re logged in as <span className="font-medium">{me.email}</span>. Log out, then open this link again and
              sign in as {invite.email}.
            </p>
            <SignOutButton redirectTo={selfUrl} variant="outline" className="w-full" />
          </>
        ) : me ? (
          <InviteAccept token={token} mode="signed-in" email={invite.email} />
        ) : accountExists ? (
          <>
            <p className="text-sm">You already have an account with this email. Log in to accept the invite.</p>
            <Link href={`/login?callbackUrl=${encodeURIComponent(selfUrl)}`} className={buttonVariants({ className: "w-full" })}>
              Log in to accept
            </Link>
          </>
        ) : (
          <InviteAccept token={token} mode="new-account" email={invite.email} />
        )}
      </div>
    </div>
  );
}
