#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";

import { requestAccessToken } from "./auth.js";
import { buildMapping, collectRows, rangeFor, unusedSites } from "./collect.js";
import { isDate, todayPT } from "./match.js";
import { renderMappingJson, renderMappingMarkdown, renderReportJson, renderReportMarkdown } from "./render.js";
import type { ServiceAccount } from "./types.js";

const HELP = `sitepulse - GA4 and Search Console side by side, one row per site

Usage:
  sitepulse [--days <n>] [options]   Users, sessions, pageviews, clicks,
                                     impressions, CTR and position per site
  sitepulse --list                   How GA4 properties were matched to
                                     Search Console properties

One row per hostname each GA4 property recorded (its hostName dimension),
matched to a Search Console property for the same host: a URL-prefix property
at that host, else a Domain property covering it, filtered to the host's
pages. GA4 and Search Console use the same dates.

Options:
  --days <n>          Days to report (default: 7). The range ends on the last
                      day of complete Search Console data, shared by all rows.
  --start <date>      With --end: a fixed range, YYYY-MM-DD, for both sources
  --end <date>
  --key-file <path>   Service-account JSON key (or env GOOGLE_APPLICATION_CREDENTIALS)
  --token <token>     An OAuth access token with both the analytics.readonly and
                      webmasters.readonly scopes (or env SITEPULSE_ACCESS_TOKEN).
                      Pass one of --key-file and --token, not both; either wins
                      over the environment variables.
  --format <md|json>  Output format (default: md)
  -o, --output <file> Write to a file (default: stdout)
  -h, --help          Show this help
  -v, --version       Show version

Setup: one service account, added as a Viewer in GA4 and as a user in Search
Console; enable the Google Analytics Admin API, the Google Analytics Data API
and the Google Search Console API in its Google Cloud project.
`;

async function readVersion(): Promise<string> {
  const { fileURLToPath } = await import("node:url");
  const { join, dirname } = await import("node:path");
  try {
    const raw = await readFile(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8");
    return (JSON.parse(raw) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

/** --token, --key-file, then SITEPULSE_ACCESS_TOKEN, then GOOGLE_APPLICATION_CREDENTIALS. */
async function resolveToken(keyFile: string | undefined, token: string | undefined): Promise<string> {
  if (token && keyFile) throw new Error("pass either --token or --key-file, not both");
  if (token) return token;
  if (!keyFile && process.env.SITEPULSE_ACCESS_TOKEN) return process.env.SITEPULSE_ACCESS_TOKEN;
  const path = keyFile ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) {
    throw new Error("no credentials: pass --key-file or --token, or set GOOGLE_APPLICATION_CREDENTIALS");
  }
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(await readFile(path, "utf8")) as ServiceAccount;
  } catch (err) {
    throw new Error(`cannot read service-account key "${path}": ${(err as Error).message}`);
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error(`"${path}" is not a service-account key (missing client_email/private_key)`);
  }
  return requestAccessToken(sa);
}

async function main(): Promise<number> {
  const raw = process.argv.slice(2);
  if (raw.includes("-h") || raw.includes("--help")) {
    process.stdout.write(HELP);
    return 0;
  }
  if (raw.includes("-v") || raw.includes("--version")) {
    process.stdout.write((await readVersion()) + "\n");
    return 0;
  }
  let values;
  try {
    values = parseArgs({
      args: raw,
      allowPositionals: false,
      options: {
        list: { type: "boolean" },
        days: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        "key-file": { type: "string" },
        token: { type: "string" },
        format: { type: "string" },
        output: { type: "string", short: "o" },
      },
    }).values;
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\nrun 'sitepulse --help' for usage.\n`);
    return 1;
  }

  const format = values.format ?? "md";
  const today = todayPT();
  let days = 7;
  try {
    if (format !== "md" && format !== "json") throw new Error("--format must be md or json");
    if (values.list && (values.days || values.start || values.end)) throw new Error("--list takes no range options");
    if ((values.start === undefined) !== (values.end === undefined)) throw new Error("--start and --end go together");
    if (values.start !== undefined) {
      if (values.days !== undefined) throw new Error("--start/--end replace --days; pass one or the other");
      if (!isDate(values.start) || !isDate(values.end!)) throw new Error("--start and --end must be dates in YYYY-MM-DD form");
      if (values.start > values.end!) throw new Error("--start must not be after --end");
      if (values.end! > today) throw new Error(`--end ${values.end} is in the future (today is ${today} in Pacific Time)`);
    }
    if (values.days !== undefined) {
      days = Number(values.days);
      if (!Number.isInteger(days) || days < 1) throw new Error("--days must be a positive integer");
    }
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    return 1;
  }

  try {
    const token = await resolveToken(values["key-file"], values.token);
    const deps = { token };
    const mapping = await buildMapping(deps);
    let output: string;
    let failed = mapping.problems.length > 0 || mapping.gscError !== undefined;
    if (values.list) {
      output = format === "json" ? renderMappingJson(mapping) : renderMappingMarkdown(mapping);
    } else {
      const fixed = values.start ? { start: values.start, end: values.end } : {};
      const { range, problems: rangeProblems } = await rangeFor(mapping, { days, ...fixed }, new Date(), deps);
      const { rows, problems: rowProblems } = await collectRows(mapping, range, deps);
      const problems = [...rangeProblems, ...rowProblems];
      failed ||= problems.length > 0;
      const unused = unusedSites(mapping, rows);
      output =
        format === "json"
          ? renderReportJson(rows, mapping, range, problems, unused)
          : renderReportMarkdown(rows, mapping, range, problems, unused);
    }
    if (values.output) {
      await writeFile(values.output, output, "utf8");
      process.stderr.write(`sitepulse: wrote ${values.output}\n`);
    } else {
      process.stdout.write(output);
    }
    return failed ? 1 : 0;
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    return 1;
  }
}

// Let Node exit on its own so a large piped output is not cut short.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  },
);
