import { NextResponse } from "next/server";
import { z } from "zod";
import { errors, parseJson, requireTenant, route } from "@/lib/api";
import { isPrismaError, type CategoryDto } from "@/lib/products";
import { PRODUCT_LIMITS } from "@/lib/products-csv";

/**
 * Categories of the active tenant.
 * GET    -> { categories: CategoryDto[] } (any member)
 * POST   { name, sortOrder? } -> { category } (owner)
 * PATCH  { id, name?, sortOrder? } -> { category } (owner)
 * DELETE { id } -> { ok: true } (owner; products in it become uncategorised)
 * PATCH/DELETE also accept the id as `?id=` when it is not in the body.
 */

const name = z.string().trim().min(1, "Name is required").max(PRODUCT_LIMITS.categoryNameMax);
const sortOrder = z.number().int().min(-100000).max(100000);
const createSchema = z.object({ name, sortOrder: sortOrder.optional() });
const updateSchema = z
  .object({ id: z.string().min(1).optional(), name: name.optional(), sortOrder: sortOrder.optional() })
  .refine((v) => v.name !== undefined || v.sortOrder !== undefined, "Nothing to update");
const deleteSchema = z.object({ id: z.string().min(1).optional() });

function idFrom(req: Request, bodyId: string | undefined): string {
  const id = bodyId ?? new URL(req.url).searchParams.get("id");
  if (!id) throw errors.badRequest("Category id is required (body.id or ?id=)");
  return id;
}

async function readOptionalJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw errors.badRequest("Body must be valid JSON");
  }
}

function duplicate(err: unknown): never {
  if (isPrismaError(err, "P2002")) throw errors.conflict("A category with that name already exists");
  throw err;
}

export const GET = route(async () => {
  const { db } = await requireTenant();
  const rows = await db.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { products: { where: { deletedAt: null } } } } },
  });
  const categories: CategoryDto[] = rows.map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder, productCount: c._count.products }));
  return NextResponse.json({ categories });
});

export const POST = route(async (req: Request) => {
  const { db, tenantId } = await requireTenant({ role: "OWNER" });
  const input = await parseJson(req, createSchema);
  let order = input.sortOrder;
  if (order === undefined) {
    const max = await db.category.aggregate({ _max: { sortOrder: true } });
    order = (max._max.sortOrder ?? -1) + 1;
  }
  const category = await db.category
    .create({ data: { tenantId, name: input.name, sortOrder: order } })
    .catch(duplicate);
  return NextResponse.json({ category: { id: category.id, name: category.name, sortOrder: category.sortOrder, productCount: 0 } }, { status: 201 });
});

export const PATCH = route(async (req: Request) => {
  const { db } = await requireTenant({ role: "OWNER" });
  const input = updateSchema.parse(await readOptionalJson(req));
  const id = idFrom(req, input.id);
  const existing = await db.category.findFirst({ where: { id }, select: { id: true } });
  if (!existing) throw errors.notFound("Category");
  const category = await db.category
    .update({ where: { id }, data: { name: input.name, sortOrder: input.sortOrder } })
    .catch(duplicate);
  return NextResponse.json({ category: { id: category.id, name: category.name, sortOrder: category.sortOrder } });
});

export const DELETE = route(async (req: Request) => {
  const { db } = await requireTenant({ role: "OWNER" });
  const input = deleteSchema.parse(await readOptionalJson(req));
  const id = idFrom(req, input.id);
  const { count } = await db.category.deleteMany({ where: { id } });
  if (count === 0) throw errors.notFound("Category");
  return NextResponse.json({ ok: true });
});
