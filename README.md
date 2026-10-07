# sitepulse

> GA4 and Google Search Console side by side, one row per site: users, sessions, pageviews, clicks, impressions, CTR and position. Zero-dependency CLI.

[![CI](https://github.com/printemps-tokyo/sitepulse/actions/workflows/ci.yml/badge.svg)](https://github.com/printemps-tokyo/sitepulse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

```console
$ sitepulse --days 7
# sitepulse

2026-09-28..2026-10-04 (7 days), ending on the earliest last day of complete Search Console data among the matched properties. ...

| Site | GA4 property | Users | Sessions | Pageviews | Clicks | Impressions | CTR | Position | Search Console |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| example.com | example.com | 1,466 | 2,156 | 6,246 | 41 | 3,210 | 1.3% | 18.4 | sc-domain:example.com (pages on example.com) |
| blog.example.com | Blog | 660 | 818 | 808 | - | - | - | - | - (no Search Console property) |
```

One service account, one command: every GA4 property it can see, each next
to the Search Console property for the same site.

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
sitepulse                                   # last 7 days, every site
sitepulse --days 28
sitepulse --start 2026-09-01 --end 2026-09-30
sitepulse --list                            # how sites were matched, no numbers
sitepulse --format json -o week.json
```

| Option | Description | Default |
| --- | --- | --- |
| `--days <n>` | Days to report | `7` |
| `--start <date>` `--end <date>` | A fixed range, `YYYY-MM-DD`, for both sources; replaces `--days` | |
| `--list` | Show the GA4 to Search Console matching only | |
| `--key-file <path>` | Service-account JSON key (or `GOOGLE_APPLICATION_CREDENTIALS`) | |
| `--token <token>` | An OAuth access token with both `analytics.readonly` and `webmasters.readonly` (or `SITEPULSE_ACCESS_TOKEN`) | |
| `--format <md\|json>` | Output format | `md` |
| `-o, --output <file>` | Write to a file | stdout |

Credentials are taken in this order: `--token`, `--key-file`,
`SITEPULSE_ACCESS_TOKEN`, `GOOGLE_APPLICATION_CREDENTIALS`.

Exit codes: 0 on success; 1 on any error. A property that fails is shown as
an error in its row and listed under Errors, the rest are printed, and the
exit code is 1. If Search Console cannot be listed at all (for example its API
is not enabled), the GA4 columns are still printed.

## How sites are matched

- Sites are the GA4 properties the credentials can see
  ([accountSummaries.list](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list)).
- Each property's site is the host of its web data streams'
  `webStreamData.defaultUri`
  ([dataStreams.list](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties.dataStreams/list)),
  not the property's display name, which is free text.
- That host is matched to a Search Console property: a URL-prefix property
  at the root of the same host (https first), otherwise the closest Domain
  property that covers it (`sc-domain:example.com` covers `example.com` and
  `blog.example.com`). A Domain property is filtered to the host's pages so
  it lines up with the GA4 stream; Search Console then aggregates by page.
- Run `--list` to see the matching. Search Console properties no GA4 property
  matched are listed at the end.

## How the range is chosen

- All rows share one range, so they can be compared.
- By default it ends on the last day of complete Search Console data: each
  matched property is asked once for fresh data and its
  `metadata.firstIncompleteDate`, and the range ends on the earliest day
  before one of those dates
  ([searchAnalytics.query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)).
  If none reports a date, it ends yesterday (Pacific Time) and says so.
- If no property matched in Search Console, GA4's own relative range is used
  (`7daysAgo`..`yesterday`).
- GA4 reads dates in each property's reporting time zone
  ([DateRange](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/DateRange));
  Search Console reads them in Pacific Time. For the same calendar dates the
  two can cover slightly different hours.

## What the numbers are

- GA4: `totalUsers`, `sessions`, `screenPageViews` from a report with no
  dimensions, so users and sessions are GA4's own deduplicated totals for
  the range.
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
