/**
 * Pure helpers: hosts from data streams, matching a host to a Search Console
 * property, and dates. No network.
 */

import type { GscSite } from "./types.js";

/**
 * The hostname of a web stream's defaultUri, lowercased, without a port;
 * "" when it does not parse. GA4's hostName dimension and Search Console's
 * Domain properties both work on hostnames.
 */
export function hostOf(uri: string): string {
  try {
    return new URL(uri.includes("://") ? uri : `https://${uri}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Whether a GA4 hostName value is a real hostname ("(not set)" and the like are not). */
export function isHostname(value: string): boolean {
  return /^[a-z0-9.-]+\.[a-z0-9-]+$/i.test(value);
}

/** Yesterday's date in an IANA time zone, as YYYY-MM-DD. */
export function yesterdayIn(timeZone: string, now: Date = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return addDays(today, -1);
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
 * `host` is a lowercase hostname; `sites` should hold only verified
 * properties (an unverified one cannot be queried).
 *
 * 1. A URL-prefix property at the root of that exact host, on the default
 *    port, https first. It covers only that protocol's pages.
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
        // A property on another port covers other pages, not this host's.
        return u.protocol === `${scheme}:` && u.hostname.toLowerCase() === host && u.port === "" && u.pathname === "/";
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

/** The range every row shares: explicit dates, the same for GA4 and Search Console. */
export interface Range {
  start: string;
  end: string;
  /**
   * "given": --start/--end.
   * "search-console": ends on the earliest last complete day reported by
   *   every visible Search Console property.
   * "partial": some properties reported a last complete day and some did
   *   not (or failed); the range ends on the earliest reported one.
   * "assumed": none reported one; the range ends on the earliest
   *   "yesterday" among Pacific Time and the GA4 time zones.
   * "ga4": no Search Console property is visible; the range ends on the
   *   earliest "yesterday" among the GA4 properties' time zones.
   */
  basis: "given" | "search-console" | "partial" | "assumed" | "ga4";
}

/**
 * Pick the shared range.
 *
 * `lastComplete` holds one entry per visible Search Console property: its
 * last complete day, or undefined when it did not report one or failed.
 * `yesterdays` holds "yesterday" in Pacific Time and in each GA4 time zone,
 * so a fallback end is a complete day everywhere.
 */
export function chooseRange(days: number, lastComplete: (string | undefined)[], yesterdays: string[]): Range {
  const fallback = [...yesterdays].sort()[0]!;
  const known = lastComplete.filter((d): d is string => d !== undefined).sort();
  let end: string;
  let basis: Range["basis"];
  if (lastComplete.length === 0) {
    end = fallback;
    basis = "ga4";
  } else if (known.length === 0) {
    end = fallback;
    basis = "assumed";
  } else {
    end = known[0]!;
    basis = known.length === lastComplete.length ? "search-console" : "partial";
  }
  return { start: addDays(end, -(days - 1)), end, basis };
}
