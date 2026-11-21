import { NextResponse } from "next/server";
import { errors, requireTenant, route } from "@/lib/api";
import { parseProductCsv } from "@/lib/products-csv";

/**
 * POST multipart/form-data with field `file` (CSV, <= 1 MB, <= 500 rows) (owner).
 * Columns: name, price (major units, e.g. 1500 or 1,500.50), description, category, image_url (or imageUrl).
 * Valid rows are created in one transaction; invalid rows are skipped and reported.
 * Missing categories are created (matched case-insensitively). Image URLs are stored as external images.
 * -> { created: number, errors: { row, message }[] } where row is the spreadsheet row (header = 1).
 */

const MAX_FILE_BYTES = 1024 * 1024;

export const POST = route(async (req: Request) => {
  const { db, tenantId } = await requireTenant({ role: "OWNER" });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw errors.badRequest("Send the CSV as multipart/form-data with a `file` field");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw errors.badRequest("Missing `file` field");
  if (file.size === 0) throw errors.badRequest("The file is empty");
  if (file.size > MAX_FILE_BYTES) throw errors.badRequest("CSV must be 1 MB or smaller");

  const { rows, errors: rowErrors } = parseProductCsv(await file.text());
  if (rows.length === 0) return NextResponse.json({ created: 0, errors: rowErrors });

  const created = await db.$transaction(
    async (tx) => {
      const existing = await tx.category.findMany({ select: { id: true, name: true, sortOrder: true } });
      const categoryIds = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]));
      let nextCategoryOrder = existing.reduce((max, c) => Math.max(max, c.sortOrder + 1), 0);

      for (const row of rows) {
        if (!row.category || categoryIds.has(row.category.toLowerCase())) continue;
        const category = await tx.category.create({ data: { tenantId, name: row.category, sortOrder: nextCategoryOrder++ } });
        categoryIds.set(row.category.toLowerCase(), category.id);
      }

      const max = await tx.product.aggregate({ where: { deletedAt: null }, _max: { sortOrder: true } });
      const baseOrder = (max._max.sortOrder ?? -1) + 1;

      for (const [i, row] of rows.entries()) {
        await tx.product.create({
          data: {
            tenantId,
            name: row.name,
            description: row.description,
            priceKobo: row.priceKobo,
            categoryId: row.category ? (categoryIds.get(row.category.toLowerCase()) ?? null) : null,
            sortOrder: baseOrder + i,
            // External image: url only, no stored object. Nested create needs tenantId explicitly.
            images: row.imageUrl ? { create: [{ tenantId, url: row.imageUrl, storageKey: "", position: 0 }] } : undefined,
          },
        });
      }
      return rows.length;
    },
    { timeout: 30_000 },
  );

  return NextResponse.json({ created, errors: rowErrors });
});
