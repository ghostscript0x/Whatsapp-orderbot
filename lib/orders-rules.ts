/**
 * Pure order/conversation rules shared by server code, the worker and client components.
 * No DB, Redis or Node-only imports here: this module is bundled into the browser.
 */
import type { OrderStatus } from "@prisma/client";

/** Message is safe to show to the AI model, the customer and dashboard users. */
export class OrderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderValidationError";
  }
}

export const ORDER_STATUSES = ["NEW", "CONFIRMED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"] as const satisfies readonly OrderStatus[];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: "New",
  CONFIRMED: "Confirmed",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  NEW: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["OUT_FOR_DELIVERY", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

/** Statuses an order in `from` may move to (excludes the no-op same status). */
export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from];
}

/** "same" = no-op, "ok" = allowed, "invalid" = reject. */
export function checkTransition(from: OrderStatus, to: OrderStatus): "same" | "ok" | "invalid" {
  if (from === to) return "same";
  return TRANSITIONS[from].includes(to) ? "ok" : "invalid";
}

// ---------- order input validation ----------

export const MAX_ORDER_LINES = 30;
export const MAX_LINE_QUANTITY = 99;
export const MAX_CUSTOMER_NAME = 100;
export const MAX_DELIVERY_ADDRESS = 500;
export const MAX_NOTES = 1000;

export type OrderLineInput = { productId: string; quantity: number };

/**
 * Validates quantities (integer 1..99 per request line and per merged line),
 * merges duplicate productIds (first-seen order kept) and caps the number of lines.
 */
export function normalizeOrderItems(items: OrderLineInput[]): OrderLineInput[] {
  if (!Array.isArray(items) || items.length === 0) throw new OrderValidationError("The order has no items.");
  const merged = new Map<string, number>();
  for (const item of items) {
    const productId = typeof item?.productId === "string" ? item.productId.trim() : "";
    if (!productId) throw new OrderValidationError("Every item needs a product id.");
    const q = item.quantity;
    if (!Number.isInteger(q) || q < 1 || q > MAX_LINE_QUANTITY) {
      throw new OrderValidationError(`Quantity must be a whole number from 1 to ${MAX_LINE_QUANTITY}.`);
    }
    const total = (merged.get(productId) ?? 0) + q;
    if (total > MAX_LINE_QUANTITY) {
      throw new OrderValidationError(`Quantity must be a whole number from 1 to ${MAX_LINE_QUANTITY}.`);
    }
    merged.set(productId, total);
  }
  if (merged.size > MAX_ORDER_LINES) throw new OrderValidationError(`An order can have at most ${MAX_ORDER_LINES} different items.`);
  return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
}

/** Trims and length-checks the free-text fields. */
export function normalizeOrderFields(input: { customerName: string; deliveryAddress: string; notes?: string }) {
  const customerName = (input.customerName ?? "").trim();
  const deliveryAddress = (input.deliveryAddress ?? "").trim();
  const notes = (input.notes ?? "").trim();
  if (!customerName) throw new OrderValidationError("The customer's name is required.");
  if (customerName.length > MAX_CUSTOMER_NAME) throw new OrderValidationError(`The name must be at most ${MAX_CUSTOMER_NAME} characters.`);
  if (!deliveryAddress) throw new OrderValidationError("The delivery address is required.");
  if (deliveryAddress.length > MAX_DELIVERY_ADDRESS) {
    throw new OrderValidationError(`The delivery address must be at most ${MAX_DELIVERY_ADDRESS} characters.`);
  }
  if (notes.length > MAX_NOTES) throw new OrderValidationError(`Notes must be at most ${MAX_NOTES} characters.`);
  return { customerName, deliveryAddress, notes };
}

export type ProductForOrder = { id: string; name: string; priceKobo: number; available: boolean; deletedAt: Date | null };
export type PricedLine = { productId: string; nameSnapshot: string; unitPriceKobo: number; quantity: number };

/**
 * Prices lines from server-side product rows. `products` must already be restricted to the tenant.
 * Throws OrderValidationError naming the offending item.
 */
export function priceOrderLines(lines: OrderLineInput[], products: ProductForOrder[], deliveryFeeKobo: number) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const priced: PricedLine[] = lines.map((line) => {
    const p = byId.get(line.productId);
    if (!p) throw new OrderValidationError(`Item "${line.productId}" is not on the menu.`);
    if (p.deletedAt) throw new OrderValidationError(`"${p.name}" is no longer on the menu.`);
    if (!p.available) throw new OrderValidationError(`"${p.name}" is currently unavailable.`);
    return { productId: p.id, nameSnapshot: p.name, unitPriceKobo: p.priceKobo, quantity: line.quantity };
  });
  const subtotalKobo = priced.reduce((sum, l) => sum + l.unitPriceKobo * l.quantity, 0);
  const fee = Math.max(0, Math.trunc(deliveryFeeKobo));
  return { lines: priced, subtotalKobo, deliveryFeeKobo: fee, totalKobo: subtotalKobo + fee };
}

/** "1042", "ord-1042", " ORD-1042 " -> "ORD-1042". */
export function normalizeOrderNumber(input: string): string {
  const s = input.trim().toUpperCase();
  return /^\d+$/.test(s) ? `ORD-${s}` : s;
}

// ---------- notification templates ----------

/**
 * Customer updates used when the owner hasn't written their own. Besides the owner-facing
 * {orderNumber} and {customerName}, defaults may use {firstName}, {total} and {businessName}.
 */
export const DEFAULT_STATUS_TEMPLATES: Record<Exclude<OrderStatus, "NEW">, string> = {
  CONFIRMED: "Hi {firstName}! 🎉 Your order {orderNumber} ({total}) is confirmed and the kitchen is on it. We'll message you as soon as it's on the way.",
  OUT_FOR_DELIVERY: "Good news, {firstName}! 🛵 Your order {orderNumber} is on its way to you now.",
  DELIVERED: "Your order {orderNumber} has been delivered. Enjoy, {firstName}! 😊 Thanks for ordering from {businessName}.",
  CANCELLED:
    "Hi {firstName}, your order {orderNumber} has been cancelled. If that's unexpected or you'd like to order again, just reply here and we'll sort it out.",
};

/** Replaces {placeholders} from `vars`; unknown placeholders are left as-is. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (Object.hasOwn(vars, key) ? vars[key] : match));
}

/** Picks the owner's template for `status` from BotSettings.statusTemplates (untrusted JSON), else the default. */
export function statusTemplateFor(statusTemplates: unknown, status: OrderStatus): string | null {
  if (status === "NEW") return null;
  if (statusTemplates && typeof statusTemplates === "object" && !Array.isArray(statusTemplates)) {
    const t = (statusTemplates as Record<string, unknown>)[status];
    if (typeof t === "string" && t.trim()) return t;
  }
  return DEFAULT_STATUS_TEMPLATES[status];
}

// ---------- list display ----------

export const ITEM_SUMMARY_MAX = 80;

/**
 * "2× Jollof Rice & Chicken, 1× Chapman" for order lists. When it would exceed `maxLength`,
 * whole items are dropped from the end and replaced by ", +N more"; if even the first item is
 * too long it is cut with "…".
 */
export function summarizeOrderItems(items: { quantity: number; nameSnapshot: string }[], maxLength = ITEM_SUMMARY_MAX): string {
  const parts = items.map((i) => `${i.quantity}× ${i.nameSnapshot.trim()}`);
  const full = parts.join(", ");
  if (full.length <= maxLength) return full;
  for (let shown = parts.length - 1; shown >= 1; shown--) {
    const s = `${parts.slice(0, shown).join(", ")}, +${parts.length - shown} more`;
    if (s.length <= maxLength) return s;
  }
  const suffix = parts.length > 1 ? `, +${parts.length - 1} more` : "";
  return `${parts[0].slice(0, Math.max(1, maxLength - suffix.length - 1)).trimEnd()}…${suffix}`;
}

// ---------- CSV ----------

/** Escapes one CSV cell and neutralises spreadsheet formula injection (=, +, -, @, tab, CR). */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Integer kobo -> "1500.50" (exact, no float rounding). */
export function koboToDecimal(kobo: number): string {
  const sign = kobo < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(kobo));
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export type OrderCsvRow = {
  number: string;
  createdAt: Date;
  status: OrderStatus;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  items: { nameSnapshot: string; quantity: number; unitPriceKobo: number }[];
  subtotalKobo: number;
  deliveryFeeKobo: number;
  totalKobo: number;
  notes: string;
};

export function ordersToCsv(orders: OrderCsvRow[], currency: string): string {
  const header = [
    "Order number",
    "Created at (UTC)",
    "Status",
    "Customer name",
    "Phone",
    "Delivery address",
    "Items",
    `Subtotal (${currency})`,
    `Delivery fee (${currency})`,
    `Total (${currency})`,
    "Notes",
  ];
  const rows = orders.map((o) => [
    o.number,
    o.createdAt.toISOString(),
    STATUS_LABELS[o.status],
    o.customerName,
    o.customerPhone,
    o.deliveryAddress,
    o.items.map((i) => `${i.quantity} x ${i.nameSnapshot}`).join("; "),
    koboToDecimal(o.subtotalKobo),
    koboToDecimal(o.deliveryFeeKobo),
    koboToDecimal(o.totalKobo),
    o.notes,
  ]);
  return toCsv([header, ...rows]);
}
