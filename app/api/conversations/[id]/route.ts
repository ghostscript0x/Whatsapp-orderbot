import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { route, parseJson, requireTenant, errors } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };
const MESSAGE_LIMIT = 100;

export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireTenant();
  const { id } = await params;
  const conversation = await ctx.db.conversation.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true, firstSeenAt: true, lastSeenAt: true, _count: { select: { orders: true } } } },
      messages: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: MESSAGE_LIMIT,
        select: { id: true, direction: true, sender: true, type: true, body: true, mediaUrl: true, createdAt: true },
      },
    },
  });
  if (!conversation) throw errors.notFound("Conversation");
  const { customer, messages, ...rest } = conversation;
  return NextResponse.json({
    conversation: {
      ...rest,
      customer: { id: customer.id, name: customer.name, phone: customer.phone, firstSeenAt: customer.firstSeenAt, lastSeenAt: customer.lastSeenAt, orderCount: customer._count.orders },
      messages: messages.reverse(),
    },
  });
});

const patchSchema = z
  .object({ botPaused: z.boolean().optional(), needsHuman: z.boolean().optional() })
  .strict()
  .refine((v) => v.botPaused !== undefined || v.needsHuman !== undefined, "Provide botPaused or needsHuman");

export const PATCH = route(async (req, { params }: Params) => {
  const ctx = await requireTenant();
  const { id } = await params;
  const input = await parseJson(req, patchSchema);

  const existing = await ctx.db.conversation.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw errors.notFound("Conversation");

  const data: Prisma.ConversationUpdateInput = {};
  if (input.needsHuman === true) data.needsHuman = true;
  if (input.needsHuman === false) Object.assign(data, { needsHuman: false, needsHumanNote: null });
  if (input.botPaused === true) Object.assign(data, { botPaused: true, botPausedAt: new Date() });
  // Handing the chat back to the bot also resolves the human request.
  if (input.botPaused === false) Object.assign(data, { botPaused: false, botPausedAt: null, needsHuman: false, needsHumanNote: null });

  const updated = await ctx.db.conversation.update({
    where: { id },
    data,
    select: { id: true, botPaused: true, botPausedAt: true, needsHuman: true, needsHumanNote: true },
  });
  return NextResponse.json({ conversation: updated });
});
