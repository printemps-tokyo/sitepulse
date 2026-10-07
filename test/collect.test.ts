import { describe, expect, it } from "vitest";
import { buildMapping, collectRows, rangeFor } from "../src/collect.js";
import { renderMappingMarkdown, renderReportJson, renderReportMarkdown } from "../src/render.js";

interface Call {
  url: string;
  body?: Record<string, unknown>;
}

/** A fake Google: routes by URL, records calls. */
function fakeGoogle(opts: { gscDisabled?: boolean; failGa4?: string } = {}) {
  const calls: Call[] = [];
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ url, body });
    if (url.includes("/accountSummaries")) {
      return json({
        accountSummaries: [
          {
            displayName: "printemps.tokyo",
            propertySummaries: [
              { property: "properties/1", displayName: "cars" },
              { property: "properties/2", displayName: "keyword-lp" },
              { property: "properties/3", displayName: "app only" },
            ],
          },
        ],
      });
    }
    if (url.includes("/properties/1/dataStreams")) return json({ dataStreams: [{ type: "WEB_DATA_STREAM", webStreamData: { defaultUri: "https://cars.printemps.tokyo" } }] });
    if (url.includes("/properties/2/dataStreams")) return json({ dataStreams: [{ type: "WEB_DATA_STREAM", webStreamData: { defaultUri: "https://kweqoo.net" } }] });
    if (url.includes("/properties/3/dataStreams")) return json({ dataStreams: [{ type: "IOS_APP_DATA_STREAM" }] });
    if (url.includes(":runReport")) {
      if (opts.failGa4 && url.includes(`/properties/${opts.failGa4}:`)) return json({ error: { message: "denied" } }, 403);
      return json({ rows: [{ metricValues: [{ value: "10" }, { value: "12" }, { value: "30" }] }] });
    }
    if (url.endsWith("/webmasters/v3/sites")) {
      if (opts.gscDisabled) return json({ error: { message: "Google Search Console API has not been used in project 1" } }, 403);
      return json({ siteEntry: [{ siteUrl: "sc-domain:kweqoo.net", permissionLevel: "siteFullUser" }, { siteUrl: "https://other.example/", permissionLevel: "siteOwner" }] });
    }
    if (url.includes("/searchAnalytics/query")) {
      if (body?.dataState === "all") return json({ rows: [], metadata: { firstIncompleteDate: "2026-10-05" } });
      return json({ rows: [{ clicks: 3, impressions: 120, ctr: 0.025, position: 8.4 }], responseAggregationType: "byPage" });
    }
    return json({ error: { message: `unexpected ${url}` } }, 404);
  }) as typeof fetch;
  return { calls, deps: { token: "t", fetchFn, sleep: async () => {} } };
}

describe("buildMapping", () => {
  it("matches web stream hosts and lists what is left over", async () => {
    const { deps } = fakeGoogle();
    const m = await buildMapping(deps);
    expect(m.pairs.map((p) => [p.property.id, p.host, p.gsc?.site.siteUrl ?? p.gscNote])).toEqual([
      ["1", "cars.printemps.tokyo", "no Search Console property"],
      ["2", "kweqoo.net", "sc-domain:kweqoo.net"],
      ["3", "", "no web data stream"],
    ]);
    expect(m.pairs[1]?.gsc?.filterHost).toBe("kweqoo.net");
    expect(m.unmatchedSites.map((s) => s.siteUrl)).toEqual(["https://other.example/"]);
    expect(renderMappingMarkdown(m)).toContain("| keyword-lp | 2 | kweqoo.net | sc-domain:kweqoo.net (pages on kweqoo.net) |");
  });

  it("keeps going with GA4 when Search Console cannot be listed", async () => {
    const { deps } = fakeGoogle({ gscDisabled: true });
    const m = await buildMapping(deps);
    expect(m.gscError).toMatch(/enable the Google Search Console API/);
    expect(m.pairs.every((p) => !p.gsc)).toBe(true);
    expect(m.pairs[0]?.gscNote).toBe("Search Console unavailable");
  });
});

describe("rangeFor and collectRows", () => {
  it("shares one range across rows, ending on the last complete Search Console day", async () => {
    const { deps, calls } = fakeGoogle();
    const m = await buildMapping(deps);
    const range = await rangeFor(m, { days: 7 }, "2026-10-06", deps);
    expect(range).toEqual({ start: "2026-09-28", end: "2026-10-04", basis: "search-console" });
    const rows = await collectRows(m, range, deps);
    expect(rows[0]?.ga4).toEqual({ users: 10, sessions: 12, pageviews: 30 });
    expect(rows[1]?.gscTotals).toEqual({ clicks: 3, impressions: 120, ctr: 0.025, position: 8.4 });
    expect(rows[0]?.gscTotals).toBeUndefined();
    // GA4 and Search Console got the same explicit dates; the Domain property was filtered to the host.
    const ga4Bodies = calls.filter((c) => c.url.includes(":runReport")).map((c) => c.body?.dateRanges);
    expect(ga4Bodies.every((d) => JSON.stringify(d) === JSON.stringify([{ startDate: "2026-09-28", endDate: "2026-10-04" }]))).toBe(true);
    const final = calls.find((c) => c.url.includes("/searchAnalytics/query") && c.body?.dataState === "final");
    expect(final?.body?.startDate).toBe("2026-09-28");
    expect(JSON.stringify(final?.body?.dimensionFilterGroups)).toContain("kweqoo\\\\.net");

    const md = renderReportMarkdown(rows, m, range);
    expect(md).toContain("| cars.printemps.tokyo | cars | 10 | 12 | 30 | - | - | - | - | - (no Search Console property) |");
    expect(md).toContain("| kweqoo.net | keyword-lp | 10 | 12 | 30 | 3 | 120 | 2.5% | 8.4 | sc-domain:kweqoo.net (pages on kweqoo.net) |");
    expect(md).toContain("aggregated by page");
    const json = JSON.parse(renderReportJson(rows, m, range));
    expect(json.rows[1].searchConsole).toEqual({
      siteUrl: "sc-domain:kweqoo.net",
      filterHost: "kweqoo.net",
      totals: { clicks: 3, impressions: 120, ctr: 0.025, position: 8.4 },
    });
  });

  it("uses a given range as is, without probing", async () => {
    const { deps, calls } = fakeGoogle();
    const m = await buildMapping(deps);
    const range = await rangeFor(m, { days: 7, start: "2026-09-01", end: "2026-09-30" }, "2026-10-06", deps);
    expect(range.basis).toBe("given");
    expect(calls.some((c) => c.body?.dataState === "all")).toBe(false);
  });

  it("records a failing GA4 property without stopping the rest", async () => {
    const { deps } = fakeGoogle({ failGa4: "1" });
    const m = await buildMapping(deps);
    const rows = await collectRows(m, { start: "7daysAgo", end: "yesterday", basis: "ga4" }, deps);
    expect(rows[0]?.ga4Error).toMatch(/HTTP 403/);
    expect(rows[1]?.ga4).toBeDefined();
    // With a GA4-only range there are no Search Console numbers.
    expect(rows[1]?.gscTotals).toBeUndefined();
    expect(renderReportMarkdown(rows, m, { start: "7daysAgo", end: "yesterday", basis: "ga4" })).toContain("## Errors");
  });
});
