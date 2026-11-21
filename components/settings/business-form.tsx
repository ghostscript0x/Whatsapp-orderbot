"use client";

import { useMemo } from "react";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field, SettingsSection } from "./section";
import type { BusinessForm as BusinessValues } from "./types";

const COMMON_CURRENCIES = [
  { code: "NGN", label: "NGN · Nigerian naira" },
  { code: "GHS", label: "GHS · Ghanaian cedi" },
  { code: "KES", label: "KES · Kenyan shilling" },
  { code: "ZAR", label: "ZAR · South African rand" },
  { code: "USD", label: "USD · US dollar" },
  { code: "GBP", label: "GBP · British pound" },
  { code: "EUR", label: "EUR · Euro" },
];

function timezones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    // Older browsers: the field is still free text and the server validates it.
    return [];
  }
}

/** Business name, timezone and currency (PUT /api/settings/business). */
export function BusinessFields({ values, onChange }: { values: BusinessValues; onChange: (v: BusinessValues) => void }) {
  const zones = useMemo(timezones, []);
  const currencies = COMMON_CURRENCIES.some((c) => c.code === values.currency)
    ? COMMON_CURRENCIES
    : [{ code: values.currency, label: values.currency }, ...COMMON_CURRENCIES];

  return (
    <SettingsSection id="business" title="Business details" description="The bot uses your business name when it greets customers.">
      <Field id="biz-name" label="Business name">
        <Input id="biz-name" value={values.name} onChange={(e) => onChange({ ...values, name: e.target.value })} maxLength={80} required autoComplete="organization" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="biz-tz" label="Time zone" hint="Your opening hours follow this time zone.">
          <Input
            id="biz-tz"
            value={values.timezone}
            onChange={(e) => onChange({ ...values, timezone: e.target.value })}
            list="tz-list"
            required
            aria-describedby="biz-tz-hint"
          />
          <datalist id="tz-list">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </Field>
        <Field id="biz-cur" label="Currency" hint="Changing this doesn't convert prices you've already entered.">
          <NativeSelect
            id="biz-cur"
            value={values.currency}
            onChange={(e) => onChange({ ...values, currency: e.target.value })}
            aria-describedby="biz-cur-hint"
          >
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
    </SettingsSection>
  );
}
