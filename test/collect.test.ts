import { describe, expect, it } from "vitest";
import { buildMapping, collectRows, rangeFor, unusedSites } from "../src/collect.js";
import { renderMappingJson, renderMappingMarkdown, renderReportJson, renderReportMarkdown } from "../src/render.js";

interface Call {
  url: string;
  body?: Record<string, unknown>;
}

interface Options {
  gscDisabled?: boolean;
  failGa4?: string;
  failProbe?: string;
  noBoundary?: string;
  noGsc?: boolean;
  /** GA4 metadata flags for property 2's report. */
  ga4Meta?: Record<string, unknown>;
  /** Property 1 records its host in two casings, and a host property 2 also records. */
  caseVariants?: boolean;
}

/** 2026-10-07 05:00 in Tokyo, 2026-10-06 13:00 in Los Angeles. */
const NOW = new Date("2026-10-06T20:00:00Z");

const ga4Row = (host: string, users: number) => ({
  dimensionValues: [{ value: host }],
  metricValues: [{ value: String(users) }, { value: String(users + 2) }, { value: String(users * 3) }],
});

/** A fake Google: routes by URL, records calls. */
function fakeGoogle(opts: Options = {}) {
  const calls: Call[] = [];
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ url, body });
    const u = new URL(url);
    if (u.pathname.endsWith("/accountSummaries")) {
      // Two pages, to exercise nextPageToken.
      if (!u.searchParams.get("pageToken")) {
        return json({
          accountSummaries: [
            {
              displayName: "printemps.tokyo",
              propertySummaries: [
                { property: "properties/1", displayName: "cars" },
                { property: "properties/2", displayName: "keyword-lp" },
              ],
            },
          ],
          nextPageToken: "p2",
        });
      }
      return json({ accountSummaries: [{ displayName: "other", propertySummaries: [{ property: "properties/3", displayName: "app only" }] }] });
    }
    if (u.pathname.endsWith("/properties/1/dataStreams")) {
      return json({ dataStreams: [{ type: "WEB_DATA_STREAM", webStreamData: { defaultUri: "https://cars.printemps.tokyo:443" } }] });
    }
    if (u.pathname.endsWith("/properties/2/dataStreams")) {
      return json({
        dataStreams: [
          { type: "WEB_DATA_STREAM", webStreamData: { defaultUri: "https://kweqoo.net" } },
          { type: "WEB_DATA_STREAM", webStreamData: { defaultUri: "https://KWEQOO.net/" } },
          { type: "ANDROID_APP_DATA_STREAM" },
        ],
      });
    }
    if (u.pathname.endsWith("/properties/3/dataStreams")) return json({ dataStreams: [{ type: "IOS_APP_DATA_STREAM" }] });
    const prop = /\/v1beta\/properties\/(\d+)$/.exec(u.pathname);
    if (prop) return json({ name: `properties/${prop[1]}`, timeZone: prop[1] === "1" ? "America/Los_Angeles" : "Asia/Tokyo" });
    if (url.includes(":runReport")) {
      if (opts.failGa4 && url.includes(`/properties/${opts.failGa4}:`)) return json({ error: { message: "denied" } }, 403);
      if (url.includes("/properties/1:")) {
        if (opts.caseVariants) {
          return json({
            rowCount: 3,
            rows: [ga4Row("cars.printemps.tokyo", 10), ga4Row("kabuto-zukan.kweqoo.net", 7), ga4Row("Cars.Printemps.Tokyo", 2)],
          });
        }
        return json({ rowCount: 1, rows: [ga4Row("cars.printemps.tokyo", 10)] });
      }
      if (url.includes("/properties/2:")) {
        if (opts.ga4Meta) return json({ rowCount: 1, rows: [ga4Row("kabuto-zukan.kweqoo.net", 40)], metadata: opts.ga4Meta });
        // Two pages: the stream host recorded nothing, subdomains did.
        if (body?.offset === "0") return json({ rowCount: 3, rows: [ga4Row("toy-zukan.kweqoo.net", 5), ga4Row("kabuto-zukan.kweqoo.net", 40)] });
        return json({ rowCount: 3, rows: [ga4Row("(not set)", 1)] });
      }
      return json({});
    }
    if (u.pathname.endsWith("/webmasters/v3/sites")) {
      if (opts.gscDisabled) return json({ error: { message: "Google Search Console API has not been used in project 1" } }, 403);
      if (opts.noGsc) return json({});
      return json({
        siteEntry: [
          { siteUrl: "sc-domain:kweqoo.net", permissionLevel: "siteFullUser" },
          { siteUrl: "https://other.example/", permissionLevel: "siteOwner" },
          { siteUrl: "https://kabuto-zukan.kweqoo.net/", permissionLevel: "siteUnverifiedUser" },
        ],
      });
    }
    if (url.includes("/searchAnalytics/query")) {
      const site = decodeURIComponent(/\/sites\/([^/]+)\/searchAnalytics/.exec(url)?.[1] ?? "");
      if (body?.dataState === "all") {
        if (opts.failProbe === site) return json({ error: { message: "denied" } }, 403);
        if (opts.noBoundary === site) return json({ rows: [] });
        return json({ rows: [], metadata: { firstIncompleteDate: site === "sc-domain:kweqoo.net" ? "2026-10-05" : "2026-10-04" } });
      }
      const expr = JSON.stringify(body?.dimensionFilterGroups ?? "");
      const clicks = expr.includes("kabuto") ? 3 : 1;
      return json({ rows: [{ clicks, impressions: 120, ctr: clicks / 120, position: 8.4 }], responseAggregationType: "byPage" });
    }
    return json({ error: { message: `unexpected ${url}` } }, 404);
  }) as typeof fetch;
  return { calls, deps: { token: "t", fetchFn, sleep: async () => {} } };
}

describe("buildMapping", () => {
  it("reads every page of properties, web stream hostnames without ports, and time zones", async () => {
    const { deps } = fakeGoogle();
    const m = await buildMapping(deps);
    expect(m.problems).toEqual([]);
    expect(m.properties.map((p) => [p.id, p.hosts, p.timeZone])).toEqual([
      ["1", ["cars.printemps.tokyo"], "America/Los_Angeles"],
      ["2", ["kweqoo.net"], "Asia/Tokyo"],
      ["3", [], "Asia/Tokyo"],
    ]);
    const md = renderMappingMarkdown(m);
    expect(md).toContain("| keyword-lp | 2 | Asia/Tokyo | kweqoo.net | sc-domain:kweqoo.net (pages on kweqoo.net) |");
    expect(md).toContain("| app only | 3 | Asia/Tokyo | - | - (no web data stream) |");
    expect(JSON.parse(renderMappingJson(m)).properties[1].matches).toEqual([
      { host: "kweqoo.net", searchConsole: { siteUrl: "sc-domain:kweqoo.net", filterHost: "kweqoo.net" } },
    ]);
  });

  it("keeps going with GA4 when Search Console cannot be listed", async () => {
    const { deps } = fakeGoogle({ gscDisabled: true });
    const m = await buildMapping(deps);
    expect(m.gscError).toMatch(/enable the Google Search Console API/);
    expect(m.sites).toEqual([]);
    expect(renderMappingMarkdown(m)).toContain("- (Search Console unavailable)");
  });

  it("never matches or probes an unverified Search Console property", async () => {
    const { deps, calls } = fakeGoogle();
    const m = await buildMapping(deps);
    expect(m.sites.map((s) => s.siteUrl)).toEqual(["sc-domain:kweqoo.net", "https://other.example/"]);
    expect(m.unverifiedSites.map((s) => s.siteUrl)).toEqual(["https://kabuto-zukan.kweqoo.net/"]);
    await rangeFor(m, { days: 7 }, NOW, deps);
    expect(calls.some((c) => c.url.includes(encodeURIComponent("https://kabuto-zukan.kweqoo.net/")))).toBe(false);
    expect(renderMappingMarkdown(m)).toContain("skipped as unverified (siteUnverifiedUser): https://kabuto-zukan.kweqoo.net/");
  });
});

describe("rangeFor", () => {
  it("ends on the earliest last complete day among all visible Search Console properties", async () => {
    const { deps } = fakeGoogle();
    const m = await buildMapping(deps);
    const { range, problems } = await rangeFor(m, { days: 7 }, NOW, deps);
    expect(problems).toEqual([]);
    expect(range).toEqual({ start: "2026-09-27", end: "2026-10-03", basis: "search-console" });
  });

  it("reports a failed probe as a problem and marks the range partial", async () => {
    const { deps } = fakeGoogle({ failProbe: "https://other.example/" });
    const m = await buildMapping(deps);
    const { range, problems } = await rangeFor(m, { days: 7 }, NOW, deps);
    expect(range).toEqual({ start: "2026-09-28", end: "2026-10-04", basis: "partial" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ source: "searchConsole", subject: "https://other.example/" });
  });

  it("is partial without an error when a property answers but reports no boundary", async () => {
    const { deps } = fakeGoogle({ noBoundary: "https://other.example/" });
    const m = await buildMapping(deps);
    const { range, problems } = await rangeFor(m, { days: 7 }, NOW, deps);
    expect(range.basis).toBe("partial");
    expect(problems).toEqual([]);
    const md = renderReportMarkdown([], m, range, problems, []);
    expect(md).toContain("the others did not report one");
    expect(md).not.toContain("## Errors");
  });

  it("assumes the earliest yesterday when no property reports a boundary", async () => {
    const { deps } = fakeGoogle({ noBoundary: "sc-domain:kweqoo.net", failProbe: "https://other.example/" });
    const m = await buildMapping(deps);
    const { range } = await rangeFor(m, { days: 2 }, NOW, deps);
    // Yesterday: 2026-10-05 in Pacific Time, 2026-10-06 in Tokyo.
    expect(range).toEqual({ start: "2026-10-04", end: "2026-10-05", basis: "assumed" });
  });

  it("uses the GA4 time zones when there is no Search Console property", async () => {
    const { deps, calls } = fakeGoogle({ noGsc: true });
    const m = await buildMapping(deps);
    const { range } = await rangeFor(m, { days: 1 }, NOW, deps);
    expect(range).toEqual({ start: "2026-10-05", end: "2026-10-05", basis: "ga4" });
    expect(calls.some((c) => c.url.includes("/searchAnalytics/query"))).toBe(false);
  });

  it("uses a given range as is, without probing", async () => {
    const { deps, calls } = fakeGoogle();
    const m = await buildMapping(deps);
    const { range } = await rangeFor(m, { days: 7, start: "2026-09-01", end: "2026-09-30" }, NOW, deps);
    expect(range.basis).toBe("given");
    expect(calls.some((c) => c.body?.dataState === "all")).toBe(false);
  });
});

describe("collectRows", () => {
  it("has one row per GA4 hostName plus quiet stream hosts, with Search Console for the same host and dates", async () => {
    const { deps, calls } = fakeGoogle();
    const m = await buildMapping(deps);
    const range = { start: "2026-09-28", end: "2026-10-04", basis: "search-console" as const };
    const { rows, problems } = await collectRows(m, range, deps);
    expect(problems).toEqual([]);
    expect(rows.map((r) => [r.property.id, r.host, r.ga4?.users, r.gscTotals?.clicks ?? r.gscNote])).toEqual([
      ["1", "cars.printemps.tokyo", 10, "no Search Console property"],
      ["2", "kabuto-zukan.kweqoo.net", 40, 3],
      ["2", "toy-zukan.kweqoo.net", 5, 1],
      ["2", "(not set)", 1, "not a hostname"],
      ["2", "kweqoo.net", 0, 1],
      ["3", "", 0, "no web data stream and no traffic"],
    ]);
    expect(rows[1]?.gscAggregation).toBe("byPage");
    // GA4 and Search Console got the same explicit dates; Domain queries were filtered to each host.
    const ga4Dates = calls.filter((c) => c.url.includes(":runReport")).map((c) => JSON.stringify(c.body?.dateRanges));
    expect(new Set(ga4Dates)).toEqual(new Set([JSON.stringify([{ startDate: "2026-09-28", endDate: "2026-10-04" }])]));
    const finals = calls.filter((c) => c.body?.dataState === "final");
    expect(finals.every((c) => c.body?.startDate === "2026-09-28" && c.body?.endDate === "2026-10-04")).toBe(true);
    expect(finals.map((c) => JSON.stringify(c.body?.dimensionFilterGroups))).toContainEqual(expect.stringContaining("kabuto-zukan\\\\.kweqoo\\\\.net"));
    expect(unusedSites(m, rows).map((s) => s.siteUrl)).toEqual(["https://other.example/"]);

    const md = renderReportMarkdown(rows, m, range, problems, unusedSites(m, rows));
    expect(md).toContain(
      "| kabuto-zukan.kweqoo.net | keyword-lp | 40 | 42 | 120 | 3 | 120 | 2.5% | 8.4 | sc-domain:kweqoo.net (pages on kabuto-zukan.kweqoo.net) |",
    );
    expect(md).toContain("America/Los_Angeles, Asia/Tokyo");
    expect(md).toContain("aggregated by page");
    expect(md).toContain("no row used: https://other.example/");
    expect(md).not.toContain("## Errors");
    expect(md).toContain("| - | app only | 0 | 0 | 0 | - | - | - | - | - (no web data stream and no traffic) |");
    const json = JSON.parse(renderReportJson(rows, m, range, problems, unusedSites(m, rows)));
    expect(json.rows[1].searchConsole).toEqual({
      siteUrl: "sc-domain:kweqoo.net",
      filterHost: "kabuto-zukan.kweqoo.net",
      aggregation: "byPage",
      totals: { clicks: 3, impressions: 120, ctr: 0.025, position: 8.4 },
    });
    expect(json.errors).toEqual([]);
    expect(json.unverifiedSearchConsoleProperties).toEqual(["https://kabuto-zukan.kweqoo.net/"]);
  });

  it("keeps hostName casings apart, matches them in lowercase, and queries each Search Console scope once", async () => {
    const { deps, calls } = fakeGoogle({ caseVariants: true });
    const m = await buildMapping(deps);
    const range = { start: "2026-09-28", end: "2026-10-04", basis: "given" as const };
    const { rows } = await collectRows(m, range, deps);
    const cars = rows.filter((r) => r.property.id === "1");
    // The stream host is not added again in lowercase, and the casing is not added into another row.
    expect(cars.map((r) => [r.host, r.ga4?.users])).toEqual([
      ["cars.printemps.tokyo", 10],
      ["kabuto-zukan.kweqoo.net", 7],
      ["Cars.Printemps.Tokyo", 2],
    ]);
    expect(cars.filter((r) => r.host.toLowerCase() === "cars.printemps.tokyo").map((r) => r.gscNote)).toEqual([
      "no Search Console property",
      "no Search Console property",
    ]);
    // kabuto-zukan.kweqoo.net appears under properties 1 and 2 but is queried once.
    const kabuto = calls.filter((c) => c.body?.dataState === "final" && JSON.stringify(c.body?.dimensionFilterGroups).includes("kabuto"));
    expect(kabuto).toHaveLength(1);
    expect(rows.filter((r) => r.host === "kabuto-zukan.kweqoo.net").map((r) => r.gscTotals?.clicks)).toEqual([3, 3]);
  });

  it("passes GA4 report quality flags on as notes, without failing", async () => {
    const { deps } = fakeGoogle({
      ga4Meta: {
        dataLossFromOtherRow: true,
        subjectToThresholding: true,
        samplingMetadatas: [{}],
        dataTruncationReasons: [
          { dataTruncationType: "DATA_TRUNCATION_TYPE_DATE_RANGE", dataTruncationDate: "2026-09-30" },
          { dataTruncationMessage: "Data is truncated." },
        ],
      },
    });
    const m = await buildMapping(deps);
    const range = { start: "2026-09-28", end: "2026-10-04", basis: "given" as const };
    const { rows, problems, notes } = await collectRows(m, range, deps);
    expect(problems).toEqual([]);
    expect(notes.map((n) => n.note)).toEqual([
      'some hostnames were rolled into an "(other)" row, so a hostname shown with zeros may have traffic',
      "the report is subject to thresholding, so small numbers may be withheld",
      "the report is sampled",
      "the report is truncated (DATA_TRUNCATION_TYPE_DATE_RANGE, from 2026-09-30)",
      "the report is truncated (Data is truncated.)",
    ]);
    const md = renderReportMarkdown(rows, m, range, problems, [], notes);
    expect(md).toContain("## Notes");
    expect(md).toContain('- GA4 property 2: some hostnames were rolled into an "(other)" row');
    expect(JSON.parse(renderReportJson(rows, m, range, problems, [], notes)).notes).toHaveLength(5);
  });

  it("records a failing GA4 property as a problem and keeps its stream host row", async () => {
    const { deps } = fakeGoogle({ failGa4: "1" });
    const m = await buildMapping(deps);
    const range = { start: "2026-09-28", end: "2026-10-04", basis: "given" as const };
    const { rows, problems } = await collectRows(m, range, deps);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ source: "ga4", subject: "1" });
    expect(problems[0]?.error).toMatch(/HTTP 403/);
    expect(rows[0]).toMatchObject({ host: "cars.printemps.tokyo" });
    expect(rows[0]?.ga4).toBeUndefined();
    expect(rows[1]?.ga4).toBeDefined();
    const md = renderReportMarkdown(rows, m, range, problems, []);
    expect(md).toContain("| cars.printemps.tokyo | cars | error | error | error |");
    expect(md).toContain("## Errors");
    expect(md).toContain("- GA4 property 1: GA4 runReport for 1 failed");
  });
});
