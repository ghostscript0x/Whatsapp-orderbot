import { NextResponse } from "next/server";
import { z } from "zod";
import { route, parseJson, requireTenant, errors } from "@/lib/api";
import { rateLimit } from "@/lib/redis";
import { storeMessage } from "@/lib/conversations";
import { sendTenantText, WhatsAppNotConnectedError } from "@/lib/openwa";

type Params = { params: Promise<{ id: string }> };
const bodySchema = z.object({ body: z.string().trim().min(1, "Message can't be empty").max(4000) }).strict();

/** Staff reply: sends through the tenant's WhatsApp, stores it, and pauses the bot for this chat. */
export const POST = route(async (req, { params }: Params) => {
  const ctx = await requireTenant();
  const { id } = await params;
  const { body } = await parseJson(req, bodySchema);
  if (!(await rateLimit(`staff-reply:${ctx.tenantId}`, 60, 60))) throw errors.tooMany();

  const conversation = await ctx.db.conversation.findUnique({ where: { id }, select: { id: true, customer: { select: { waChatId: true } } } });
  if (!conversation) throw errors.notFound("Conversation");

  let sent: { messageId: string };
  try {
    sent = await sendTenantText(ctx.tenantId, conversation.customer.waChatId, body);
  } catch (err) {
    if (err instanceof WhatsAppNotConnectedError) {
      throw errors.conflict("WhatsApp is not connected. Reconnect it on the WhatsApp page, then send your reply again.");
    }
    throw err;
  }

  const message = await storeMessage(ctx.db, { conversationId: id, direction: "OUT", sender: "STAFF", body, waMessageId: sent.messageId });
  const now = new Date();
  await ctx.db.conversation.update({ where: { id }, data: { lastStaffReplyAt: now, botPaused: true, botPausedAt: now } });

  return NextResponse.json(
    { message: { id: message.id, direction: message.direction, sender: message.sender, type: message.type, body: message.body, mediaUrl: message.mediaUrl, createdAt: message.createdAt } },
    { status: 201 },
  );
});
