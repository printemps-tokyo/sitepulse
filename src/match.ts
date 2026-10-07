/**
 * Pure helpers: hosts from data streams, matching a host to a Search Console
 * property, and dates. No network.
 */

import type { GscSite } from "./types.js";

/** The host of a web stream's defaultUri, lowercased; "" when it does not parse. */
export function hostOf(uri: string): string {
  try {
    return new URL(uri.includes("://") ? uri : `https://${uri}`).host.toLowerCase();
  } catch {
    return "";
  }
}

/** How a host was matched to a Search Console property. */
export interface GscMatch {
  site: GscSite;
  /**
   * Set when the property is a Domain property: its data covers every
   * subdomain and protocol, so the report is filtered to pages on this host
   * to line up with the GA4 web stream.
   */
  filterHost?: string;
}

/**
 * The Search Console property for a host.
 *
 * 1. A URL-prefix property at the root of that exact host, https first.
 * 2. Otherwise the longest Domain property that is the host or a parent of
 *    it, filtered to the host's pages.
 * 3. Otherwise none.
 */
export function matchGsc(host: string, sites: GscSite[]): GscMatch | undefined {
  if (!host) return undefined;
  const prefix = (scheme: string) =>
    sites.find((s) => {
      try {
        const u = new URL(s.siteUrl);
        return u.protocol === `${scheme}:` && u.host.toLowerCase() === host && u.pathname === "/";
      } catch {
        return false;
      }
    });
  const exact = prefix("https") ?? prefix("http");
  if (exact) return { site: exact };
  const domain = sites
    .filter((s) => s.siteUrl.startsWith("sc-domain:"))
    .map((s) => ({ s, d: s.siteUrl.slice("sc-domain:".length).toLowerCase() }))
    .filter(({ d }) => host === d || host.endsWith(`.${d}`))
    .sort((a, b) => b.d.length - a.d.length)[0];
  return domain ? { site: domain.s, filterHost: host } : undefined;
}

/** A Search Console page filter that keeps only pages on `host` (http or https, any port). */
export function hostFilterExpression(host: string): string {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^https?://${escaped}(:[0-9]+)?(/|$)`;
}

/** Search Console dates are Pacific Time ("in PT time (UTC - 7:00/8:00)", searchAnalytics.query reference). */
export function todayPT(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}

export function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value;
}

export function daysBetween(start: string, end: string): number {
  const t = (s: string) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(end) - t(start)) / 86_400_000) + 1;
}

/**
 * The last day of complete Search Console data, from a probe made with
 * dataState "all": the day before metadata.firstIncompleteDate. Undefined
 * when Search Console does not report one.
 */
export function lastCompleteDay(firstIncompleteDate: string | undefined): string | undefined {
  return firstIncompleteDate ? addDays(firstIncompleteDate, -1) : undefined;
}

/** The range every row shares. */
export interface Range {
  start: string;
  end: string;
  /**
   * "given": --start/--end. "search-console": ends on the earliest last
   * complete Search Console day among the matched properties. "assumed":
   * properties were matched but none reported where complete data ends, so
   * the range ends yesterday (PT). "ga4": nothing matched in Search Console,
   * so GA4's own relative range is used (each property's time zone).
   */
  basis: "given" | "search-console" | "assumed" | "ga4";
}

/** Pick the shared range from the matched properties' last complete days. */
export function chooseRange(days: number, today: string, lastComplete: (string | undefined)[], anyMatched: boolean): Range {
  if (!anyMatched) {
    return { start: `${days}daysAgo`, end: "yesterday", basis: "ga4" };
  }
  const known = lastComplete.filter((d): d is string => d !== undefined).sort();
  const end = known[0] ?? addDays(today, -1);
  return { start: addDays(end, -(days - 1)), end, basis: known.length > 0 ? "search-console" : "assumed" };
}
