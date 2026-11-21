import { redirect } from "next/navigation";
import { ApiError, requireTenant } from "@/lib/api";
import { WhatsAppConnect } from "@/components/whatsapp/whatsapp-connect";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "WhatsApp" };

export default async function WhatsAppPage() {
  let role: "OWNER" | "STAFF";
  try {
    ({ role } = await requireTenant());
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/login");
    throw err;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="WhatsApp" description="Link your business WhatsApp number so the bot can reply to customers." />
      <WhatsAppConnect isOwner={role === "OWNER"} />
    </div>
  );
}
