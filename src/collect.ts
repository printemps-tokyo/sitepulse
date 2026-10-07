/**
 * Putting it together: GA4 properties and their hosts, the Search Console
 * property for each host, a shared range, and both sets of totals.
 */

import {
  ga4AccountSummaries,
  ga4DataStreams,
  ga4Totals,
  gscQuery,
  gscSites,
  gscTotalsOf,
  type Deps,
  type GscQueryBody,
} from "./google.js";
import { addDays, chooseRange, hostFilterExpression, hostOf, lastCompleteDay, matchGsc, type GscMatch, type Range } from "./match.js";
import type { Ga4Property, Ga4Totals, GscSite, GscTotals } from "./types.js";

/** One row: a GA4 property, the host used to match it, and the matched Search Console property. */
export interface Pair {
  property: Ga4Property;
  /** The stream host that matched, or the first host when none did. */
  host: string;
  gsc?: GscMatch;
  /** Why there is no Search Console column for this row. */
  gscNote?: string;
}

export interface Mapping {
  pairs: Pair[];
  /** Search Console properties no GA4 property matched. */
  unmatchedSites: GscSite[];
  /** Set when Search Console could not be listed at all (for example the API is not enabled). */
  gscError?: string;
  /** Per-property errors while reading data streams. */
  errors: { propertyId: string; error: string }[];
}

export interface Row extends Pair {
  ga4?: Ga4Totals;
  ga4Error?: string;
  gscTotals?: GscTotals;
  gscError?: string;
}

const CONCURRENCY = 4;

async function pool<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

/** GA4 properties with their web stream hosts, and the Search Console property for each. */
export async function buildMapping(deps: Deps): Promise<Mapping> {
  const summaries = await ga4AccountSummaries(deps);
  const listed = summaries.flatMap((a) =>
    (a.propertySummaries ?? []).map((p) => ({
      id: (p.property ?? "").replace(/^properties\//, ""),
      name: p.displayName ?? "",
      account: a.displayName ?? "",
    })),
  );
  const errors: Mapping["errors"] = [];
  const properties: Ga4Property[] = await pool(listed, async (p) => {
    try {
      const streams = await ga4DataStreams(p.id, deps);
      const hosts = streams
        .filter((s) => s.type === "WEB_DATA_STREAM")
        .map((s) => hostOf(s.webStreamData?.defaultUri ?? ""))
        .filter(Boolean);
      return { ...p, hosts: [...new Set(hosts)] };
    } catch (err) {
      errors.push({ propertyId: p.id, error: (err as Error).message });
      return { ...p, hosts: [] };
    }
  });

  let sites: GscSite[] = [];
  let gscError: string | undefined;
  try {
    sites = await gscSites(deps);
  } catch (err) {
    gscError = (err as Error).message;
  }

  const used = new Set<string>();
  const pairs: Pair[] = properties.map((property) => {
    if (property.hosts.length === 0) return { property, host: "", gscNote: "no web data stream" };
    for (const host of property.hosts) {
      const gsc = matchGsc(host, sites);
      if (gsc) {
        used.add(gsc.site.siteUrl);
        return { property, host, gsc };
      }
    }
    return { property, host: property.hosts[0]!, gscNote: gscError ? "Search Console unavailable" : "no Search Console property" };
  });
  return { pairs, unmatchedSites: sites.filter((s) => !used.has(s.siteUrl)), errors, ...(gscError ? { gscError } : {}) };
}

function gscScope(m: GscMatch): Partial<GscQueryBody> {
  return m.filterHost
    ? {
        dimensionFilterGroups: [
          { groupType: "and", filters: [{ dimension: "page", operator: "includingRegex", expression: hostFilterExpression(m.filterHost) }] },
        ],
      }
    : {};
}

export interface ReportOptions {
  days: number;
  /** A fixed range for both sources, YYYY-MM-DD. */
  start?: string;
  end?: string;
}

/**
 * The shared range. A fixed range is used as given. Otherwise each matched
 * Search Console property is probed once (last 10 days, fresh data) for
 * metadata.firstIncompleteDate, and the range ends on the earliest last
 * complete day so every row covers the same dates.
 */
export async function rangeFor(mapping: Mapping, opts: ReportOptions, today: string, deps: Deps): Promise<Range> {
  if (opts.start && opts.end) return { start: opts.start, end: opts.end, basis: "given" };
  const matched = mapping.pairs.filter((p) => p.gsc);
  const ends = await pool(matched, async (p) => {
    try {
      const probe = await gscQuery(
        p.gsc!.site.siteUrl,
        { startDate: addDays(today, -9), endDate: today, dimensions: ["date"], dataState: "all", ...gscScope(p.gsc!) },
        deps,
      );
      return lastCompleteDay(probe.metadata?.firstIncompleteDate);
    } catch {
      // A probe that fails says nothing about the boundary; the row's own query reports the error.
      return undefined;
    }
  });
  return chooseRange(opts.days, today, ends, matched.length > 0);
}

/** Both sets of totals for every row over the shared range. */
export async function collectRows(mapping: Mapping, range: Range, deps: Deps): Promise<Row[]> {
  return pool(mapping.pairs, async (pair): Promise<Row> => {
    const row: Row = { ...pair };
    try {
      row.ga4 = await ga4Totals(pair.property.id, { startDate: range.start, endDate: range.end }, deps);
    } catch (err) {
      row.ga4Error = (err as Error).message;
    }
    if (pair.gsc && range.basis !== "ga4") {
      try {
        row.gscTotals = gscTotalsOf(
          await gscQuery(pair.gsc.site.siteUrl, { startDate: range.start, endDate: range.end, dataState: "final", ...gscScope(pair.gsc) }, deps),
        );
      } catch (err) {
        row.gscError = (err as Error).message;
      }
    }
    return row;
  });
}
