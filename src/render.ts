/** Markdown and JSON output. Pure. */

import type { Mapping, Note, Problem, Row } from "./collect.js";
import { daysBetween, matchGsc, type GscMatch, type Range } from "./match.js";
import type { GscSite } from "./types.js";

function int(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function gscLabel(gsc: GscMatch | undefined, note: string | undefined): string {
  if (!gsc) return `- (${note ?? "no match"})`;
  return gsc.filterHost ? `${gsc.site.siteUrl} (pages on ${gsc.filterHost})` : gsc.site.siteUrl;
}

function timeZones(m: Mapping): string[] {
  return [...new Set(m.properties.map((p) => p.timeZone).filter(Boolean))];
}

/** One paragraph about the range and what it means for each source. */
export function describeRange(range: Range, zones: string[] = []): string {
  const days = `${range.start}..${range.end} (${daysBetween(range.start, range.end)} days)`;
  const tz =
    zones.length > 0
      ? `GA4 reads the dates in each property's time zone (${zones.join(", ")}), Search Console in Pacific Time, so the same dates can cover slightly different hours.`
      : "GA4 reads the dates in each property's time zone, Search Console in Pacific Time.";
  switch (range.basis) {
    case "given":
      return `${days}, as given. Search Console counts complete data only. ${tz}`;
    case "search-console":
      return `${days}, ending on the earliest last day of complete Search Console data. ${tz}`;
    case "partial":
      return `${days}, ending on the earliest last day of complete Search Console data among the properties that reported one; the others did not report one (failed requests are listed under Errors), so their newest days may still change. ${tz}`;
    case "assumed":
      return `${days}: Search Console did not report where complete data ends, so the range ends on the last day that has ended in every time zone involved, and Search Console's newest days may still change. ${tz}`;
    case "ga4":
      return `${days}, ending on the last day that has ended in every GA4 property's time zone; GA4 may still be processing the newest days, so they can change. No Search Console property is visible, so there are no Search Console numbers.`;
  }
}

function allProblems(m: Mapping, problems: Problem[]): Problem[] {
  return [
    ...(m.gscError ? [{ source: "searchConsole" as const, subject: "sites.list", error: m.gscError }] : []),
    ...m.problems,
    ...problems,
  ];
}

function label(source: Problem["source"]): string {
  return source === "ga4" ? "GA4 property" : "Search Console";
}

function appendProblems(lines: string[], m: Mapping, problems: Problem[]): void {
  const all = allProblems(m, problems);
  if (all.length === 0) return;
  lines.push("", "## Errors");
  for (const p of all) lines.push(`- ${label(p.source)} ${p.subject}: ${p.error}`);
}

function appendNotes(lines: string[], m: Mapping, notes: Note[]): void {
  const all = [
    ...(m.unverifiedSites.length > 0
      ? [`Search Console properties skipped as unverified (siteUnverifiedUser): ${m.unverifiedSites.map((s) => s.siteUrl).join(", ")}.`]
      : []),
    ...notes.map((n) => `${label(n.source)} ${n.subject}: ${n.note}.`),
  ];
  if (all.length === 0) return;
  lines.push("", "## Notes");
  for (const n of all) lines.push(`- ${n}`);
}

/** --list: each GA4 property, its stream hosts, and the Search Console property each host would use. */
export function renderMappingMarkdown(m: Mapping): string {
  const lines = ["# sitepulse: GA4 properties and their Search Console match", ""];
  lines.push("| GA4 property | ID | Time zone | Stream host | Search Console |", "| --- | --- | --- | --- | --- |");
  for (const p of m.properties) {
    for (const host of p.hosts.length > 0 ? p.hosts : [""]) {
      const gsc = host ? matchGsc(host, m.sites) : undefined;
      const note = !host ? "no web data stream" : m.gscError ? "Search Console unavailable" : "no Search Console property";
      lines.push(`| ${cell(p.name)} | ${p.id} | ${p.timeZone || "-"} | ${cell(host || "-")} | ${cell(gscLabel(gsc, note))} |`);
    }
  }
  lines.push(
    "",
    "Reports have one row per hostname GA4 recorded, which can differ from the stream hosts above (one tag can serve several subdomains); each is matched the same way.",
  );
  appendNotes(lines, m, []);
  appendProblems(lines, m, []);
  return lines.join("\n") + "\n";
}

export function renderReportMarkdown(rows: Row[], m: Mapping, range: Range, problems: Problem[], unused: GscSite[], notes: Note[] = []): string {
  const lines = ["# sitepulse", "", describeRange(range, timeZones(m)), ""];
  lines.push(
    "| Host | GA4 property | Users | Sessions | Pageviews | Clicks | Impressions | CTR | Position | Search Console |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  );
  for (const r of rows) {
    const ga = r.ga4 ? [int(r.ga4.users), int(r.ga4.sessions), int(r.ga4.pageviews)] : ["error", "error", "error"];
    const g = r.gscTotals;
    const sc = g
      ? [int(g.clicks), int(g.impressions), `${(g.ctr * 100).toFixed(1)}%`, g.impressions > 0 && g.position !== null ? g.position.toFixed(1) : "-"]
      : r.gsc
        ? ["error", "error", "error", "error"]
        : ["-", "-", "-", "-"];
    lines.push(`| ${cell(r.host || "-")} | ${cell(r.property.name)} | ${[...ga, ...sc].join(" | ")} | ${cell(gscLabel(r.gsc, r.gscNote))} |`);
  }
  lines.push("", "One row per hostname GA4 recorded; Search Console numbers are for the same host.");
  if (rows.some((r) => r.gscAggregation === "byPage")) {
    lines.push('Where Search Console shows "pages on <host>", a Domain property is filtered to that host\'s pages, so its numbers are aggregated by page.');
  }
  if (unused.length > 0) {
    lines.push("", `Search Console properties no row used: ${unused.map((s) => s.siteUrl).join(", ")}.`);
  }
  appendNotes(lines, m, notes);
  appendProblems(lines, m, problems);
  return lines.join("\n") + "\n";
}

export function renderReportJson(rows: Row[], m: Mapping, range: Range, problems: Problem[], unused: GscSite[], notes: Note[] = []): string {
  return (
    JSON.stringify(
      {
        range,
        timeZones: timeZones(m),
        rows: rows.map((r) => ({
          host: r.host,
          ga4Property: { id: r.property.id, name: r.property.name, account: r.property.account, timeZone: r.property.timeZone },
          ga4: r.ga4 ?? null,
          searchConsole: r.gsc
            ? {
                siteUrl: r.gsc.site.siteUrl,
                ...(r.gsc.filterHost ? { filterHost: r.gsc.filterHost } : {}),
                aggregation: r.gscAggregation ?? null,
                totals: r.gscTotals ?? null,
              }
            : null,
          ...(r.gscNote ? { searchConsoleNote: r.gscNote } : {}),
        })),
        unusedSearchConsoleProperties: unused.map((s) => s.siteUrl),
        unverifiedSearchConsoleProperties: m.unverifiedSites.map((s) => s.siteUrl),
        notes,
        errors: allProblems(m, problems),
      },
      null,
      2,
    ) + "\n"
  );
}

export function renderMappingJson(m: Mapping): string {
  return (
    JSON.stringify(
      {
        properties: m.properties.map((p) => ({
          ...p,
          matches: p.hosts.map((host) => {
            const g = matchGsc(host, m.sites);
            return { host, searchConsole: g ? { siteUrl: g.site.siteUrl, ...(g.filterHost ? { filterHost: g.filterHost } : {}) } : null };
          }),
        })),
        searchConsoleProperties: m.sites,
        unverifiedSearchConsoleProperties: m.unverifiedSites,
        errors: allProblems(m, []),
      },
      null,
      2,
    ) + "\n"
  );
}
