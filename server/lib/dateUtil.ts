// ============================================================
// Timezone-safe date helpers.
//
// The bug this file exists to prevent: doing `new Date(dateStr + 'T00:00:00')`
// (parsed in the SERVER's local timezone) and then `.toISOString()` (which
// always converts to UTC) silently shifts the date backward by one day
// whenever the server runs in a positive UTC-offset timezone — which is
// exactly the case for Indonesia (WIB/WITA/WIT, UTC+7/+8/+9). E.g. midnight
// July 14 in Jakarta is 17:00 UTC on July 13, so `.toISOString().slice(0,10)`
// wrongly returns "2026-07-13".
//
// Fix: never mix local-timezone parsing with UTC serialization (or vice
// versa). Everything here either (a) stays entirely in UTC-space via
// Date.UTC()/getUTCFullYear()/etc, treating "YYYY-MM-DD" as a plain
// calendar date with no timezone attached, or (b) explicitly asks for the
// Asia/Jakarta wall-clock date via Intl.DateTimeFormat when converting a
// real instant (like a Supabase created_at timestamp) into a business day.
// ============================================================

const BUSINESS_TZ = 'Asia/Jakarta';

/** Today's date as "YYYY-MM-DD", in Asia/Jakarta wall-clock time —
 *  NOT `new Date().toISOString()`, which would return UTC's current date
 *  (wrong for the first ~7 hours of every Jakarta day). */
export function todayJakarta(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Add (or subtract) days from a "YYYY-MM-DD" string, safely — pure
 *  UTC-space arithmetic, never touches local-timezone Date methods, so
 *  there's no room for the server's local TZ to shift the result. */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Convert a real timestamp (e.g. Supabase's created_at, which includes an
 *  actual instant/offset) into the Asia/Jakarta calendar date it falls on
 *  — e.g. a visit logged at 00:30 WIB should count as "today" in Jakarta,
 *  not "yesterday" in UTC. */
export function toJakartaDateString(isoTimestamp: string | Date): string {
  const d = typeof isoTimestamp === 'string' ? new Date(isoTimestamp) : isoTimestamp;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Format a real timestamp as "YYYY-MM-DD HH:mm" wall-clock time in
 *  Asia/Jakarta — used for showing kunjungan (visit) time in exports/reports
 *  so it always matches what the field advisor's phone would have shown. */
export function formatJakartaDateTime(isoTimestamp: string | Date): string {
  const d = typeof isoTimestamp === 'string' ? new Date(isoTimestamp) : isoTimestamp;
  const datePart = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const timePart = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${datePart} ${timePart}`;
}

/** Day-of-month (1-31) a timestamp falls on, in Asia/Jakarta time. */
export function toJakartaDay(isoTimestamp: string | Date): number {
  return parseInt(toJakartaDateString(isoTimestamp).slice(8, 10), 10);
}
