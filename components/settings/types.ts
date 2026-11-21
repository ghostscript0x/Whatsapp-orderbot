import type { BusinessHours } from "@/lib/business-hours";

export const TEMPLATE_FIELDS = [
  { status: "CONFIRMED", label: "Order confirmed", example: "Hi {firstName}, your order {orderNumber} ({total}) is confirmed and being prepared." },
  { status: "OUT_FOR_DELIVERY", label: "Out for delivery", example: "Good news {firstName}! Order {orderNumber} is on its way." },
  { status: "DELIVERED", label: "Delivered", example: "Order {orderNumber} has been delivered. Enjoy your meal, and thank you for ordering from {businessName}!" },
  { status: "CANCELLED", label: "Cancelled", example: "Sorry {firstName}, order {orderNumber} was cancelled. Reply here if you have questions." },
] as const;

export type TemplateStatus = (typeof TEMPLATE_FIELDS)[number]["status"];

/** Client form state for bot settings. deliveryFee is a major-unit string as typed by the owner. */
export type BotSettingsForm = {
  botName: string;
  tone: string;
  greeting: string;
  businessHours: BusinessHours;
  deliveryFee: string;
  deliveryAreas: string;
  paymentInstructions: string;
  faq: string;
  ownerAlertPhone: string;
  statusTemplates: Record<TemplateStatus, string>;
};

export type BusinessForm = { name: string; timezone: string; currency: string };

export function koboToMajorString(kobo: number): string {
  return kobo % 100 === 0 ? String(kobo / 100) : (kobo / 100).toFixed(2);
}

/** Tabs on /dashboard/settings, selectable with ?tab=. */
export const SETTINGS_TABS = ["business", "bot", "hours", "delivery", "messages", "test"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
