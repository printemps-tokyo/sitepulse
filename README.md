# sitepulse

> GA4 and Google Search Console side by side, one row per hostname: users, sessions, pageviews, clicks, impressions, CTR and position. Zero-dependency CLI.

[![CI](https://github.com/printemps-tokyo/sitepulse/actions/workflows/ci.yml/badge.svg)](https://github.com/printemps-tokyo/sitepulse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

```console
$ sitepulse --days 7
# sitepulse

2026-09-28..2026-10-04 (7 days), ending on the earliest last day of complete Search Console data. GA4 reads the dates in each property's time zone (Asia/Tokyo), Search Console in Pacific Time, so the same dates can cover slightly different hours.

| Host | GA4 property | Users | Sessions | Pageviews | Clicks | Impressions | CTR | Position | Search Console |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| example.com | example.com | 1,466 | 2,156 | 6,246 | 41 | 3,210 | 1.3% | 18.4 | sc-domain:example.com (pages on example.com) |
| shop.example.com | example.com | 210 | 245 | 980 | 12 | 902 | 1.3% | 9.7 | sc-domain:example.com (pages on shop.example.com) |
| blog.example.org | Blog | 660 | 818 | 808 | - | - | - | - | - (no Search Console property) |
```

One service account, one command: every hostname your GA4 properties
recorded, each next to the Search Console numbers for the same host and the
same dates.

## Requirements

- Node.js >= 20
- A Google service account that is a Viewer of your GA4 properties and a user
  of your Search Console properties

## One-time setup

1. In Google Cloud, create a service account and download its JSON key (or
   reuse the one you use for the `ga4` or `gsc` CLIs).
2. Enable, in that project: Google Analytics Admin API, Google Analytics Data
   API, Google Search Console API.
3. In GA4, add the service account's email as a Viewer (account or property
   access management).
4. In Search Console, add it as a user of each property (Settings -> Users and
   permissions).

## Install

Not published to npm yet; install from source:

```bash
git clone https://github.com/printemps-tokyo/sitepulse
cd sitepulse
npm install && npm run build
npm link   # optional: puts the `sitepulse` command on your PATH
```

## Usage

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
sitepulse                                   # last 7 days, every hostname
sitepulse --days 28
sitepulse --start 2026-09-01 --end 2026-09-30
sitepulse --list                            # stream hosts and their matches, no numbers
sitepulse --format json -o week.json
```

| Option | Description | Default |
| --- | --- | --- |
| `--days <n>` | Days to report | `7` |
| `--start <date>` `--end <date>` | A fixed range, `YYYY-MM-DD`, for both sources; replaces `--days` | |
| `--list` | Show each property's web stream hosts, time zone and Search Console match only | |
| `--key-file <path>` | Service-account JSON key (or `GOOGLE_APPLICATION_CREDENTIALS`) | |
| `--token <token>` | An OAuth access token with both `analytics.readonly` and `webmasters.readonly` (or `SITEPULSE_ACCESS_TOKEN`) | |
| `--format <md\|json>` | Output format | `md` |
| `-o, --output <file>` | Write to a file | stdout |

Credentials: pass at most one of `--token` and `--key-file` (both is an
error); either wins over the environment. Without them, `SITEPULSE_ACCESS_TOKEN`
is used, then `GOOGLE_APPLICATION_CREDENTIALS`.

Exit codes: 0 on success; 1 on any error. Anything that fails (a GA4
property, a Search Console query, a Search Console range probe) is shown as
`error` in its row where it has one and listed under Errors; everything else
is still printed, and the exit code is 1. If Search Console cannot be listed
at all (for example its API is not enabled), the GA4 columns are still
printed.

## What a row is

- One row per hostname a GA4 property recorded in the range (the `hostName`
  dimension, "the subdomain and domain names of a URL";
  [API schema](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema)),
  for every property the credentials can see
  ([accountSummaries.list](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list)).
  One GA4 tag often serves several subdomains, so a property can have several
  rows, sorted by users.
- The hostname of each web data stream's `webStreamData.defaultUri`
  ([dataStreams.list](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties.dataStreams/list))
  also gets a row, with zeros if it recorded nothing, so a quiet site still
  shows. A hostName that is not a hostname (such as `(not set)`) gets a row
  without Search Console numbers.
- Each hostname (in lowercase) is matched to a Search Console property: a
  URL-prefix property at the root of the same host on the default port
  (https first; it covers only that protocol's pages), otherwise the closest
  Domain property that covers it (`sc-domain:example.com` covers
  `example.com` and `shop.example.com`). A Domain property is filtered to the
  host's pages (http or https, any port), so Search Console aggregates by
  page; the JSON output gives each row's `aggregation`.
- Properties listed with `siteUnverifiedUser` permission cannot be queried, so
  they are never matched and are listed under Notes.
- The same Search Console property and host is queried once, even when
  several GA4 properties recorded that host.
- Run `--list` to see each property's stream hosts and their matches. Search
  Console properties no row used are listed at the end of a report.

## How the range is chosen

- All rows share one range of explicit dates, used for both GA4 and Search
  Console, so they can be compared.
- By default it ends on the last day of complete Search Console data: every
  visible Search Console property is asked once for fresh data and its
  `metadata.firstIncompleteDate`, and the range ends on the earliest day
  before one of those dates
  ([searchAnalytics.query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)).
  - If some properties report a date and some do not (or the request fails),
    the range ends on the earliest reported one, and failures are listed
    under Errors.
  - If none reports a date, the range ends on the earliest "yesterday" among
    Pacific Time and the GA4 properties' time zones, and says so.
- With no Search Console property visible, it ends on the earliest
  "yesterday" among the GA4 properties' time zones
  ([properties.get](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties)
  `timeZone`).
- GA4 reads dates in each property's reporting time zone
  ([DateRange](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/DateRange));
  Search Console reads them in Pacific Time. For the same calendar dates the
  two can cover slightly different hours; the report names the time zones.

## What the numbers are

- GA4: `totalUsers`, `sessions`, `screenPageViews` per `hostName`, so users
  and sessions are GA4's own deduplicated totals for that hostname over the
  range. Rows are never added together, so hostName values that differ only
  in case stay separate rows.
- When GA4 says a report is thresholded, sampled, truncated or has an
  `(other)` row
  ([ResponseMetaData](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/ResponseMetaData)),
  that is listed under Notes; it does not change the exit code.
- Search Console: clicks, impressions, CTR and average position from a query
  with no dimensions and complete data only (`dataState: final`); position
  shows `-` when there were no impressions.

## Security

- The service-account key grants read access to your analytics and search
  data; keep it out of version control and restrict its file permissions.
- sitepulse reads the key only to mint a short-lived token. Requests go
  directly to Google's APIs, time out after 30 seconds, and are retried twice
  on server errors.

## License

[MIT](./LICENSE) (c) printemps.tokyo
