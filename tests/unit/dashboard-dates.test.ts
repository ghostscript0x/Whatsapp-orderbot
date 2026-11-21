import { describe, expect, it } from "vitest";
import { dayRangeInTimeZone, isValidTimeZone, timeZoneOffsetMs } from "@/lib/dates";

const iso = (d: Date) => d.toISOString();

describe("dayRangeInTimeZone", () => {
  it("Africa/Lagos (UTC+1): mid-day", () => {
    const r = dayRangeInTimeZone("Africa/Lagos", new Date("2026-11-21T12:00:00Z"));
    expect(r.date).toBe("2026-11-21");
    expect(iso(r.start)).toBe("2026-11-20T23:00:00.000Z");
    expect(iso(r.end)).toBe("2026-11-21T23:00:00.000Z");
  });

  it("Africa/Lagos: 23:30 UTC is already the next local day", () => {
    const r = dayRangeInTimeZone("Africa/Lagos", new Date("2026-11-21T23:30:00Z"));
    expect(r.date).toBe("2026-11-22");
    expect(iso(r.start)).toBe("2026-11-21T23:00:00.000Z");
  });

  it("exact local midnight belongs to the new day (start inclusive)", () => {
    const r = dayRangeInTimeZone("Africa/Lagos", new Date("2026-11-20T23:00:00Z"));
    expect(r.date).toBe("2026-11-21");
    expect(iso(r.start)).toBe("2026-11-20T23:00:00.000Z");
  });

  it("one millisecond before local midnight is still the old day", () => {
    const r = dayRangeInTimeZone("Africa/Lagos", new Date("2026-11-20T22:59:59.999Z"));
    expect(r.date).toBe("2026-11-20");
  });

  it("UTC", () => {
    const r = dayRangeInTimeZone("UTC", new Date("2026-01-01T00:00:00Z"));
    expect(r.date).toBe("2026-01-01");
    expect(iso(r.start)).toBe("2026-01-01T00:00:00.000Z");
    expect(iso(r.end)).toBe("2026-01-02T00:00:00.000Z");
  });

  it("negative offset (America/New_York, EST)", () => {
    const r = dayRangeInTimeZone("America/New_York", new Date("2026-01-15T03:00:00Z"));
    expect(r.date).toBe("2026-01-14");
    expect(iso(r.start)).toBe("2026-01-14T05:00:00.000Z");
    expect(iso(r.end)).toBe("2026-01-15T05:00:00.000Z");
  });

  it("half-hour offset (Asia/Kolkata)", () => {
    const r = dayRangeInTimeZone("Asia/Kolkata", new Date("2026-06-01T20:00:00Z"));
    expect(r.date).toBe("2026-06-02");
    expect(iso(r.start)).toBe("2026-06-01T18:30:00.000Z");
  });

  it("DST spring-forward day is 23 hours long (Europe/London)", () => {
    const r = dayRangeInTimeZone("Europe/London", new Date("2026-03-29T12:00:00Z"));
    expect(iso(r.start)).toBe("2026-03-29T00:00:00.000Z");
    expect(iso(r.end)).toBe("2026-03-29T23:00:00.000Z");
  });

  it("DST fall-back day is 25 hours long (Europe/London)", () => {
    const r = dayRangeInTimeZone("Europe/London", new Date("2026-10-25T12:00:00Z"));
    expect(iso(r.start)).toBe("2026-10-24T23:00:00.000Z");
    expect(iso(r.end)).toBe("2026-10-26T00:00:00.000Z");
  });

  it("DST gap at midnight starts the day at 01:00 local (America/Santiago)", () => {
    // 2026-09-06 00:00 -04 jumps to 01:00 -03, so the day starts at 04:00Z.
    const r = dayRangeInTimeZone("America/Santiago", new Date("2026-09-06T15:00:00Z"));
    expect(r.date).toBe("2026-09-06");
    expect(iso(r.start)).toBe("2026-09-06T04:00:00.000Z");
    expect(iso(r.end)).toBe("2026-09-07T03:00:00.000Z");
  });

  it("month and year rollover", () => {
    const r = dayRangeInTimeZone("Africa/Lagos", new Date("2026-12-31T12:00:00Z"));
    expect(iso(r.end)).toBe("2026-12-31T23:00:00.000Z");
    const next = dayRangeInTimeZone("Africa/Lagos", r.end);
    expect(next.date).toBe("2027-01-01");
  });

  it("throws on an unknown time zone", () => {
    expect(() => dayRangeInTimeZone("Mars/Olympus", new Date())).toThrow(RangeError);
  });
});

describe("helpers", () => {
  it("timeZoneOffsetMs", () => {
    expect(timeZoneOffsetMs(new Date("2026-11-21T12:00:00Z"), "Africa/Lagos")).toBe(3_600_000);
    expect(timeZoneOffsetMs(new Date("2026-07-01T12:00:00Z"), "America/New_York")).toBe(-4 * 3_600_000);
  });

  it("isValidTimeZone", () => {
    expect(isValidTimeZone("Africa/Lagos")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
});
