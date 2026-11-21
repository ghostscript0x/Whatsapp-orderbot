"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Clock, FlaskConical, MessageSquareText, Store, Truck } from "lucide-react";
import { apiFetch } from "@/lib/fetcher";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { BusinessFields } from "./business-form";
import { AlertFields, DeliveryFields, HoursFields, PersonalityFields, TemplateFields } from "./bot-settings-form";
import { SaveBar } from "./save-bar";
import { TestBotPanel } from "./test-bot-panel";
import { SETTINGS_TABS, koboToMajorString, type SettingsTab, type BotSettingsForm as BotValues, type BusinessForm as BusinessValues } from "./types";


const TAB_META: Record<SettingsTab, { label: string; icon: typeof Store }> = {
  business: { label: "Business", icon: Store },
  bot: { label: "Bot", icon: Bot },
  hours: { label: "Hours", icon: Clock },
  delivery: { label: "Delivery", icon: Truck },
  messages: { label: "Messages", icon: MessageSquareText },
  test: { label: "Test bot", icon: FlaskConical },
};

type BotSaved = { settings: { deliveryFeeKobo: number; ownerAlertPhone: string | null } };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function SettingsView({
  business: initialBusiness,
  settings: initialBot,
  canEdit,
  initialTab = "business",
}: {
  business: BusinessValues;
  settings: BotValues;
  canEdit: boolean;
  initialTab?: SettingsTab;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<SettingsTab>(canEdit ? initialTab : "test");
  const [savedBusiness, setSavedBusiness] = useState(initialBusiness);
  const [business, setBusiness] = useState(initialBusiness);
  const [savedBot, setSavedBot] = useState(initialBot);
  const [bot, setBot] = useState(initialBot);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const businessDirty = !same(business, savedBusiness);
  const botDirty = !same(bot, savedBot);
  const dirty = businessDirty || botDirty;

  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function changeTab(next: string) {
    setTab(next as SettingsTab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      // Saved one after the other so a failure tells the owner exactly which part didn't save.
      if (businessDirty) {
        try {
          const res = await apiFetch<{ business: BusinessValues }>("/api/settings/business", { method: "PUT", json: business });
          setSavedBusiness(res.business);
          setBusiness(res.business);
        } catch (err) {
          throw new Error(`Business details not saved: ${err instanceof Error ? err.message : "please try again."}`);
        }
      }
      if (botDirty) {
        try {
          const res = await apiFetch<BotSaved>("/api/settings/bot", {
            method: "PUT",
            json: {
              ...bot,
              ownerAlertPhone: bot.ownerAlertPhone.trim() || null,
              statusTemplates: Object.fromEntries(Object.entries(bot.statusTemplates).filter(([, t]) => t.trim() !== "")),
            },
          });
          // Reflect server normalisation (fee, phone digits) so the unsaved-changes state resets.
          const next = { ...bot, deliveryFee: koboToMajorString(res.settings.deliveryFeeKobo), ownerAlertPhone: res.settings.ownerAlertPhone ?? "" };
          setSavedBot(next);
          setBot(next);
        } catch (err) {
          throw new Error(`Bot settings not saved: ${err instanceof Error ? err.message : "please try again."}`);
        }
      }
      toast.success("Settings saved");
      if (businessDirty) router.refresh(); // business name appears in the header
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't save. Please try again.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setBusiness(savedBusiness);
    setBot(savedBot);
    setError(null);
  }

  const visibleTabs = canEdit ? SETTINGS_TABS : (["test"] as const);

  return (
    <div>
      {!canEdit ? (
        <p className="mb-5 rounded-xl border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          Only the business owner can change settings. You can still try the bot below.
        </p>
      ) : null}

      <Tabs value={tab} onValueChange={changeTab}>
        {visibleTabs.length > 1 && (
          <div className="sticky top-14 z-10 -mx-4 bg-background/85 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 md:top-16">
            <TabsList aria-label="Settings sections" className="w-full justify-start sm:w-auto">
              {visibleTabs.map((t) => {
                const { label, icon: Icon } = TAB_META[t];
                return (
                  <TabsTrigger key={t} value={t}>
                    <Icon aria-hidden />
                    {label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
        )}

        {/* The test chat has its own form, so it must sit outside this one (no nested forms). */}
        <form onSubmit={onSubmit}>
          <fieldset disabled={!canEdit || saving} className="contents">
          <TabsContent value="business" className="grid gap-5">
            <BusinessFields values={business} onChange={setBusiness} />
            <AlertFields values={bot} onChange={setBot} />
          </TabsContent>
          <TabsContent value="bot" className="grid gap-5">
            <PersonalityFields values={bot} onChange={setBot} />
          </TabsContent>
          <TabsContent value="hours" className="grid gap-5">
            <HoursFields values={bot} onChange={setBot} disabled={!canEdit} />
          </TabsContent>
          <TabsContent value="delivery" className="grid gap-5">
            <DeliveryFields values={bot} onChange={setBot} currency={business.currency} />
          </TabsContent>
          <TabsContent value="messages" className="grid gap-5">
            <TemplateFields values={bot} onChange={setBot} disabled={!canEdit} />
          </TabsContent>
          </fieldset>
          {canEdit && <SaveBar visible={dirty || !!error} saving={saving} error={error} onDiscard={discard} />}
        </form>
        <TabsContent value="test">
          <TestBotPanel botName={savedBot.botName} businessName={savedBusiness.name} unsavedChanges={dirty} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
