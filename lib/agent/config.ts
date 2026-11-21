import type { BotSettings, OrderStatus } from "@prisma/client";

/** The bot settings the agent and settings UI work with (BotSettings minus ids/timestamps). */
export type BotConfig = Pick<
  BotSettings,
  | "botName"
  | "tone"
  | "greeting"
  | "businessHours"
  | "deliveryFeeKobo"
  | "deliveryAreas"
  | "paymentInstructions"
  | "faq"
  | "ownerAlertPhone"
  | "statusTemplates"
>;

/** Mirrors the column defaults in prisma/schema.prisma, used when a tenant has no BotSettings row yet. */
export const DEFAULT_BOT_CONFIG: BotConfig = {
  botName: "Assistant",
  tone: "friendly and concise",
  greeting: "Hi! How can I help you today?",
  businessHours: {},
  deliveryFeeKobo: 0,
  deliveryAreas: "",
  paymentInstructions: "",
  faq: "",
  ownerAlertPhone: null,
  statusTemplates: {},
};

export function toBotConfig(row: BotSettings | null | undefined): BotConfig {
  if (!row) return { ...DEFAULT_BOT_CONFIG };
  return {
    botName: row.botName,
    tone: row.tone,
    greeting: row.greeting,
    businessHours: row.businessHours,
    deliveryFeeKobo: row.deliveryFeeKobo,
    deliveryAreas: row.deliveryAreas,
    paymentInstructions: row.paymentInstructions,
    faq: row.faq,
    ownerAlertPhone: row.ownerAlertPhone,
    statusTemplates: row.statusTemplates,
  };
}

export type TenantInfo = { name: string; currency: string; timezone: string };

/** Statuses that have an editable customer notification template. */
export const TEMPLATE_STATUSES = ["CONFIRMED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"] as const satisfies readonly OrderStatus[];
