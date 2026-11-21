"use client";

import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field, SettingsSection } from "./section";
import { HoursEditor } from "./hours-editor";
import { TEMPLATE_FIELDS, type BotSettingsForm as BotValues, type TemplateStatus } from "./types";

/** Field groups for PUT /api/settings/bot. State lives in SettingsView so every tab shares one save bar. */
type Props = { values: BotValues; onChange: (v: BotValues) => void; disabled?: boolean };
type TextKey = "botName" | "tone" | "greeting" | "deliveryFee" | "deliveryAreas" | "paymentInstructions" | "faq" | "ownerAlertPhone";

const PLACEHOLDERS = [
  { token: "{orderNumber}", label: "order number" },
  { token: "{customerName}", label: "customer name" },
  { token: "{firstName}", label: "first name" },
  { token: "{total}", label: "order total" },
  { token: "{businessName}", label: "business name" },
];

function useText({ values, onChange }: Props) {
  return (k: TextKey) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...values, [k]: e.target.value });
}

export function AlertFields(props: Props) {
  const text = useText(props);
  return (
    <SettingsSection id="alerts" title="Order alerts" description="We message you on WhatsApp for every new order and whenever a customer asks for a person.">
      <Field id="alert-phone" label="Your personal WhatsApp number" hint="With country code, e.g. 2348012345678. Leave empty to turn alerts off.">
        <Input
          id="alert-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="2348012345678"
          value={props.values.ownerAlertPhone}
          onChange={text("ownerAlertPhone")}
          maxLength={20}
          className="sm:max-w-64"
          aria-describedby="alert-phone-hint"
        />
      </Field>
    </SettingsSection>
  );
}

export function PersonalityFields(props: Props) {
  const text = useText(props);
  const { values } = props;
  return (
    <>
      <SettingsSection id="personality" title="How your bot talks" description="Give it a name and a style that sounds like your business.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="bot-name" label="Bot name" hint="Customers see this, e.g. “Tee from Mama Tee's”.">
            <Input id="bot-name" value={values.botName} onChange={text("botName")} maxLength={40} required aria-describedby="bot-name-hint" />
          </Field>
          <Field id="bot-tone" label="Style" hint="e.g. warm and short, or polite and formal.">
            <Input id="bot-tone" value={values.tone} onChange={text("tone")} maxLength={200} required aria-describedby="bot-tone-hint" />
          </Field>
        </div>
        <Field id="bot-greeting" label="First message" hint="What the bot says when a customer messages you for the first time.">
          <Textarea id="bot-greeting" value={values.greeting} onChange={text("greeting")} maxLength={500} rows={3} required aria-describedby="bot-greeting-hint" />
        </Field>
      </SettingsSection>

      <SettingsSection id="faq" title="Things the bot should know" description="Answers to common questions: pickup, portion sizes, allergens, refunds.">
        <Field id="faq-text" label="Extra information" hint={`${values.faq.length.toLocaleString()} of 4,000 characters`}>
          <Textarea
            id="faq-text"
            value={values.faq}
            onChange={text("faq")}
            maxLength={4000}
            rows={7}
            placeholder={"Pickup: 12 Allen Avenue, Ikeja, 10am–8pm.\nSmall chops trays need 24 hours' notice.\nNo refunds after delivery, but tell us if something is wrong."}
            aria-describedby="faq-text-hint"
          />
        </Field>
      </SettingsSection>
    </>
  );
}

export function HoursFields(props: Props) {
  return (
    <SettingsSection id="hours" title="Opening hours" description="Outside these hours the bot still takes orders and tells customers you'll handle them when you open.">
      <HoursEditor value={props.values.businessHours} onChange={(businessHours) => props.onChange({ ...props.values, businessHours })} disabled={props.disabled} />
    </SettingsSection>
  );
}

export function DeliveryFields(props: Props & { currency: string }) {
  const text = useText(props);
  const { values } = props;
  return (
    <SettingsSection id="delivery" title="Delivery & payment" description="The bot adds the delivery fee to every order and shares these details when customers ask.">
      <Field id="fee" label={`Delivery fee (${props.currency})`} hint="One flat fee per order. Use 0 for free delivery.">
        <Input
          id="fee"
          inputMode="decimal"
          value={values.deliveryFee}
          onChange={text("deliveryFee")}
          placeholder="0"
          className="tabular-nums sm:max-w-48"
          aria-describedby="fee-hint"
        />
      </Field>
      <Field id="areas" label="Where you deliver" hint="Areas, towns or a distance. The bot tells customers if they're outside it.">
        <Textarea
          id="areas"
          value={values.deliveryAreas}
          onChange={text("deliveryAreas")}
          maxLength={1000}
          rows={2}
          placeholder="Ikeja, Maryland, Ogba and Magodo"
          aria-describedby="areas-hint"
        />
      </Field>
      <Field id="payment" label="How customers pay" hint="e.g. bank transfer details or pay on delivery. The bot never asks for card details.">
        <Textarea
          id="payment"
          value={values.paymentInstructions}
          onChange={text("paymentInstructions")}
          maxLength={1000}
          rows={3}
          placeholder="Pay on delivery (cash or transfer)."
          aria-describedby="payment-hint"
        />
      </Field>
    </SettingsSection>
  );
}

export function TemplateFields(props: Props) {
  const { values, onChange, disabled } = props;
  const setTemplate = (s: TemplateStatus, t: string) => onChange({ ...values, statusTemplates: { ...values.statusTemplates, [s]: t } });
  return (
    <SettingsSection
      id="templates"
      title="Order update messages"
      description="Sent to the customer on WhatsApp when you change an order's status. Leave a box empty to use our standard message."
    >
      {TEMPLATE_FIELDS.map((f) => {
        const id = `tpl-${f.status}`;
        return (
          <Field key={f.status} id={id} label={f.label}>
            <Textarea id={id} value={values.statusTemplates[f.status]} onChange={(e) => setTemplate(f.status, e.target.value)} placeholder={f.example} maxLength={500} rows={2} />
            {!disabled ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Insert:</span>
                {PLACEHOLDERS.map((p) => (
                  <Button
                    key={p.token}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-full px-3 text-xs md:h-8"
                    onClick={() => setTemplate(f.status, `${values.statusTemplates[f.status]}${p.token}`)}
                    aria-label={`Insert ${p.label} into ${f.label}`}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            ) : null}
          </Field>
        );
      })}
    </SettingsSection>
  );
}
