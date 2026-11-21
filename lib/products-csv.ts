import Papa from "papaparse";
import { parseToKobo } from "./money";

/** Limits shared by the CSV importer and the product API. */
export const PRODUCT_LIMITS = {
  nameMax: 120,
  descriptionMax: 1000,
  categoryNameMax: 60,
  urlMax: 1000,
  /** 10,000,000.00 in major units; well inside a Postgres INT of kobo. */
  priceKoboMax: 1_000_000_000,
} as const;

export const CSV_MAX_ROWS = 500;

/** Images per product; the first is the cover. Lives here because this module is safe to import in client code. */
export const MAX_PRODUCT_IMAGES = 5;

export type CsvProductRow = {
  /** Spreadsheet row number (header is row 1, first product is row 2). */
  row: number;
  name: string;
  priceKobo: number;
  description: string;
  category: string | null;
  imageUrl: string | null;
};

export type CsvRowError = { row: number; message: string };

export type CsvParseResult = { rows: CsvProductRow[]; errors: CsvRowError[] };

type Column = "name" | "price" | "description" | "category" | "imageUrl";

const HEADER_ALIASES: Record<string, Column> = {
  name: "name",
  price: "price",
  description: "description",
  category: "category",
  image_url: "imageUrl",
  imageurl: "imageUrl",
  "image url": "imageUrl",
  image: "imageUrl",
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase();
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Parses and validates a product CSV. Pure: no DB access.
 * A file-level problem (no header, missing columns, too many rows) is returned as a row-0 or row-1 error
 * with no rows, so nothing is imported.
 */
export function parseProductCsv(text: string): CsvParseResult {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { header: false, skipEmptyLines: false });
  const lines = parsed.data;
  const errors: CsvRowError[] = [];

  const header = lines[0];
  if (!header || header.every((c) => c.trim() === "")) {
    return { rows: [], errors: [{ row: 1, message: "The file is empty or has no header row" }] };
  }

  const columnIndex = new Map<Column, number>();
  header.forEach((h, i) => {
    const col = HEADER_ALIASES[normalizeHeader(h)];
    if (col && !columnIndex.has(col)) columnIndex.set(col, i);
  });
  const missing = (["name", "price"] as const).filter((c) => !columnIndex.has(c));
  if (missing.length) {
    return { rows: [], errors: [{ row: 1, message: `Missing required column(s): ${missing.join(", ")}` }] };
  }

  const dataLines = lines
    .map((cells, i) => ({ cells, row: i + 1 }))
    .slice(1)
    .filter(({ cells }) => cells.some((c) => c.trim() !== ""));
  if (dataLines.length === 0) {
    return { rows: [], errors: [{ row: 2, message: "The file has no product rows" }] };
  }
  if (dataLines.length > CSV_MAX_ROWS) {
    return { rows: [], errors: [{ row: 0, message: `Too many rows: ${dataLines.length} (max ${CSV_MAX_ROWS})` }] };
  }

  const parseErrorRows = new Map<number, string>();
  for (const e of parsed.errors) {
    if (typeof e.row === "number") parseErrorRows.set(e.row + 1, e.message);
  }

  const rows: CsvProductRow[] = [];
  for (const { cells, row } of dataLines) {
    const parseError = parseErrorRows.get(row);
    if (parseError) {
      errors.push({ row, message: `Could not read row: ${parseError}` });
      continue;
    }
    const get = (c: Column) => {
      const i = columnIndex.get(c);
      return i === undefined ? "" : (cells[i] ?? "").trim();
    };
    const result = validateRow(row, {
      name: get("name"),
      price: get("price"),
      description: get("description"),
      category: get("category"),
      imageUrl: get("imageUrl"),
    });
    if ("message" in result) errors.push(result);
    else rows.push(result);
  }
  return { rows, errors };
}

function validateRow(row: number, raw: Record<Column, string>): CsvProductRow | CsvRowError {
  const fail = (message: string): CsvRowError => ({ row, message });

  if (!raw.name) return fail("Name is required");
  if (raw.name.length > PRODUCT_LIMITS.nameMax) return fail(`Name is longer than ${PRODUCT_LIMITS.nameMax} characters`);

  if (!raw.price) return fail("Price is required");
  const priceKobo = parseToKobo(raw.price);
  if (priceKobo === null) return fail(`Price "${raw.price}" is not a valid amount (use e.g. 1500 or 1,500.50)`);
  if (priceKobo <= 0) return fail("Price must be greater than 0");
  if (priceKobo > PRODUCT_LIMITS.priceKoboMax) return fail("Price is too large");

  if (raw.description.length > PRODUCT_LIMITS.descriptionMax) {
    return fail(`Description is longer than ${PRODUCT_LIMITS.descriptionMax} characters`);
  }
  if (raw.category.length > PRODUCT_LIMITS.categoryNameMax) {
    return fail(`Category is longer than ${PRODUCT_LIMITS.categoryNameMax} characters`);
  }
  if (raw.imageUrl) {
    if (raw.imageUrl.length > PRODUCT_LIMITS.urlMax) return fail("Image URL is too long");
    if (!isHttpUrl(raw.imageUrl)) return fail("Image URL must start with http:// or https://");
  }

  return {
    row,
    name: raw.name,
    priceKobo,
    description: raw.description,
    category: raw.category || null,
    imageUrl: raw.imageUrl || null,
  };
}
