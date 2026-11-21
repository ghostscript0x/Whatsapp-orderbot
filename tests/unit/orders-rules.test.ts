import { describe, expect, it } from "vitest";
import {
  ORDER_STATUSES,
  OrderValidationError,
  checkTransition,
  csvCell,
  koboToDecimal,
  nextStatuses,
  normalizeOrderFields,
  normalizeOrderItems,
  normalizeOrderNumber,
  ordersToCsv,
  priceOrderLines,
  renderTemplate,
  statusTemplateFor,
  summarizeOrderItems,
  toCsv,
} from "../../lib/orders-rules";

describe("status transitions", () => {
  it("allows the forward path and cancellation before delivery", () => {
    expect(checkTransition("NEW", "CONFIRMED")).toBe("ok");
    expect(checkTransition("NEW", "CANCELLED")).toBe("ok");
    expect(checkTransition("CONFIRMED", "OUT_FOR_DELIVERY")).toBe("ok");
    expect(checkTransition("CONFIRMED", "CANCELLED")).toBe("ok");
    expect(checkTransition("OUT_FOR_DELIVERY", "DELIVERED")).toBe("ok");
    expect(checkTransition("OUT_FOR_DELIVERY", "CANCELLED")).toBe("ok");
  });

  it("treats same status as a no-op", () => {
    for (const s of ORDER_STATUSES) expect(checkTransition(s, s)).toBe("same");
  });

  it("rejects skipping, going backwards and leaving terminal states", () => {
    expect(checkTransition("NEW", "OUT_FOR_DELIVERY")).toBe("invalid");
    expect(checkTransition("NEW", "DELIVERED")).toBe("invalid");
    expect(checkTransition("CONFIRMED", "NEW")).toBe("invalid");
    expect(checkTransition("DELIVERED", "CANCELLED")).toBe("invalid");
    expect(checkTransition("CANCELLED", "NEW")).toBe("invalid");
    expect(nextStatuses("DELIVERED")).toEqual([]);
    expect(nextStatuses("CANCELLED")).toEqual([]);
  });

  it("never lists NEW as a target", () => {
    for (const s of ORDER_STATUSES) expect(nextStatuses(s)).not.toContain("NEW");
  });
});

describe("normalizeOrderItems", () => {
  it("merges duplicate product ids keeping first-seen order", () => {
    expect(
      normalizeOrderItems([
        { productId: "a", quantity: 2 },
        { productId: "b", quantity: 1 },
        { productId: "a", quantity: 3 },
      ]),
    ).toEqual([
      { productId: "a", quantity: 5 },
      { productId: "b", quantity: 1 },
    ]);
  });

  it.each([0, -1, 1.5, 100, Number.NaN])("rejects quantity %s", (quantity) => {
    expect(() => normalizeOrderItems([{ productId: "a", quantity }])).toThrow(OrderValidationError);
  });

  it("accepts the boundaries 1 and 99", () => {
    expect(
      normalizeOrderItems([
        { productId: "a", quantity: 1 },
        { productId: "b", quantity: 99 },
      ]),
    ).toHaveLength(2);
  });

  it("rejects a merged quantity over 99", () => {
    expect(() =>
      normalizeOrderItems([
        { productId: "a", quantity: 60 },
        { productId: "a", quantity: 40 },
      ]),
    ).toThrow(OrderValidationError);
  });

  it("rejects empty orders, blank ids and more than 30 lines", () => {
    expect(() => normalizeOrderItems([])).toThrow(OrderValidationError);
    expect(() => normalizeOrderItems([{ productId: " ", quantity: 1 }])).toThrow(OrderValidationError);
    const many = Array.from({ length: 31 }, (_, i) => ({ productId: `p${i}`, quantity: 1 }));
    expect(() => normalizeOrderItems(many)).toThrow(/at most 30/);
    expect(normalizeOrderItems(many.slice(0, 30))).toHaveLength(30);
  });
});

describe("normalizeOrderFields", () => {
  it("trims and requires name and address", () => {
    expect(normalizeOrderFields({ customerName: "  Ada ", deliveryAddress: " 1 Main St ", notes: " no onions " })).toEqual({
      customerName: "Ada",
      deliveryAddress: "1 Main St",
      notes: "no onions",
    });
    expect(() => normalizeOrderFields({ customerName: " ", deliveryAddress: "x" })).toThrow(/name/);
    expect(() => normalizeOrderFields({ customerName: "Ada", deliveryAddress: "" })).toThrow(/address/);
  });

  it("caps lengths", () => {
    expect(() => normalizeOrderFields({ customerName: "a".repeat(101), deliveryAddress: "x" })).toThrow(OrderValidationError);
    expect(() => normalizeOrderFields({ customerName: "a", deliveryAddress: "x".repeat(501) })).toThrow(OrderValidationError);
    expect(() => normalizeOrderFields({ customerName: "a", deliveryAddress: "x", notes: "n".repeat(1001) })).toThrow(OrderValidationError);
  });
});

describe("priceOrderLines", () => {
  const products = [
    { id: "rice", name: "Jollof Rice", priceKobo: 250000, available: true, deletedAt: null },
    { id: "coke", name: "Coke", priceKobo: 50000, available: true, deletedAt: null },
    { id: "off", name: "Suya", priceKobo: 100000, available: false, deletedAt: null },
    { id: "gone", name: "Moi Moi", priceKobo: 80000, available: true, deletedAt: new Date() },
  ];

  it("uses server prices and snapshots names", () => {
    const r = priceOrderLines(
      [
        { productId: "rice", quantity: 2 },
        { productId: "coke", quantity: 1 },
      ],
      products,
      150000,
    );
    expect(r.lines).toEqual([
      { productId: "rice", nameSnapshot: "Jollof Rice", unitPriceKobo: 250000, quantity: 2 },
      { productId: "coke", nameSnapshot: "Coke", unitPriceKobo: 50000, quantity: 1 },
    ]);
    expect(r.subtotalKobo).toBe(550000);
    expect(r.deliveryFeeKobo).toBe(150000);
    expect(r.totalKobo).toBe(700000);
  });

  it("names unavailable and deleted items", () => {
    expect(() => priceOrderLines([{ productId: "off", quantity: 1 }], products, 0)).toThrow('"Suya" is currently unavailable.');
    expect(() => priceOrderLines([{ productId: "gone", quantity: 1 }], products, 0)).toThrow('"Moi Moi" is no longer on the menu.');
  });

  it("rejects ids not in the tenant's product list", () => {
    expect(() => priceOrderLines([{ productId: "other-tenant", quantity: 1 }], products, 0)).toThrow(OrderValidationError);
  });
});

describe("order numbers", () => {
  it("normalizes user input", () => {
    expect(normalizeOrderNumber("1042")).toBe("ORD-1042");
    expect(normalizeOrderNumber(" ord-1042 ")).toBe("ORD-1042");
  });
});

describe("templates", () => {
  it("replaces known placeholders and keeps unknown ones", () => {
    expect(renderTemplate("{customerName}: {orderNumber} {total} {other}", { customerName: "Ada", orderNumber: "ORD-1", total: "N5" })).toBe(
      "Ada: ORD-1 N5 {other}",
    );
  });

  it("uses the owner's template, else a default; none for NEW", () => {
    expect(statusTemplateFor({ CONFIRMED: "Custom {orderNumber}" }, "CONFIRMED")).toBe("Custom {orderNumber}");
    expect(statusTemplateFor({ CONFIRMED: "  " }, "CONFIRMED")).toContain("{orderNumber}");
    expect(statusTemplateFor(null, "DELIVERED")).toContain("delivered");
    expect(statusTemplateFor([], "CANCELLED")).toContain("cancelled");
    expect(statusTemplateFor({}, "NEW")).toBeNull();
  });
});

describe("CSV", () => {
  it.each([
    ["=SUM(A1)", "'=SUM(A1)"],
    ["+2348012345678", "'+2348012345678"],
    ["-1", "'-1"],
    ["@cmd", "'@cmd"],
    ["\tx", "'\tx"],
  ])("neutralises formula injection in %j", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell('=1,"x"')).toBe(`"'=1,""x"""`);
    expect(csvCell(null)).toBe("");
    expect(csvCell(42)).toBe("42");
  });

  it("formats kobo exactly", () => {
    expect(koboToDecimal(0)).toBe("0.00");
    expect(koboToDecimal(5)).toBe("0.05");
    expect(koboToDecimal(150050)).toBe("1500.50");
  });

  it("builds an export with header and CRLF rows", () => {
    const csv = ordersToCsv(
      [
        {
          number: "ORD-1001",
          createdAt: new Date("2026-01-02T03:04:05Z"),
          status: "OUT_FOR_DELIVERY",
          customerName: '=HYPERLINK("x")',
          customerPhone: "2348012345678",
          deliveryAddress: "1 Main St, Lagos",
          items: [{ nameSnapshot: "Rice", quantity: 2, unitPriceKobo: 100 }],
          subtotalKobo: 200,
          deliveryFeeKobo: 50,
          totalKobo: 250,
          notes: "",
        },
      ],
      "NGN",
    );
    const [header, row, end] = csv.split("\r\n");
    expect(header.startsWith("Order number,Created at (UTC),Status")).toBe(true);
    expect(row).toBe(`ORD-1001,2026-01-02T03:04:05.000Z,Out for delivery,"'=HYPERLINK(""x"")",2348012345678,"1 Main St, Lagos",2 x Rice,2.00,0.50,2.50,`);
    expect(end).toBe("");
    expect(toCsv([["a"]])).toBe("a\r\n");
  });
});

describe("summarizeOrderItems", () => {
  const item = (quantity: number, nameSnapshot: string) => ({ quantity, nameSnapshot });

  it("lists every item when it fits", () => {
    expect(summarizeOrderItems([item(2, "Jollof Rice & Chicken"), item(1, "Chapman")])).toBe("2× Jollof Rice & Chicken, 1× Chapman");
    expect(summarizeOrderItems([])).toBe("");
  });

  it("drops whole items from the end with '+N more' and stays within the cap", () => {
    const items = Array.from({ length: 6 }, (_, i) => item(1, `Grilled Croaker Fish Platter ${i + 1}`));
    const s = summarizeOrderItems(items);
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s).toBe("1× Grilled Croaker Fish Platter 1, 1× Grilled Croaker Fish Platter 2, +4 more");
  });

  it("cuts a single overlong first item with an ellipsis", () => {
    const s = summarizeOrderItems([item(3, "X".repeat(120)), item(1, "Coke")], 40);
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s).toMatch(/^3× X+…, \+1 more$/);
  });
});
