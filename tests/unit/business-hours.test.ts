import { describe, expect, it } from "vitest";
import { businessHoursSchema, describeBusinessHours, isOpenNow, isValidTimezone } from "@/lib/business-hours";

// 2026-11-23 is a Monday, 2026-11-24 a Tuesday, 2026-11-29 a Sunday.
const at = (iso: string) => new Date(iso);

describe("isOpenNow", () => {
  it("treats an empty object as always open", () => {
    expect(isOpenNow({}, "UTC", at("2026-11-23T03:00:00Z"))).toBe(true);
  });

  it("treats null/undefined/malformed values as always open", () => {
    expect(isOpenNow(null, "UTC", at("2026-11-23T03:00:00Z"))).toBe(true);
    expect(isOpenNow(undefined, "UTC", at("2026-11-23T03:00:00Z"))).toBe(true);
    expect(isOpenNow({ mon: "9-5" }, "UTC", at("2026-11-23T03:00:00Z"))).toBe(true);
  });

  const weekday = { mon: [{ open: "09:00", close: "18:00" }] };

  it("is open inside a range and closed outside it (close is exclusive)", () => {
    expect(isOpenNow(weekday, "UTC", at("2026-11-23T08:59:00Z"))).toBe(false);
    expect(isOpenNow(weekday, "UTC", at("2026-11-23T09:00:00Z"))).toBe(true);
    expect(isOpenNow(weekday, "UTC", at("2026-11-23T17:59:00Z"))).toBe(true);
    expect(isOpenNow(weekday, "UTC", at("2026-11-23T18:00:00Z"))).toBe(false);
  });

  it("is closed on days that are missing or empty once any day is configured", () => {
    expect(isOpenNow(weekday, "UTC", at("2026-11-24T12:00:00Z"))).toBe(false);
    expect(isOpenNow({ ...weekday, tue: [] }, "UTC", at("2026-11-24T12:00:00Z"))).toBe(false);
  });

  it("uses the tenant timezone (Lagos is UTC+1)", () => {
    // 08:30 UTC = 09:30 in Lagos.
    expect(isOpenNow(weekday, "Africa/Lagos", at("2026-11-23T08:30:00Z"))).toBe(true);
    expect(isOpenNow(weekday, "UTC", at("2026-11-23T08:30:00Z"))).toBe(false);
  });

  it("handles overnight ranges on the same day and spilling into the next day", () => {
    const late = { mon: [{ open: "18:00", close: "02:00" }] };
    expect(isOpenNow(late, "UTC", at("2026-11-23T23:30:00Z"))).toBe(true); // Monday night
    expect(isOpenNow(late, "UTC", at("2026-11-24T01:59:00Z"))).toBe(true); // Tuesday early morning
    expect(isOpenNow(late, "UTC", at("2026-11-24T02:00:00Z"))).toBe(false);
    expect(isOpenNow(late, "UTC", at("2026-11-23T17:00:00Z"))).toBe(false);
  });

  it("wraps Sunday overnight into Monday", () => {
    const sun = { sun: [{ open: "20:00", close: "01:00" }] };
    expect(isOpenNow(sun, "UTC", at("2026-11-29T21:00:00Z"))).toBe(true);
    expect(isOpenNow(sun, "UTC", at("2026-11-30T00:30:00Z"))).toBe(true);
  });

  it("supports multiple ranges and a 24:00 close", () => {
    const split = { mon: [{ open: "08:00", close: "11:00" }, { open: "17:00", close: "24:00" }] };
    expect(isOpenNow(split, "UTC", at("2026-11-23T12:00:00Z"))).toBe(false);
    expect(isOpenNow(split, "UTC", at("2026-11-23T23:59:00Z"))).toBe(true);
    expect(isOpenNow(split, "UTC", at("2026-11-24T00:00:00Z"))).toBe(false);
  });

  it("throws for an invalid timezone instead of guessing", () => {
    expect(() => isOpenNow(weekday, "Not/AZone", at("2026-11-23T12:00:00Z"))).toThrow(RangeError);
  });
});

describe("businessHoursSchema", () => {
  it("accepts valid hours and rejects bad shapes", () => {
    expect(businessHoursSchema.safeParse({ mon: [{ open: "09:00", close: "18:00" }], sun: [] }).success).toBe(true);
    expect(businessHoursSchema.safeParse({ mon: [{ open: "9:00", close: "18:00" }] }).success).toBe(false);
    expect(businessHoursSchema.safeParse({ mon: [{ open: "09:00", close: "09:00" }] }).success).toBe(false);
    expect(businessHoursSchema.safeParse({ monday: [] }).success).toBe(false);
    expect(businessHoursSchema.safeParse({ mon: [{ open: "24:00", close: "10:00" }] }).success).toBe(false);
  });
});

describe("helpers", () => {
  it("describes the week for the prompt", () => {
    expect(describeBusinessHours({})).toBe("Open every day, all day.");
    const text = describeBusinessHours({ mon: [{ open: "09:00", close: "18:00" }] });
    expect(text).toContain("Monday: 09:00-18:00");
    expect(text).toContain("Tuesday: closed");
  });

  it("validates timezones", () => {
    expect(isValidTimezone("Africa/Lagos")).toBe(true);
    expect(isValidTimezone("Mars/Base")).toBe(false);
  });
});
