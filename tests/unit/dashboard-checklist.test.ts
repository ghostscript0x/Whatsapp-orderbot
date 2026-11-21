import { describe, expect, it } from "vitest";
import { isBusinessDetailsSet } from "@/components/home/data";

const base = { ownerAlertPhone: "2348012345678", deliveryAreas: "", paymentInstructions: "" };

describe("isBusinessDetailsSet", () => {
  it("false when settings row does not exist", () => {
    expect(isBusinessDetailsSet(null)).toBe(false);
  });

  it("false with only the defaults", () => {
    expect(isBusinessDetailsSet({ ownerAlertPhone: null, deliveryAreas: "", paymentInstructions: "" })).toBe(false);
  });

  it("false with alert phone but no delivery areas or payment instructions", () => {
    expect(isBusinessDetailsSet(base)).toBe(false);
  });

  it("false when the alert phone is missing or blank", () => {
    expect(isBusinessDetailsSet({ ...base, ownerAlertPhone: null, deliveryAreas: "Lekki" })).toBe(false);
    expect(isBusinessDetailsSet({ ...base, ownerAlertPhone: "   ", deliveryAreas: "Lekki" })).toBe(false);
  });

  it("whitespace-only text does not count", () => {
    expect(isBusinessDetailsSet({ ...base, deliveryAreas: "  \n ", paymentInstructions: "\t" })).toBe(false);
  });

  it("true with alert phone + delivery areas", () => {
    expect(isBusinessDetailsSet({ ...base, deliveryAreas: "Lekki, VI, Ikoyi" })).toBe(true);
  });

  it("true with alert phone + payment instructions", () => {
    expect(isBusinessDetailsSet({ ...base, paymentInstructions: "Transfer to GTBank 0123456789" })).toBe(true);
  });
});
