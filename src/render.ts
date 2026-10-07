/** Markdown and JSON output. Pure. */

import type { Mapping, Row } from "./collect.js";
import { daysBetween, type Range } from "./match.js";

function int(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function gscLabel(r: { gsc?: Mapping["pairs"][number]["gsc"]; gscNote?: string }): string {
  if (!r.gsc) return `- (${r.gscNote ?? "no match"})`;
  return r.gsc.filterHost ? `${r.gsc.site.siteUrl} (pages on ${r.gsc.filterHost})` : r.gsc.site.siteUrl;
}

/** One line about the range and what it means for each source. */
export function describeRange(range: Range): string {
  switch (range.basis) {
    case "given":
      return `${range.start}..${range.end}, as given. GA4 reads the dates in each property's time zone, Search Console in Pacific Time; Search Console counts complete data only.`;
    case "search-console":
      return `${range.start}..${range.end} (${daysBetween(range.start, range.end)} days), ending on the earliest last day of complete Search Console data among the matched properties. GA4 reads the same dates in each property's time zone, Search Console in Pacific Time.`;
    case "assumed":
      return `${range.start}..${range.end}: Search Console did not report where complete data ends, so the range ends yesterday (Pacific Time) and its newest days may still change. GA4 reads the same dates in each property's time zone.`;
    case "ga4":
      return `GA4 ${range.start}..${range.end} in each property's time zone. No property matched in Search Console, so there are no Search Console numbers.`;
  }
}

export function renderMappingMarkdown(m: Mapping): string {
  const lines = ["# sitepulse: GA4 properties and their Search Console match", ""];
  lines.push("| GA4 property | ID | Host | Search Console |", "| --- | --- | --- | --- |");
  for (const p of m.pairs) {
    lines.push(`| ${cell(p.property.name)} | ${p.property.id} | ${cell(p.host || "-")} | ${cell(gscLabel(p))} |`);
  }
  if (m.unmatchedSites.length > 0) {
    lines.push("", `Search Console properties no GA4 property matched: ${m.unmatchedSites.map((s) => s.siteUrl).join(", ")}.`);
  }
  appendProblems(lines, m);
  return lines.join("\n") + "\n";
}

function appendProblems(lines: string[], m: Mapping, rows: Row[] = []): void {
  const problems = [
    ...(m.gscError ? [`Search Console: ${m.gscError}`] : []),
    ...m.errors.map((e) => `GA4 ${e.propertyId}: ${e.error}`),
    ...rows.flatMap((r) => [
      ...(r.ga4Error ? [`GA4 ${r.property.id}: ${r.ga4Error}`] : []),
      ...(r.gscError ? [`Search Console ${r.gsc?.site.siteUrl ?? ""}: ${r.gscError}`] : []),
    ]),
  ];
  if (problems.length > 0) {
    lines.push("", "## Errors");
    for (const p of problems) lines.push(`- ${p}`);
  }
}

export function renderReportMarkdown(rows: Row[], m: Mapping, range: Range): string {
  const lines = ["# sitepulse", "", describeRange(range), ""];
  lines.push(
    "| Site | GA4 property | Users | Sessions | Pageviews | Clicks | Impressions | CTR | Position | Search Console |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  );
  for (const r of rows) {
    const ga = r.ga4 ? [int(r.ga4.users), int(r.ga4.sessions), int(r.ga4.pageviews)] : ["error", "error", "error"];
    const g = r.gscTotals;
    const sc = g
      ? [
          int(g.clicks),
          int(g.impressions),
          `${(g.ctr * 100).toFixed(1)}%`,
          g.impressions > 0 && g.position !== null ? g.position.toFixed(1) : "-",
        ]
      : r.gscError
        ? ["error", "error", "error", "error"]
        : ["-", "-", "-", "-"];
    lines.push(`| ${cell(r.host || "-")} | ${cell(r.property.name)} | ${[...ga, ...sc].join(" | ")} | ${cell(gscLabel(r))} |`);
  }
  if (rows.some((r) => r.gsc?.filterHost)) {
    lines.push(
      "",
      "Where Search Console shows \"pages on <host>\", a Domain property is filtered to that host's pages, so its numbers are aggregated by page.",
    );
  }
  if (m.unmatchedSites.length > 0) {
    lines.push("", `Search Console properties no GA4 property matched: ${m.unmatchedSites.map((s) => s.siteUrl).join(", ")}.`);
  }
  appendProblems(lines, m, rows);
  return lines.join("\n") + "\n";
}

export function renderReportJson(rows: Row[], m: Mapping, range: Range): string {
  return (
    JSON.stringify(
      {
        range,
        rows: rows.map((r) => ({
          ga4Property: { id: r.property.id, name: r.property.name, account: r.property.account, hosts: r.property.hosts },
          host: r.host,
          ga4: r.ga4 ?? null,
          ...(r.ga4Error ? { ga4Error: r.ga4Error } : {}),
          searchConsole: r.gsc
            ? { siteUrl: r.gsc.site.siteUrl, ...(r.gsc.filterHost ? { filterHost: r.gsc.filterHost } : {}), totals: r.gscTotals ?? null }
            : null,
          ...(r.gscError ? { gscError: r.gscError } : {}),
          ...(r.gscNote ? { gscNote: r.gscNote } : {}),
        })),
        unmatchedSearchConsoleProperties: m.unmatchedSites.map((s) => s.siteUrl),
        errors: [...(m.gscError ? [{ source: "searchConsole", error: m.gscError }] : []), ...m.errors.map((e) => ({ source: "ga4", ...e }))],
      },
      null,
      2,
    ) + "\n"
  );
}

export function renderMappingJson(m: Mapping): string {
  return JSON.stringify(m, null, 2) + "\n";
}
