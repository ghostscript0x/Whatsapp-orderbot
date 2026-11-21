import { redirect } from "next/navigation";
import { ApiError, requireTenant } from "@/lib/api";
import { toBotConfig } from "@/lib/agent/config";
import { parseBusinessHours } from "@/lib/business-hours";
import { SettingsView } from "@/components/settings/settings-view";
import { PageHeader } from "@/components/ui/page-header";
import { SETTINGS_TABS, TEMPLATE_FIELDS, koboToMajorString, type SettingsTab, type BotSettingsForm, type TemplateStatus } from "@/components/settings/types";

export const metadata = { title: "Settings" };

function templatesFrom(value: unknown): Record<TemplateStatus, string> {
  const obj = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(TEMPLATE_FIELDS.map((f) => [f.status, typeof obj[f.status] === "string" ? (obj[f.status] as string) : ""])) as Record<TemplateStatus, string>;
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const rawTab = (await searchParams).tab;
  const tab = (SETTINGS_TABS as readonly string[]).includes(String(rawTab)) ? (rawTab as SettingsTab) : "business";
  let ctx;
  try {
    ctx = await requireTenant();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/login");
    throw err;
  }

  const [tenant, row] = await Promise.all([
    ctx.db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { name: true, timezone: true, currency: true } }),
    ctx.db.botSettings.findFirst(),
  ]);
  const config = toBotConfig(row);
  const settings: BotSettingsForm = {
    botName: config.botName,
    tone: config.tone,
    greeting: config.greeting,
    businessHours: parseBusinessHours(config.businessHours) ?? {},
    deliveryFee: koboToMajorString(config.deliveryFeeKobo),
    deliveryAreas: config.deliveryAreas,
    paymentInstructions: config.paymentInstructions,
    faq: config.faq,
    ownerAlertPhone: config.ownerAlertPhone ?? "",
    statusTemplates: templatesFrom(config.statusTemplates),
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" description="Your business details and how your WhatsApp bot talks to customers." />
      <SettingsView business={tenant} settings={settings} canEdit={ctx.role === "OWNER"} initialTab={tab} />
    </div>
  );
}
