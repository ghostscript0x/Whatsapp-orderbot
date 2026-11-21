/**
 * Text of the WhatsApp messages and emails the notifications worker sends. Pure functions:
 * all data (formatted money, links) is passed in, so they are easy to test and to tweak.
 *
 * Customer messages are warm and short. Owner alerts are built to be scanned on a phone
 * lock screen: the headline first, one fact per line, the dashboard link last.
 */
import type { OrderStatus } from "@prisma/client";
import { renderTemplate, statusTemplateFor } from "./orders-rules";

/** "ada  obi" -> "Ada". Falls back to "there" ("Hi there!") when no usable name was given. */
export function firstNameOf(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first) return "there";
  return first.charAt(0).toLocaleUpperCase() + first.slice(1);
}

const displayPhone = (digits: string) => `+${digits.replace(/\D/g, "")}`;

export type CustomerStatusInput = {
  status: OrderStatus;
  /** BotSettings.statusTemplates (untrusted JSON); the owner's template wins over the default. */
  statusTemplates: unknown;
  orderNumber: string;
  customerName: string;
  /** Already formatted, e.g. "₦6,100". */
  total: string;
  businessName: string;
};

/** The customer's order update, or null when this status has no message (NEW: the bot already confirmed in chat). */
export function customerStatusMessage(input: CustomerStatusInput): string | null {
  const template = statusTemplateFor(input.statusTemplates, input.status);
  if (!template) return null;
  return renderTemplate(template, {
    orderNumber: input.orderNumber,
    customerName: input.customerName,
    firstName: firstNameOf(input.customerName),
    total: input.total,
    businessName: input.businessName,
  }).trim();
}

export type OwnerNewOrderInput = {
  orderNumber: string;
  /** Formatted amounts. */
  total: string;
  deliveryFee: string | null;
  items: { quantity: number; name: string; lineTotal: string }[];
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  notes: string;
  link: string;
};

export function ownerNewOrderMessage(o: OwnerNewOrderInput): string {
  const lines = [
    `🛒 New order ${o.orderNumber} · ${o.total}`,
    "",
    ...o.items.map((i) => `${i.quantity} × ${i.name} — ${i.lineTotal}`),
    o.deliveryFee ? `Delivery — ${o.deliveryFee}` : null,
    "",
    `👤 ${o.customerName} · ${displayPhone(o.customerPhone)}`,
    `📍 ${o.deliveryAddress}`,
    o.notes.trim() ? `📝 ${o.notes.trim()}` : null,
    "",
    `Open: ${o.link}`,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

export type OwnerNeedsHumanInput = {
  customerName: string | null;
  customerPhone: string;
  reason: string;
  link: string;
};

export function ownerNeedsHumanMessage(o: OwnerNeedsHumanInput): string {
  const who = o.customerName?.trim() ? `${o.customerName.trim()} (${displayPhone(o.customerPhone)})` : displayPhone(o.customerPhone);
  return [
    `🙋 ${who} needs a person`,
    `Reason: ${o.reason}`,
    "",
    "The bot is paused in this chat until you resume it (or 12 h pass with no reply).",
    `Reply: ${o.link}`,
  ].join("\n");
}

export type OwnerDisconnectedInput = { ownerName: string; businessName: string; link: string };

export function ownerDisconnectedEmail(o: OwnerDisconnectedInput): { subject: string; text: string } {
  return {
    subject: `WhatsApp disconnected for ${o.businessName}`,
    text: [
      `Hi ${firstNameOf(o.ownerName)},`,
      "",
      `The WhatsApp number connected to ${o.businessName} was disconnected, so your order bot can't reply to customers right now.`,
      "",
      `Reconnect it here (takes a minute): ${o.link}`,
    ].join("\n"),
  };
}
