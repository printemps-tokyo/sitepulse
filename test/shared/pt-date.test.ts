// Shared verbatim by gsc and sitepulse, like src/shared/.
import { describe, expect, it } from "vitest";
import { addDays, isDate, todayPT } from "../../src/shared/pt-date.js";

describe("todayPT", () => {
  it("is still the previous day in Pacific Time early in the UTC morning", () => {
    expect(todayPT(new Date("2026-03-10T06:59:00Z"))).toBe("2026-03-09");
    expect(todayPT(new Date("2026-03-10T07:00:00Z"))).toBe("2026-03-10");
  });

  it("follows the switch to standard time", () => {
    expect(todayPT(new Date("2026-11-10T07:59:00Z"))).toBe("2026-11-09");
    expect(todayPT(new Date("2026-11-10T08:00:00Z"))).toBe("2026-11-10");
  });
});

describe("addDays", () => {
  it("crosses month, year and leap-day boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("isDate", () => {
  it("accepts real dates and rejects malformed or impossible ones", () => {
    expect(isDate("2028-02-29")).toBe(true);
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2026-1-01")).toBe(false);
    expect(isDate("2026-13-01")).toBe(false);
  });
});
