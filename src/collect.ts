/**
 * Putting it together.
 *
 * A row is one hostname GA4 recorded for a property (its hostName dimension),
 * not a property: one tag can serve several subdomains, and a web stream's
 * defaultUri does not say which. Each row's GA4 numbers are that hostname's,
 * and its Search Console numbers are the matching property's, filtered to
 * the same hostname when it is a Domain property. Both use the same dates.
 */

import {
  ga4AccountSummaries,
  ga4ByHost,
  ga4DataStreams,
  ga4TimeZone,
  gscQuery,
  gscSites,
  gscTotalsOf,
  type Deps,
  type GscQueryBody,
  type GscQueryResponse,
} from "./google.js";
import {
  addDays,
  chooseRange,
  hostFilterExpression,
  hostOf,
  isHostname,
  lastCompleteDay,
  matchGsc,
  todayPT,
  yesterdayIn,
  type GscMatch,
  type Range,
} from "./match.js";
import type { Ga4Property, Ga4Totals, GscSite, GscTotals } from "./types.js";

export interface Problem {
  source: "ga4" | "searchConsole";
  subject: string;
  error: string;
}

/** Something worth knowing about the numbers that is not an error (exit code stays 0). */
export interface Note {
  source: "ga4" | "searchConsole";
  subject: string;
  note: string;
}

export interface Mapping {
  properties: Ga4Property[];
  /** Search Console properties that can be queried. */
  sites: GscSite[];
  /** Listed with permissionLevel siteUnverifiedUser: they cannot be queried, so they are never matched. */
  unverifiedSites: GscSite[];
  /** Set when Search Console could not be listed at all (for example the API is not enabled). */
  gscError?: string;
  problems: Problem[];
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

/** GA4 properties (with stream hosts and time zone) and Search Console properties. */
export async function buildMapping(deps: Deps): Promise<Mapping> {
  const summaries = await ga4AccountSummaries(deps);
  const listed = summaries.flatMap((a) =>
    (a.propertySummaries ?? []).map((p) => ({
      id: (p.property ?? "").replace(/^properties\//, ""),
      name: p.displayName ?? "",
      account: a.displayName ?? "",
    })),
  );
  const problems: Problem[] = [];
  const properties: Ga4Property[] = await pool(listed, async (p) => {
    let hosts: string[] = [];
    let timeZone = "";
    try {
      const streams = await ga4DataStreams(p.id, deps);
      hosts = [
        ...new Set(
          streams
            .filter((s) => s.type === "WEB_DATA_STREAM")
            .map((s) => hostOf(s.webStreamData?.defaultUri ?? ""))
            .filter(Boolean),
        ),
      ];
    } catch (err) {
      problems.push({ source: "ga4", subject: p.id, error: (err as Error).message });
    }
    try {
      timeZone = await ga4TimeZone(p.id, deps);
    } catch (err) {
      problems.push({ source: "ga4", subject: p.id, error: (err as Error).message });
    }
    return { ...p, hosts, timeZone };
  });

  let listedSites: GscSite[] = [];
  let gscError: string | undefined;
  try {
    listedSites = await gscSites(deps);
  } catch (err) {
    gscError = (err as Error).message;
  }
  const unverified = (s: GscSite) => s.permissionLevel === "siteUnverifiedUser";
  return {
    properties,
    sites: listedSites.filter((s) => !unverified(s)),
    unverifiedSites: listedSites.filter(unverified),
    problems,
    ...(gscError ? { gscError } : {}),
  };
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
 * The shared range, as explicit dates.
 *
 * Fixed: as given. Otherwise every verified Search Console property is asked
 * once for fresh data (last 10 days) and its metadata.firstIncompleteDate;
 * the range ends on the earliest last complete day. A probe that fails is a
 * problem (reported, exit 1), not a silent "no boundary". With no Search
 * Console property, the range ends on the earliest "yesterday" among the GA4
 * properties' time zones, so every row covers the same complete days.
 */
export async function rangeFor(m: Mapping, opts: ReportOptions, now: Date, deps: Deps): Promise<{ range: Range; problems: Problem[] }> {
  if (opts.start && opts.end) return { range: { start: opts.start, end: opts.end, basis: "given" }, problems: [] };
  const today = todayPT(now);
  const problems: Problem[] = [];
  const ends = await pool(m.sites, async (site) => {
    try {
      const probe = await gscQuery(
        site.siteUrl,
        { startDate: addDays(today, -9), endDate: today, dimensions: ["date"], dataState: "all" },
        deps,
      );
      return lastCompleteDay(probe.metadata?.firstIncompleteDate);
    } catch (err) {
      problems.push({ source: "searchConsole", subject: site.siteUrl, error: (err as Error).message });
      return undefined;
    }
  });
  const zones = [...new Set(m.properties.map((p) => p.timeZone).filter(Boolean))];
  const ga4Yesterdays = zones.map((z) => yesterdayIn(z, now));
  if (m.sites.length === 0) {
    // GA4 only: complete days in every property's own time zone.
    return { range: chooseRange(opts.days, [], ga4Yesterdays.length > 0 ? ga4Yesterdays : [addDays(today, -1)]), problems };
  }
  return { range: chooseRange(opts.days, ends, [addDays(today, -1), ...ga4Yesterdays]), problems };
}

/** One row of the report. */
export interface Row {
  property: Ga4Property;
  host: string;
  ga4?: Ga4Totals;
  gsc?: GscMatch;
  gscTotals?: GscTotals;
  /** How Search Console aggregated the numbers ("byProperty" or "byPage"). */
  gscAggregation?: string;
  /** Why the row has no Search Console numbers. */
  gscNote?: string;
}

const ZERO: Ga4Totals = { users: 0, sessions: 0, pageviews: 0 };

/**
 * Rows for every property: one per hostname GA4 recorded in the range, plus
 * any web stream hostname that recorded nothing (so a quiet site still shows,
 * with zeros). A property whose GA4 report fails gets one row per stream host
 * and a problem. The same Search Console property and host is queried once,
 * even when several GA4 properties recorded that host.
 */
export async function collectRows(m: Mapping, range: Range, deps: Deps): Promise<{ rows: Row[]; problems: Problem[]; notes: Note[] }> {
  const problems: Problem[] = [];
  const notes: Note[] = [];
  const queries = new Map<string, Promise<GscQueryResponse>>();
  const query = (gsc: GscMatch): Promise<GscQueryResponse> => {
    const key = `${gsc.site.siteUrl}\n${gsc.filterHost ?? ""}`;
    let q = queries.get(key);
    if (!q) {
      q = gscQuery(gsc.site.siteUrl, { startDate: range.start, endDate: range.end, dataState: "final", ...gscScope(gsc) }, deps);
      queries.set(key, q);
    }
    return q;
  };
  const failed = new Set<string>();
  const perProperty = await pool(m.properties, async (property): Promise<Row[]> => {
    let byHost: Map<string, Ga4Totals> | undefined;
    try {
      const report = await ga4ByHost(property.id, { startDate: range.start, endDate: range.end }, deps);
      byHost = report.hosts;
      for (const note of report.notes) notes.push({ source: "ga4", subject: property.id, note });
    } catch (err) {
      problems.push({ source: "ga4", subject: property.id, error: (err as Error).message });
    }
    // GA4 hostNames as recorded, then stream hosts GA4 did not record under any casing.
    const recorded = byHost ? [...byHost.keys()] : [];
    const seen = new Set(recorded.map((h) => h.toLowerCase()));
    const hosts = [...recorded, ...property.hosts.filter((h) => !seen.has(h))];
    const ordered = hosts.sort((a, b) => (byHost?.get(b)?.users ?? 0) - (byHost?.get(a)?.users ?? 0) || a.localeCompare(b));
    if (ordered.length === 0) {
      return [{ property, host: "", ...(byHost ? { ga4: ZERO } : {}), gscNote: "no web data stream and no traffic" }];
    }
    return pool(ordered, async (host): Promise<Row> => {
      const row: Row = { property, host };
      if (byHost) row.ga4 = byHost.get(host) ?? ZERO;
      const name = host.toLowerCase();
      const gsc = isHostname(name) ? matchGsc(name, m.sites) : undefined;
      if (!gsc) {
        row.gscNote = m.gscError ? "Search Console unavailable" : isHostname(name) ? "no Search Console property" : "not a hostname";
        return row;
      }
      row.gsc = gsc;
      try {
        const res = await query(gsc);
        row.gscTotals = gscTotalsOf(res);
        if (res.responseAggregationType) row.gscAggregation = res.responseAggregationType;
      } catch (err) {
        const subject = gsc.filterHost ? `${gsc.site.siteUrl} (${gsc.filterHost})` : gsc.site.siteUrl;
        if (!failed.has(subject)) {
          failed.add(subject);
          problems.push({ source: "searchConsole", subject, error: (err as Error).message });
        }
      }
      return row;
    });
  });
  return { rows: perProperty.flat(), problems, notes };
}

/** Search Console properties that no row used. */
export function unusedSites(m: Mapping, rows: Row[]): GscSite[] {
  const used = new Set(rows.flatMap((r) => (r.gsc ? [r.gsc.site.siteUrl] : [])));
  return m.sites.filter((s) => !used.has(s.siteUrl));
}
