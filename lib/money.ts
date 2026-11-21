/** All money is integer kobo (minor units). Never use floats for stored amounts. */

export function formatMoney(kobo: number, currency = "NGN"): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(
    kobo / 100,
  );
}

/** Parses a user-entered major-unit amount ("1,500.50") to kobo. Returns null if invalid. */
export function parseToKobo(input: string | number): number | null {
  const s = String(input).replace(/[,\s₦]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
