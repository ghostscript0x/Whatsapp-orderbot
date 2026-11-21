import { z } from "zod";
import { parseToKobo } from "@/lib/money";
import { businessHoursSchema, isValidTimezone } from "@/lib/business-hours";
import { TEMPLATE_STATUSES } from "./config";

/** Max delivery fee: 1,000,000 major units, a sanity bound against typos. */
const MAX_DELIVERY_FEE_KOBO = 100_000_000;
const PLACEHOLDER = /\{(\w+)\}/g;
export const STATUS_TEMPLATE_PLACEHOLDERS = ["orderNumber", "customerName", "firstName", "total", "businessName"] as const;
const ALLOWED_PLACEHOLDERS = new Set<string>(STATUS_TEMPLATE_PLACEHOLDERS);

const template = z
  .string()
  .trim()
  .max(500)
  .refine((s) => [...s.matchAll(PLACEHOLDER)].every((m) => ALLOWED_PLACEHOLDERS.has(m[1])), `Only these placeholders are allowed: ${STATUS_TEMPLATE_PLACEHOLDERS.map((p) => `{${p}}`).join(", ")}`);

export const statusTemplatesSchema = z
  .object(Object.fromEntries(TEMPLATE_STATUSES.map((s) => [s, template.optional()])) as Record<(typeof TEMPLATE_STATUSES)[number], z.ZodOptional<typeof template>>)
  .strict();

/** PUT /api/settings/bot body. deliveryFee is in MAJOR units (e.g. "1500" or "1,500.50"). */
export const botSettingsInputSchema = z
  .object({
    botName: z.string().trim().min(1).max(40),
    tone: z.string().trim().min(1).max(200),
    greeting: z.string().trim().min(1).max(500),
    businessHours: businessHoursSchema,
    deliveryFee: z.union([z.string(), z.number()]).transform((v, ctx) => {
      const kobo = String(v).trim() === "" ? 0 : parseToKobo(v);
      if (kobo === null || kobo > MAX_DELIVERY_FEE_KOBO) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid amount, e.g. 1500" });
        return z.NEVER;
      }
      return kobo;
    }),
    deliveryAreas: z.string().trim().max(1000),
    paymentInstructions: z.string().trim().max(1000),
    faq: z.string().trim().max(4000),
    ownerAlertPhone: z
      .string()
      .transform((s) => s.replace(/[\s\-+()]/g, ""))
      .refine((s) => s === "" || /^\d{8,15}$/.test(s), "Use the full number with country code, digits only (e.g. 2348012345678)")
      .transform((s) => (s === "" ? null : s))
      .nullable(),
    statusTemplates: statusTemplatesSchema,
  })
  .strict();

export type BotSettingsInput = z.input<typeof botSettingsInputSchema>;

export const businessInputSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    timezone: z.string().trim().refine(isValidTimezone, "Unknown timezone"),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .refine((c) => {
        if (!/^[A-Z]{3}$/.test(c)) return false;
        try {
          new Intl.NumberFormat("en", { style: "currency", currency: c });
          return true;
        } catch {
          return false;
        }
      }, "Use a 3-letter ISO currency code, e.g. NGN"),
  })
  .strict();

/** POST /api/settings/bot/test body: the browser holds the transcript. */
export const botTestInputSchema = z
  .object({
    history: z
      .array(z.object({ from: z.enum(["customer", "bot"]), text: z.string().max(2000) }).strict())
      .max(20),
    message: z.string().trim().min(1).max(2000),
  })
  .strict();
