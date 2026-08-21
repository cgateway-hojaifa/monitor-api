/**
 * Local calendar-day helpers (server timezone).
 *
 * The daily check and the run counter must agree on exactly which instants belong to "today",
 * and the `cron_daily_result.day` DATE must match that same day. Centralised here so both sides
 * bucket runs identically.
 */

/** `YYYY-MM-DD` for a Date in server-local time (matches a MySQL DATE column). */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Inclusive-start / exclusive-end instants bounding the local calendar day that `d` falls in. */
export function dayBounds(d: Date): { start: Date; end: Date } {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  return { start, end };
}
