import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ACTIVE_TENANT_COOKIE } from "@/lib/api";
import { forTenant } from "@/lib/tenant";
import { getMyTenants } from "@/lib/tenants";
import { Badge } from "@/components/ui/misc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { InviteForm, RemoveMemberButton, RevokeInviteButton } from "./team-actions";

export const metadata: Metadata = { title: "Team" };

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function TeamPage() {
  const userId = (await auth())?.user?.id;
  if (!userId) redirect("/login");
  const { active } = await getMyTenants(userId, (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value);
  if (!active) redirect("/dashboard");

  const db = forTenant(active.tenantId);
  const isOwner = active.role === "OWNER";
  const [members, invites] = await Promise.all([
    db.membership.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
    }),
    isOwner
      ? db.invite.findMany({
          where: { acceptedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
          select: { id: true, email: true, expiresAt: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <PageHeader
        className="mb-1"
        title="Team"
        description="Staff can handle orders, products and customer chats. Only owners can change settings, WhatsApp and the team."
      />

      {isOwner ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invite a staff member</CardTitle>
            <CardDescription>They&apos;ll get an email with a link to join. The link expires in 7 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <InviteForm />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members ({members.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary"
                >
                  {m.user.name.trim().slice(0, 1).toUpperCase() || "?"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {m.user.name}
                    {m.user.id === userId ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">{m.user.email}</p>
                  <Badge variant={m.role === "OWNER" ? "success" : "secondary"} className="mt-1 sm:hidden">
                    {m.role === "OWNER" ? "Owner" : "Staff"}
                  </Badge>
                </div>
                <Badge variant={m.role === "OWNER" ? "success" : "secondary"} className="hidden sm:inline-flex">{m.role === "OWNER" ? "Owner" : "Staff"}</Badge>
                {isOwner && m.user.id !== userId ? <RemoveMemberButton membershipId={m.id} name={m.user.name} /> : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {isOwner ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending invites</CardTitle>
          </CardHeader>
          <CardContent>
            {invites.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending invites. Invite someone above to add them to your team.</p>
            ) : (
              <ul className="divide-y">
                {invites.map((inv) => (
                  <li key={inv.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{inv.email}</p>
                      <p className="text-sm text-muted-foreground">Expires {dateFmt.format(inv.expiresAt)}</p>
                    </div>
                    <RevokeInviteButton inviteId={inv.id} email={inv.email} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
