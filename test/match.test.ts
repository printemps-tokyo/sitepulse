import { describe, expect, it } from "vitest";
import { addDays, chooseRange, daysBetween, hostFilterExpression, hostOf, isDate, lastCompleteDay, matchGsc, todayPT } from "../src/match.js";

const sites = [
  { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
  { siteUrl: "http://blog.example.com/", permissionLevel: "siteOwner" },
  { siteUrl: "https://blog.example.com/", permissionLevel: "siteOwner" },
  { siteUrl: "https://shop.example.com/jp/", permissionLevel: "siteOwner" },
  { siteUrl: "sc-domain:kweqoo.net", permissionLevel: "siteFullUser" },
];

describe("hostOf", () => {
  it("reads the host of a defaultUri, with or without a scheme", () => {
    expect(hostOf("https://Cars.Printemps.Tokyo")).toBe("cars.printemps.tokyo");
    expect(hostOf("kweqoo.net")).toBe("kweqoo.net");
    expect(hostOf("https://example.com:8443/x")).toBe("example.com:8443");
    expect(hostOf("")).toBe("");
  });
});

describe("matchGsc", () => {
  it("prefers a URL-prefix property at the root of the host, https first", () => {
    expect(matchGsc("blog.example.com", sites)).toEqual({ site: sites[2] });
  });

  it("falls back to a Domain property, filtered to the host", () => {
    expect(matchGsc("example.com", sites)).toEqual({ site: sites[0], filterHost: "example.com" });
    expect(matchGsc("kabuto-zukan.kweqoo.net", sites)).toEqual({ site: sites[4], filterHost: "kabuto-zukan.kweqoo.net" });
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
    expect(re.test("http://example.com:8080/")).toBe(true);
    expect(re.test("https://blog.example.com/")).toBe(false);
    expect(re.test("https://example.com.evil.test/")).toBe(false);
  });
});

describe("dates and the shared range", () => {
  it("uses Pacific Time and calendar arithmetic", () => {
    expect(todayPT(new Date("2026-10-07T05:00:00Z"))).toBe("2026-10-06");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(isDate("2026-02-29")).toBe(false);
    expect(daysBetween("2026-09-28", "2026-10-04")).toBe(7);
    expect(lastCompleteDay("2026-10-05")).toBe("2026-10-04");
    expect(lastCompleteDay(undefined)).toBeUndefined();
  });

  it("ends on the earliest last complete day among matched properties", () => {
    expect(chooseRange(7, "2026-10-06", ["2026-10-04", "2026-10-03", undefined], true)).toEqual({
      start: "2026-09-27",
      end: "2026-10-03",
      basis: "search-console",
    });
  });

  it("assumes yesterday when no matched property reports a boundary", () => {
    expect(chooseRange(3, "2026-10-06", [undefined], true)).toEqual({ start: "2026-10-03", end: "2026-10-05", basis: "assumed" });
  });

  it("uses GA4's relative range when nothing matched", () => {
    expect(chooseRange(7, "2026-10-06", [], false)).toEqual({ start: "7daysAgo", end: "yesterday", basis: "ga4" });
  });
});
