/** Public API for sitepulse: GA4 and Search Console side by side. */

export type { ServiceAccount, Ga4Property, GscSite, Ga4Totals, GscTotals } from "./types.js";
export { requestAccessToken, SCOPES } from "./auth.js";
export { ga4AccountSummaries, ga4DataStreams, ga4Totals, gscSites, gscQuery, gscTotalsOf } from "./google.js";
export type { Deps, Ga4Range, GscQueryBody, GscQueryResponse } from "./google.js";
export { hostOf, matchGsc, hostFilterExpression, todayPT, addDays, isDate, daysBetween, lastCompleteDay, chooseRange } from "./match.js";
export type { GscMatch, Range } from "./match.js";
export { buildMapping, rangeFor, collectRows } from "./collect.js";
export type { Pair, Mapping, Row, ReportOptions } from "./collect.js";
export { describeRange, renderMappingMarkdown, renderMappingJson, renderReportMarkdown, renderReportJson } from "./render.js";
