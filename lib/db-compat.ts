/**
 * Small shims so queries run on both SQLite (local, for now) and Postgres (later).
 *
 * Case-insensitive `contains`: Postgres needs `mode: "insensitive"`; SQLite rejects `mode`
 * but its LIKE is already case-insensitive for ASCII. Spread this into string filters:
 *   { name: { contains: q, ...insensitive() } }
 */
export function isSqlite(): boolean {
  return (process.env.DATABASE_URL ?? "").startsWith("file:");
}

export function insensitive(): object {
  return isSqlite() ? {} : { mode: "insensitive" };
}

/** True for Prisma's unique-constraint violation (P2002). */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}
