/**
 * The Google API calls sitepulse makes (network). References, read 2026-10-07:
 * - GA4 Admin: accountSummaries.list, properties.dataStreams.list
 *   https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list
 *   https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties.dataStreams/list
 * - GA4 Data: properties.runReport
 *   https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport
 * - Search Console: sites.list, searchAnalytics.query
 *   https://developers.google.com/webmaster-tools/v1/sites/list
 *   https://developers.google.com/webmaster-tools/v1/searchanalytics/query
 */

import { exchange, type Sleep } from "./http.js";
import type { Ga4Totals, GscSite, GscTotals } from "./types.js";

export interface Deps {
  token: string;
  fetchFn?: typeof fetch;
  sleep?: Sleep;
}

/** A hint for errors the user can act on. */
function hint(url: string, status: number, body: string): string {
  if (status === 429 || /quota/i.test(body)) return " (quota exceeded: wait and try again)";
  if (status === 403 && /has not been used|is disabled/i.test(body)) {
    const api = url.includes("analyticsadmin")
      ? "Google Analytics Admin API"
      : url.includes("analyticsdata")
        ? "Google Analytics Data API"
        : "Google Search Console API";
    return ` (enable the ${api} in the key's Google Cloud project)`;
  }
  if (status === 403) return " (add the service account's email as a user of this property)";
  return "";
}

async function call(url: string, init: RequestInit, deps: Deps): Promise<unknown> {
  const res = await exchange(
    url,
    { ...init, headers: { authorization: `Bearer ${deps.token}`, ...(init.headers as Record<string, string> | undefined) } },
    deps.fetchFn ?? fetch,
    deps.sleep,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.text.slice(0, 300)}${hint(url, res.status, res.text)}`);
  return JSON.parse(res.text) as unknown;
}

/** Follow nextPageToken across pages of a GET list call. */
async function listAll<T>(url: string, key: string, deps: Deps): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 100; i++) {
    const u = new URL(url);
    u.searchParams.set("pageSize", "200");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const page = (await call(u.toString(), { method: "GET" }, deps)) as Record<string, unknown>;
    out.push(...((page[key] as T[] | undefined) ?? []));
    pageToken = page.nextPageToken as string | undefined;
    if (!pageToken) return out;
  }
  throw new Error(`${url} returned more than 100 pages; stopping`);
}

export interface AccountSummary {
  account?: string;
  displayName?: string;
  propertySummaries?: { property?: string; displayName?: string }[];
}

export async function ga4AccountSummaries(deps: Deps): Promise<AccountSummary[]> {
  try {
    return await listAll<AccountSummary>("https://analyticsadmin.googleapis.com/v1beta/accountSummaries", "accountSummaries", deps);
  } catch (err) {
    throw new Error(`GA4 accountSummaries.list failed (${(err as Error).message})`);
  }
}

export interface DataStream {
  type?: string;
  webStreamData?: { defaultUri?: string };
}

export async function ga4DataStreams(propertyId: string, deps: Deps): Promise<DataStream[]> {
  try {
    return await listAll<DataStream>(
      `https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}/dataStreams`,
      "dataStreams",
      deps,
    );
  } catch (err) {
    throw new Error(`GA4 dataStreams.list for ${propertyId} failed (${(err as Error).message})`);
  }
}

/** A property's reporting time zone (properties.get, field timeZone, IANA). */
export async function ga4TimeZone(propertyId: string, deps: Deps): Promise<string> {
  try {
    const p = (await call(`https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}`, { method: "GET" }, deps)) as {
      timeZone?: string;
    };
    return p.timeZone ?? "";
  } catch (err) {
    throw new Error(`GA4 properties.get for ${propertyId} failed (${(err as Error).message})`);
  }
}

/** Rows per runReport page. */
export const GA4_PAGE = 1000;

/** A GA4 date range, explicit YYYY-MM-DD dates read in the property's time zone. */
export interface Ga4Range {
  startDate: string;
  endDate: string;
}

export interface Ga4ByHost {
  /** Keyed by hostName as GA4 returned it. */
  hosts: Map<string, Ga4Totals>;
  /** Report quality flags from ResponseMetaData (thresholding, sampling, "(other)" rows, truncation). */
  notes: string[];
}

/**
 * GA4 totals per hostName for a range. Each row is GA4's own total for that
 * hostname (users and sessions deduplicated across the range within it).
 * The hostName dimension is "the subdomain and domain names of a URL"
 * (GA4 API schema).
 */
export async function ga4ByHost(propertyId: string, range: Ga4Range, deps: Deps): Promise<Ga4ByHost> {
  type Body = {
    rowCount?: number;
    rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
    metadata?: {
      dataLossFromOtherRow?: boolean;
      subjectToThresholding?: boolean;
      samplingMetadatas?: unknown[];
      dataTruncationReasons?: {
        dataTruncationType?: string;
        dataTruncationMessage?: string;
        /** "data before this date is truncated" */
        dataTruncationDate?: string;
        dataTruncationDateRanges?: { startDate?: string; endDate?: string }[];
      }[];
    };
  };
  const out = new Map<string, Ga4Totals>();
  const notes = new Set<string>();
  // Paged with offset/limit until rowCount rows are read (runReport reference).
  for (let offset = 0, page = 0; page < 100; page++) {
    let body: Body;
    try {
      body = (await call(
        `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            dateRanges: [range],
            dimensions: [{ name: "hostName" }],
            metrics: [{ name: "totalUsers" }, { name: "sessions" }, { name: "screenPageViews" }],
            offset: String(offset),
            limit: String(GA4_PAGE),
          }),
        },
        deps,
      )) as Body;
    } catch (err) {
      throw new Error(`GA4 runReport for ${propertyId} failed (${(err as Error).message})`);
    }
    const md = body.metadata ?? {};
    if (md.dataLossFromOtherRow) notes.add('some hostnames were rolled into an "(other)" row, so a hostname shown with zeros may have traffic');
    if (md.subjectToThresholding) notes.add("the report is subject to thresholding, so small numbers may be withheld");
    if ((md.samplingMetadatas ?? []).length > 0) notes.add("the report is sampled");
    for (const r of md.dataTruncationReasons ?? []) {
      const parts = [
        r.dataTruncationMessage || r.dataTruncationType || "no reason given",
        ...(r.dataTruncationDate ? [`data before ${r.dataTruncationDate}`] : []),
        ...(r.dataTruncationDateRanges ?? []).map((d) => `${d.startDate ?? "?"}..${d.endDate ?? "?"}`),
      ];
      notes.add(`the report is truncated (${parts.join(", ")})`);
    }
    const rows = body.rows ?? [];
    for (const row of rows) {
      const v = row.metricValues ?? [];
      const n = (i: number) => Number(v[i]?.value ?? 0);
      // Users and sessions are deduplicated per row, so rows are never added together.
      out.set(row.dimensionValues?.[0]?.value ?? "", { users: n(0), sessions: n(1), pageviews: n(2) });
    }
    offset += rows.length;
    if (rows.length === 0 || offset >= (body.rowCount ?? 0)) return { hosts: out, notes: [...notes] };
  }
  throw new Error(`GA4 runReport for ${propertyId} returned more than 100 pages; stopping`);
}

export async function gscSites(deps: Deps): Promise<GscSite[]> {
  let body: { siteEntry?: { siteUrl?: string; permissionLevel?: string }[] };
  try {
    body = (await call("https://www.googleapis.com/webmasters/v3/sites", { method: "GET" }, deps)) as typeof body;
  } catch (err) {
    throw new Error(`Search Console sites.list failed (${(err as Error).message})`);
  }
  return (body.siteEntry ?? []).map((s) => ({ siteUrl: s.siteUrl ?? "", permissionLevel: s.permissionLevel ?? "" }));
}

export interface GscQueryBody {
  startDate: string;
  endDate: string;
  dimensions?: string[];
  dataState?: "final" | "all";
  dimensionFilterGroups?: { groupType?: "and"; filters: { dimension: "page"; operator: "includingRegex"; expression: string }[] }[];
}

export interface GscQueryResponse {
  rows?: { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }[];
  responseAggregationType?: string;
  metadata?: { firstIncompleteDate?: string };
}

export async function gscQuery(siteUrl: string, body: GscQueryBody, deps: Deps): Promise<GscQueryResponse> {
  try {
    return (await call(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      deps,
    )) as GscQueryResponse;
  } catch (err) {
    throw new Error(`Search Console query for ${siteUrl} failed (${(err as Error).message})`);
  }
}

export function gscTotalsOf(res: GscQueryResponse): GscTotals {
  const r = res.rows?.[0];
  return {
    clicks: r?.clicks ?? 0,
    impressions: r?.impressions ?? 0,
    ctr: r?.ctr ?? 0,
    position: typeof r?.position === "number" ? r.position : null,
  };
}
