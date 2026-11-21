import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ACTIVE_TENANT_COOKIE } from "@/lib/api";
import { getMyTenants } from "@/lib/tenants";
import { forTenant } from "@/lib/tenant";
import { DashboardShell } from "@/components/shell/dashboard-shell";
import { CreateBusinessForm } from "@/components/shell/create-business-dialog";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

function CenteredNotice({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-start justify-center px-4 py-12 sm:py-20">
      <Card className="w-full max-w-md shadow-md">
        <CardHeader>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">{children}</CardContent>
      </Card>
    </main>
  );
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const userId = (await auth())?.user?.id;
  if (!userId) redirect("/login");

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  if (!user) {
    // Session cookie outlived the account. Don't redirect to /login: it would bounce back here.
    return (
      <CenteredNotice title="Your account no longer exists" description="Log out and sign in with another account.">
        <SignOutButton className="w-full" />
      </CenteredNotice>
    );
  }

  const { tenants, active } = await getMyTenants(userId, (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value);

  if (!active) {
    return (
      <CenteredNotice title="Create your business" description="You're not part of any business yet. Create one, or ask an owner to invite you.">
        <CreateBusinessForm />
        <SignOutButton variant="ghost" className="w-full" />
      </CenteredNotice>
    );
  }

  const suspended = active.status === "SUSPENDED";
  // Two cheap indexed counts for the nav badges. Layouts don't re-render on client navigation,
  // so these refresh on full page loads and whenever a client calls router.refresh().
  const db = forTenant(active.tenantId);
  const [newOrders, waitingChats] = suspended
    ? [0, 0]
    : await Promise.all([db.order.count({ where: { status: "NEW" } }), db.conversation.count({ where: { needsHuman: true } })]);

  return (
    <DashboardShell
      user={user}
      tenants={tenants}
      activeTenantId={active.tenantId}
      role={active.role}
      badges={{ orders: newOrders, conversations: waitingChats }}
    >
      {suspended ? (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <p className="font-medium">{active.name} is suspended.</p>
          <p className="mt-1 text-muted-foreground">
            The bot isn&apos;t answering customers and its dashboard is unavailable. Contact support to restore access
            {tenants.length > 1 ? ", or switch to another business above." : "."}
          </p>
        </div>
      ) : (
        children
      )}
    </DashboardShell>
  );
}
