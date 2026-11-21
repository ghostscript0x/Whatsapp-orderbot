import { describe, expect, it } from "vitest";
import {
  customerStatusMessage,
  firstNameOf,
  ownerDisconnectedEmail,
  ownerNeedsHumanMessage,
  ownerNewOrderMessage,
} from "@/lib/notification-messages";

const base = { statusTemplates: {}, orderNumber: "ORD-1042", customerName: "ada obi", total: "₦6,100", businessName: "Mama's Kitchen" };

describe("firstNameOf", () => {
  it("takes and capitalises the first word, falling back to 'there'", () => {
    expect(firstNameOf("ada  obi")).toBe("Ada");
    expect(firstNameOf("  Chidi")).toBe("Chidi");
    expect(firstNameOf("")).toBe("there");
    expect(firstNameOf(null)).toBe("there");
  });
});

describe("customerStatusMessage", () => {
  it("greets by first name with a friendly default for each status", () => {
    expect(customerStatusMessage({ ...base, status: "CONFIRMED" })).toBe(
      "Hi Ada! 🎉 Your order ORD-1042 (₦6,100) is confirmed and the kitchen is on it. We'll message you as soon as it's on the way.",
    );
    expect(customerStatusMessage({ ...base, status: "OUT_FOR_DELIVERY" })).toContain("Ada! 🛵 Your order ORD-1042 is on its way");
    expect(customerStatusMessage({ ...base, status: "DELIVERED" })).toContain("Thanks for ordering from Mama's Kitchen.");
    expect(customerStatusMessage({ ...base, status: "CANCELLED" })).toMatch(/^Hi Ada, your order ORD-1042 has been cancelled\./);
  });

  it("has no message for NEW (the bot confirms the order in chat)", () => {
    expect(customerStatusMessage({ ...base, status: "NEW" })).toBeNull();
  });

  it("uses the owner's template when set, leaving no placeholder unrendered", () => {
    const msg = customerStatusMessage({
      ...base,
      status: "CONFIRMED",
      statusTemplates: { CONFIRMED: "  {customerName}, {orderNumber} is confirmed.  " },
    });
    expect(msg).toBe("ada obi, ORD-1042 is confirmed.");
  });

  it("never leaves a placeholder in any default message", () => {
    for (const status of ["CONFIRMED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"] as const) {
      expect(customerStatusMessage({ ...base, status })).not.toMatch(/\{\w+\}/);
    }
  });
});

describe("owner alerts", () => {
  it("new-order alert leads with number and total, one fact per line, link last", () => {
    const text = ownerNewOrderMessage({
      orderNumber: "ORD-1042",
      total: "₦6,100",
      deliveryFee: "₦500",
      items: [
        { quantity: 2, name: "Jollof Rice", lineTotal: "₦5,000" },
        { quantity: 2, name: "Coke", lineTotal: "₦600" },
      ],
      customerName: "Ada Obi",
      customerPhone: "2348000000001",
      deliveryAddress: "1 Main St, Yaba",
      notes: "",
      link: "https://app.test/dashboard/orders/o1",
    });
    const lines = text.split("\n");
    expect(lines[0]).toBe("🛒 New order ORD-1042 · ₦6,100");
    expect(text).toContain("2 × Jollof Rice — ₦5,000\n2 × Coke — ₦600\nDelivery — ₦500");
    expect(text).toContain("👤 Ada Obi · +2348000000001\n📍 1 Main St, Yaba");
    expect(text).not.toContain("📝");
    expect(lines.at(-1)).toBe("Open: https://app.test/dashboard/orders/o1");
  });

  it("new-order alert shows notes and omits a zero delivery fee", () => {
    const text = ownerNewOrderMessage({
      orderNumber: "ORD-1",
      total: "₦300",
      deliveryFee: null,
      items: [{ quantity: 1, name: "Coke", lineTotal: "₦300" }],
      customerName: "Ada",
      customerPhone: "234800",
      deliveryAddress: "x",
      notes: " no ice ",
      link: "l",
    });
    expect(text).toContain("📝 no ice");
    expect(text).not.toContain("Delivery");
  });

  it("needs-human alert names the customer when known", () => {
    expect(ownerNeedsHumanMessage({ customerName: "Ada", customerPhone: "234800", reason: "Wants a refund", link: "l" })).toMatch(
      /^🙋 Ada \(\+234800\) needs a person\nReason: Wants a refund\n/,
    );
    expect(ownerNeedsHumanMessage({ customerName: null, customerPhone: "234800", reason: "r", link: "l" })).toMatch(/^🙋 \+234800 needs a person/);
  });

  it("disconnected email greets the owner by first name and links to reconnect", () => {
    const { subject, text } = ownerDisconnectedEmail({ ownerName: "Bola Ade", businessName: "Mama's Kitchen", link: "https://app.test/dashboard/whatsapp" });
    expect(subject).toBe("WhatsApp disconnected for Mama's Kitchen");
    expect(text).toMatch(/^Hi Bola,/);
    expect(text).toContain("https://app.test/dashboard/whatsapp");
  });
});
