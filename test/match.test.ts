import { describe, expect, it } from "vitest";
import {
  addDays,
  chooseRange,
  daysBetween,
  hostFilterExpression,
  hostOf,
  isDate,
  isHostname,
  lastCompleteDay,
  matchGsc,
  todayPT,
  yesterdayIn,
} from "../src/match.js";

const sites = [
  { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
  { siteUrl: "http://blog.example.com/", permissionLevel: "siteOwner" },
  { siteUrl: "https://blog.example.com/", permissionLevel: "siteOwner" },
  { siteUrl: "https://shop.example.com/jp/", permissionLevel: "siteOwner" },
  { siteUrl: "sc-domain:kweqoo.net", permissionLevel: "siteFullUser" },
  { siteUrl: "sc-domain:deep.example.com", permissionLevel: "siteOwner" },
];

describe("hostOf and isHostname", () => {
  it("reads the hostname of a defaultUri, lowercased, without a port", () => {
    expect(hostOf("https://Cars.Printemps.Tokyo")).toBe("cars.printemps.tokyo");
    expect(hostOf("kweqoo.net")).toBe("kweqoo.net");
    expect(hostOf("https://example.com:8443/x")).toBe("example.com");
    expect(hostOf("")).toBe("");
  });

  it("tells hostnames from GA4 placeholders", () => {
    expect(isHostname("kabuto-zukan.kweqoo.net")).toBe(true);
    expect(isHostname("(not set)")).toBe(false);
    expect(isHostname("localhost")).toBe(false);
  });
});

describe("matchGsc", () => {
  it("prefers a URL-prefix property at the root of the host, https first", () => {
    expect(matchGsc("blog.example.com", sites)).toEqual({ site: sites[2] });
  });

  it("falls back to the closest Domain property, filtered to the host", () => {
    expect(matchGsc("example.com", sites)).toEqual({ site: sites[0], filterHost: "example.com" });
    expect(matchGsc("kabuto-zukan.kweqoo.net", sites)).toEqual({ site: sites[4], filterHost: "kabuto-zukan.kweqoo.net" });
    expect(matchGsc("a.deep.example.com", sites)).toEqual({ site: sites[5], filterHost: "a.deep.example.com" });
    // A URL-prefix property below the root does not cover the host.
    expect(matchGsc("shop.example.com", sites)).toEqual({ site: sites[0], filterHost: "shop.example.com" });
  });

  it("does not match a lookalike domain", () => {
    expect(matchGsc("notexample.com", sites)).toBeUndefined();
    expect(matchGsc("", sites)).toBeUndefined();
  });

  it("builds a page filter for the host", () => {
    const re = new RegExp(hostFilterExpression("example.com"));
    expect(re.test("https://example.com/a")).toBe(true);
    expect(re.test("https://example.com")).toBe(true);
    expect(re.test("http://example.com:8080/")).toBe(true);
    expect(re.test("https://blog.example.com/")).toBe(false);
    expect(re.test("https://example.com.evil.test/")).toBe(false);
    expect(re.test("https://exampleXcom/")).toBe(false);
  });
});

describe("dates", () => {
  it("uses Pacific Time and calendar arithmetic", () => {
    expect(todayPT(new Date("2026-10-07T05:00:00Z"))).toBe("2026-10-06");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2028-02-29")).toBe(true);
    expect(daysBetween("2026-09-28", "2026-10-04")).toBe(7);
    expect(lastCompleteDay("2026-10-05")).toBe("2026-10-04");
    expect(lastCompleteDay(undefined)).toBeUndefined();
  });

  it("finds yesterday in a property's time zone", () => {
    const now = new Date("2026-10-06T20:00:00Z"); // 2026-10-07 05:00 in Tokyo, 13:00 on 10-06 in Los Angeles
    expect(yesterdayIn("Asia/Tokyo", now)).toBe("2026-10-06");
    expect(yesterdayIn("America/Los_Angeles", now)).toBe("2026-10-05");
  });
});

describe("chooseRange", () => {
  it("ends on the earliest last complete day when every property reports one", () => {
    expect(chooseRange(7, ["2026-10-04", "2026-10-03"], ["2026-10-05"])).toEqual({
      start: "2026-09-27",
      end: "2026-10-03",
      basis: "search-console",
    });
  });

  it("is partial when only some properties report one", () => {
    expect(chooseRange(7, ["2026-10-04", undefined], ["2026-10-05"])).toEqual({
      start: "2026-09-28",
      end: "2026-10-04",
      basis: "partial",
    });
  });

  it("falls back to the earliest yesterday when none reports one", () => {
    expect(chooseRange(3, [undefined], ["2026-10-06", "2026-10-05"])).toEqual({ start: "2026-10-03", end: "2026-10-05", basis: "assumed" });
  });

  it("uses the GA4 time zones when no Search Console property is visible", () => {
    expect(chooseRange(1, [], ["2026-10-06"])).toEqual({ start: "2026-10-06", end: "2026-10-06", basis: "ga4" });
  });
});
