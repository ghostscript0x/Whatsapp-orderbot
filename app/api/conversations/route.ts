import { NextResponse } from "next/server";
import { z } from "zod";
import { parseQuery, route, requireTenant } from "@/lib/api";
import { conversationCounts, listConversations } from "@/lib/conversations";

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const querySchema = z.object({
  needsHuman: bool.optional(),
  botPaused: bool.optional(),
  q: z.string().trim().max(50).optional(),
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/**
 * GET /api/conversations?needsHuman=true|false&botPaused=true|false&q=&cursor=&limit=
 * -> { conversations, nextCursor, counts: { needsHuman, botPaused } } (counts are tenant-wide, not filtered)
 */
export const GET = route(async (req) => {
  const ctx = await requireTenant();
  const { cursor, limit, ...filters } = parseQuery(req, querySchema);
  const [page, counts] = await Promise.all([listConversations(ctx.db, filters, { cursor, limit }), conversationCounts(ctx.db)]);
  return NextResponse.json({ ...page, counts });
});
