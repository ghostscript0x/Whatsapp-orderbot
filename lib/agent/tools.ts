import { z, ZodError } from "zod";
import type { Customer, MessageDirection, MessageSender, OrderStatus } from "@prisma/client";
import type { Logger } from "pino";
import type { TenantDb } from "@/lib/tenant";
import type { LlmToolCall, ToolDef } from "@/lib/llm/types";
import { formatMoney } from "@/lib/money";
import { getAvailableProductsByIds, listAvailableProducts } from "@/lib/products";
import { OrderValidationError, createOrder, getCustomerOrders } from "@/lib/orders";
import { flagNeedsHuman, storeMessage } from "@/lib/conversations";
import { OpenWaError, sendTenantImage, WhatsAppNotConnectedError } from "@/lib/openwa";
import { betweenImagesMs } from "@/lib/humanize";
import type { BotConfig, TenantInfo } from "./config";

/** Minimal message shape the agent needs for history (DB rows and dry-run transcripts both fit). */
export type HistoryMessage = { direction: MessageDirection; sender: MessageSender; type: string; body: string };

export type AgentCustomer = Pick<Customer, "id" | "name" | "phone">;

export type AgentAction = { tool: string; ok: boolean; simulated: boolean; summary: string };

export type ToolContext = {
  tenantId: string;
  db: TenantDb;
  tenant: TenantInfo;
  settings: BotConfig;
  customer: AgentCustomer;
  conversationId: string;
  chatId: string;
  /** Messages before the current inbound one, oldest -> newest. */
  history: HistoryMessage[];
  /** When true, nothing is sent to WhatsApp and nothing is written (orders, flags, messages). */
  dryRun: boolean;
  log: Logger;
  state: { quotedThisRun: boolean; handedOff: boolean; actions: AgentAction[] };
  /** Waits between product photos so they arrive like a person sending them one by one. Omitted = no wait. */
  pause?: (ms: number) => Promise<void>;
};

/** A tool failure whose message is safe to show the model (and therefore the customer). */
export class ToolInputError extends Error {}

export const MAX_ORDER_LINES = 20;
export const MAX_QTY = 99;
export const MAX_IMAGES = 5;
const DUPLICATE_ORDER_WINDOW_MS = 10 * 60 * 1000;

const id = z.string().trim().min(1).max(64);
const itemsSchema = z
  .array(z.object({ productId: id, quantity: z.number().int().min(1).max(MAX_QTY) }).strict())
  .min(1)
  .max(MAX_ORDER_LINES);

export const toolArgSchemas = {
  list_products: z.object({ query: z.string().trim().max(100).optional(), category: z.string().trim().max(100).optional() }).strict(),
  send_product_images: z.object({ productIds: z.array(id).min(1).max(MAX_IMAGES) }).strict(),
  quote_order: z.object({ items: itemsSchema }).strict(),
  create_order: z
    .object({
      items: itemsSchema,
      customerName: z.string().trim().min(1).max(100),
      deliveryAddress: z.string().trim().min(5).max(500),
      notes: z.string().trim().max(500).optional(),
    })
    .strict(),
  get_order_status: z.object({ orderNumber: z.string().trim().max(30).optional() }).strict(),
  request_human: z.object({ reason: z.string().trim().min(1).max(500) }).strict(),
} as const;

export type ToolName = keyof typeof toolArgSchemas;

const itemsJson = {
  type: "array",
  minItems: 1,
  maxItems: MAX_ORDER_LINES,
  items: {
    type: "object",
    properties: {
      productId: { type: "string", description: "Product id from list_products" },
      quantity: { type: "integer", minimum: 1, maximum: MAX_QTY },
    },
    required: ["productId", "quantity"],
    additionalProperties: false,
  },
};

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "list_products",
    description: "Search the business's available products. Returns id, name, price, category, short description and whether a photo exists. Call this before mentioning any product or price.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional search text, e.g. 'jollof'" },
        category: { type: "string", description: "Optional category name" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "send_product_images",
    description: `Send product photos to the customer on WhatsApp (max ${MAX_IMAGES}). Each photo is captioned with the name, price and a short description.`,
    parameters: {
      type: "object",
      properties: { productIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: MAX_IMAGES } },
      required: ["productIds"],
      additionalProperties: false,
    },
  },
  {
    name: "quote_order",
    description: "Compute the exact order summary (line prices, subtotal, delivery fee, total) on the server WITHOUT placing the order. Use it to build the summary the customer must confirm.",
    parameters: { type: "object", properties: { items: itemsJson }, required: ["items"], additionalProperties: false },
  },
  {
    name: "create_order",
    description:
      "Place the order. Only call after the customer explicitly confirmed the quoted summary in their latest message. Returns the order number and server-computed total.",
    parameters: {
      type: "object",
      properties: {
        items: itemsJson,
        customerName: { type: "string" },
        deliveryAddress: { type: "string" },
        notes: { type: "string", description: "Optional delivery or cooking notes" },
      },
      required: ["items", "customerName", "deliveryAddress"],
      additionalProperties: false,
    },
  },
  {
    name: "get_order_status",
    description: "Get this customer's recent orders and their statuses, optionally one order number like ORD-1042.",
    parameters: { type: "object", properties: { orderNumber: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "request_human",
    description: "Hand the conversation to a human team member: pauses the bot and alerts the owner.",
    parameters: { type: "object", properties: { reason: { type: "string", description: "Short reason for the team" } }, required: ["reason"], additionalProperties: false },
  },
];

const STATUS_LABEL: Record<OrderStatus, string> = {
  NEW: "received, waiting for confirmation",
  CONFIRMED: "confirmed",
  OUT_FOR_DELIVERY: "out for delivery",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
};

type Item = { productId: string; quantity: number };

function mergeItems(items: Item[]): Item[] {
  const byId = new Map<string, number>();
  for (const i of items) byId.set(i.productId, (byId.get(i.productId) ?? 0) + i.quantity);
  const merged = [...byId].map(([productId, quantity]) => ({ productId, quantity }));
  if (merged.some((i) => i.quantity > MAX_QTY)) throw new ToolInputError(`Maximum quantity per product is ${MAX_QTY}.`);
  return merged;
}

/** Server-side pricing for a cart. Same product/price/fee sources as createOrder. */
export async function quoteItems(ctx: ToolContext, items: Item[]) {
  const merged = mergeItems(items);
  const products = await getAvailableProductsByIds(ctx.db, merged.map((i) => i.productId));
  const byId = new Map(products.map((p) => [p.id, p]));
  const missing = merged.filter((i) => !byId.has(i.productId)).map((i) => i.productId);
  if (missing.length) {
    throw new ToolInputError(`Not available: ${missing.join(", ")}. Call list_products to get current product ids.`);
  }
  const lines = merged.map((i) => {
    const p = byId.get(i.productId)!;
    return { productId: p.id, name: p.name, quantity: i.quantity, unitPriceKobo: p.priceKobo, lineTotalKobo: p.priceKobo * i.quantity };
  });
  const subtotalKobo = lines.reduce((s, l) => s + l.lineTotalKobo, 0);
  const deliveryFeeKobo = ctx.settings.deliveryFeeKobo;
  return { lines, subtotalKobo, deliveryFeeKobo, totalKobo: subtotalKobo + deliveryFeeKobo };
}

/** True when `text` mentions `kobo` as a money amount (e.g. "₦3,500", "3500.00"). */
export function mentionsAmount(text: string, kobo: number): boolean {
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d{1,2})?/g)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n) && Math.round(n * 100) === kobo) return true;
  }
  return false;
}

/**
 * Deterministic confirmation guard: the order total must have been shown to the customer in
 * the bot's last turn before the current inbound message, and not just quoted in this
 * same run (which would mean the customer never saw it).
 */
function assertSummaryShown(ctx: ToolContext, totalKobo: number, total: string) {
  // The bot's last turn = the text messages it sent after the customer's previous message.
  const lastIn = ctx.history.map((m) => m.direction).lastIndexOf("IN");
  const lastBotTurn = ctx.history.slice(lastIn + 1).filter((m) => m.direction === "OUT" && m.type === "text");
  if (ctx.state.quotedThisRun || !lastBotTurn.some((m) => mentionsAmount(m.body, totalKobo))) {
    throw new ToolInputError(
      `Order NOT placed. First send the customer the full summary (items, quantities, delivery fee, total ${total}, name, address) and ask them to confirm. Call create_order only after they reply yes.`,
    );
  }
}

const money = (ctx: ToolContext, kobo: number) => formatMoney(kobo, ctx.tenant.currency);

const CAPTION_DESC_CHARS = 90;

/** "*Jollof Rice* — ₦1,500" plus the first sentence of the description when it is short. */
export function productCaption(name: string, price: string, description?: string | null): string {
  const head = `*${name}* — ${price}`;
  const firstSentence = (description ?? "").trim().split(/(?<=[.!?])\s/)[0]?.trim() ?? "";
  return firstSentence && firstSentence.length <= CAPTION_DESC_CHARS ? `${head}\n${firstSentence}` : head;
}

function quoteView(ctx: ToolContext, q: Awaited<ReturnType<typeof quoteItems>>) {
  return {
    items: q.lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity, unitPrice: money(ctx, l.unitPriceKobo), lineTotal: money(ctx, l.lineTotalKobo) })),
    subtotal: money(ctx, q.subtotalKobo),
    deliveryFee: money(ctx, q.deliveryFeeKobo),
    total: money(ctx, q.totalKobo),
  };
}

function record(ctx: ToolContext, action: AgentAction) {
  ctx.state.actions.push(action);
}

type Handlers = { [K in ToolName]: (ctx: ToolContext, args: z.infer<(typeof toolArgSchemas)[K]>) => Promise<unknown> };

const handlers: Handlers = {
  async list_products(ctx, args) {
    const products = await listAvailableProducts(ctx.db, { query: args.query || undefined, category: args.category || undefined, limit: 30 });
    record(ctx, { tool: "list_products", ok: true, simulated: false, summary: `Found ${products.length} product(s)` });
    if (!products.length) return { products: [], note: "No matching products. Try without a query, or tell the customer it isn't available." };
    return {
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        price: money(ctx, p.priceKobo),
        category: p.category,
        description: p.description.length > 160 ? `${p.description.slice(0, 160)}…` : p.description,
        hasImage: Boolean(p.coverImageUrl),
      })),
    };
  },

  async send_product_images(ctx, args) {
    const products = await getAvailableProductsByIds(ctx.db, args.productIds.slice(0, MAX_IMAGES));
    const found = new Set(products.map((p) => p.id));
    const sent: string[] = [];
    const noImage: string[] = [];
    const failed: string[] = [];
    for (const p of products) {
      if (!p.coverImageUrl) {
        noImage.push(p.name);
        continue;
      }
      const caption = productCaption(p.name, money(ctx, p.priceKobo), p.description);
      if (!ctx.dryRun) {
        if (sent.length > 0) await ctx.pause?.(betweenImagesMs());
        let messageId: string;
        try {
          ({ messageId } = await sendTenantImage(ctx.tenantId, ctx.chatId, p.coverImageUrl, caption));
        } catch (err) {
          // A photo the gateway can't deliver must not sink the whole reply (a job retry would
          // re-run the model and repeat text). Tell the model so it can describe the item instead.
          if (!(err instanceof OpenWaError || err instanceof WhatsAppNotConnectedError)) throw err;
          failed.push(p.name);
          continue;
        }
        await storeMessage(ctx.db, { conversationId: ctx.conversationId, direction: "OUT", sender: "BOT", type: "image", body: caption, mediaUrl: p.coverImageUrl, waMessageId: messageId });
      }
      sent.push(p.name);
    }
    record(ctx, {
      tool: "send_product_images",
      ok: failed.length === 0,
      simulated: ctx.dryRun,
      summary: ctx.dryRun
        ? `DRY RUN: would send ${sent.length} photo(s): ${sent.join(", ") || "none"}`
        : `Sent ${sent.length} photo(s)${failed.length ? `, ${failed.length} failed` : ""}`,
    });
    return {
      ...(ctx.dryRun ? { simulated: true, note: "DRY RUN: photos were not actually sent." } : {}),
      sent,
      noImage,
      ...(failed.length
        ? { failed, note: "Some photos couldn't be sent right now. Don't retry them; describe those items briefly in words instead." }
        : {}),
      notFound: args.productIds.filter((pid) => !found.has(pid)),
    };
  },

  async quote_order(ctx, args) {
    const q = await quoteItems(ctx, args.items);
    ctx.state.quotedThisRun = true;
    record(ctx, { tool: "quote_order", ok: true, simulated: false, summary: `Quoted total ${money(ctx, q.totalKobo)}` });
    return { ...quoteView(ctx, q), note: "Not placed yet. Show this summary to the customer and ask them to confirm." };
  },

  async create_order(ctx, args) {
    const q = await quoteItems(ctx, args.items);
    assertSummaryShown(ctx, q.totalKobo, money(ctx, q.totalKobo));

    if (ctx.dryRun) {
      record(ctx, { tool: "create_order", ok: true, simulated: true, summary: `DRY RUN: would place order, total ${money(ctx, q.totalKobo)}` });
      return { simulated: true, note: "DRY RUN: no order was saved.", orderNumber: "ORD-TEST", status: STATUS_LABEL.NEW, ...quoteView(ctx, q) };
    }

    // A retried job (or a repeated "yes") must not create the same order twice.
    const [latest] = await getCustomerOrders(ctx.db, ctx.customer.id);
    if (
      latest &&
      latest.status === "NEW" &&
      Date.now() - latest.createdAt.getTime() < DUPLICATE_ORDER_WINDOW_MS &&
      latest.totalKobo === q.totalKobo &&
      latest.items.length === q.lines.length &&
      q.lines.every((l) => latest.items.some((i) => i.productId === l.productId && i.quantity === l.quantity))
    ) {
      record(ctx, { tool: "create_order", ok: true, simulated: false, summary: `Already placed as ${latest.number}` });
      return { alreadyPlaced: true, orderNumber: latest.number, total: money(ctx, latest.totalKobo), status: STATUS_LABEL[latest.status] };
    }

    const order = await createOrder(ctx.tenantId, {
      customerId: ctx.customer.id,
      items: q.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      customerName: args.customerName,
      deliveryAddress: args.deliveryAddress,
      notes: args.notes,
    });
    record(ctx, { tool: "create_order", ok: true, simulated: false, summary: `Placed ${order.number}` });
    return {
      orderNumber: order.number,
      subtotal: money(ctx, order.subtotalKobo),
      deliveryFee: money(ctx, order.deliveryFeeKobo),
      total: money(ctx, order.totalKobo),
      status: STATUS_LABEL[order.status],
    };
  },

  async get_order_status(ctx, args) {
    const orders = await getCustomerOrders(ctx.db, ctx.customer.id, args.orderNumber || undefined);
    record(ctx, { tool: "get_order_status", ok: true, simulated: false, summary: `Found ${orders.length} order(s)` });
    const date = new Intl.DateTimeFormat("en-GB", { timeZone: ctx.tenant.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    return {
      orders: orders.map((o) => ({
        orderNumber: o.number,
        status: STATUS_LABEL[o.status],
        total: money(ctx, o.totalKobo),
        placedAt: date.format(o.createdAt),
        items: o.items.map((i) => `${i.quantity}x ${i.nameSnapshot}`),
      })),
      ...(orders.length ? {} : { note: args.orderNumber ? "No order with that number for this customer." : "This customer has no orders yet." }),
    };
  },

  async request_human(ctx, args) {
    ctx.state.handedOff = true;
    if (ctx.dryRun) {
      record(ctx, { tool: "request_human", ok: true, simulated: true, summary: `DRY RUN: would alert the team (${args.reason})` });
      return { simulated: true, note: "DRY RUN: the team was not alerted.", handedOff: true };
    }
    await flagNeedsHuman(ctx.db, ctx.tenantId, ctx.conversationId, args.reason);
    record(ctx, { tool: "request_human", ok: true, simulated: false, summary: "Team alerted, bot paused" });
    return { handedOff: true, note: "The team was alerted and the bot is paused for this chat. Tell the customer someone will reply soon." };
  },
};

function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(toolArgSchemas, name);
}

/**
 * Validates and runs one tool call. Expected failures (bad arguments, validation errors) are
 * returned to the model as `{ error }` so it can recover; anything else is thrown.
 */
export async function executeToolCall(ctx: ToolContext, call: LlmToolCall): Promise<string> {
  const fail = (message: string) => {
    record(ctx, { tool: call.name, ok: false, simulated: ctx.dryRun, summary: message });
    ctx.log.info({ tool: call.name, error: message }, "tool call rejected");
    return JSON.stringify({ error: message });
  };

  if (!isToolName(call.name)) return fail(`Unknown tool "${call.name}".`);

  let raw: unknown;
  try {
    raw = JSON.parse(call.arguments || "{}");
  } catch {
    return fail("Arguments were not valid JSON.");
  }

  try {
    const args = toolArgSchemas[call.name].parse(raw);
    const result = await (handlers[call.name] as (c: ToolContext, a: unknown) => Promise<unknown>)(ctx, args);
    return JSON.stringify(result);
  } catch (err) {
    if (err instanceof ZodError) return fail(`Invalid arguments: ${err.issues.map((i) => `${i.path.join(".") || "args"} ${i.message}`).join("; ")}`);
    if (err instanceof ToolInputError || err instanceof OrderValidationError) return fail(err.message);
    throw err;
  }
}
