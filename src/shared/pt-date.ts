/**
 * Calendar dates for Search Console, which works in Pacific Time: the API
 * reference describes startDate and endDate as "YYYY-MM-DD format, in PT
 * time (UTC - 7:00/8:00)".
 *
 * Shared verbatim by gsc and sitepulse (src/shared/); the Shared check
 * workflow fails when the copies drift apart, so change both together.
 */

export const SEARCH_CONSOLE_TIME_ZONE = "America/Los_Angeles";

/** Today's date in Pacific Time, as YYYY-MM-DD. */
export function todayPT(now: Date = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SEARCH_CONSOLE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Shift a YYYY-MM-DD date by `n` days (calendar arithmetic, no time zone involved). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}

/** A valid calendar date in YYYY-MM-DD form. */
export function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value;
}
