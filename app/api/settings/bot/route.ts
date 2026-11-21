import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { parseJson, requireTenant, route } from "@/lib/api";
import { toBotConfig, type BotConfig } from "@/lib/agent/config";
import { botSettingsInputSchema } from "@/lib/agent/settings-schema";

function toDto(config: BotConfig, canEdit: boolean) {
  return { settings: config, canEdit };
}

/** GET /api/settings/bot — OWNER and STAFF. Missing row = schema defaults. */
export const GET = route(async () => {
  const ctx = await requireTenant();
  const row = await ctx.db.botSettings.findFirst();
  return NextResponse.json(toDto(toBotConfig(row), ctx.role === "OWNER"));
});

/** PUT /api/settings/bot — OWNER only. Full replace of the editable settings. */
export const PUT = route(async (req: Request) => {
  const ctx = await requireTenant({ role: "OWNER" });
  // Parsed in two steps: the schema transforms (fee -> kobo), so its input and output types differ.
  const input = botSettingsInputSchema.parse(await parseJson(req, z.unknown()));
  const data = {
    botName: input.botName,
    tone: input.tone,
    greeting: input.greeting,
    businessHours: input.businessHours as Prisma.InputJsonValue,
    deliveryFeeKobo: input.deliveryFee,
    deliveryAreas: input.deliveryAreas,
    paymentInstructions: input.paymentInstructions,
    faq: input.faq,
    ownerAlertPhone: input.ownerAlertPhone,
    statusTemplates: input.statusTemplates as Prisma.InputJsonValue,
  };
  const row = await ctx.db.botSettings.upsert({
    where: { tenantId: ctx.tenantId },
    create: { tenantId: ctx.tenantId, ...data },
    update: data,
  });
  return NextResponse.json(toDto(toBotConfig(row), true));
});
