/**
 * The counter's numbers: what a run of encounters means at a given shiny chance. Pure, and tested on its own
 * (tests/shiny-hunt.test.ts).
 */

/** The chance at least one of `n` encounters was shiny: 1 − (1 − p)^n. */
export function chanceByNow(p: number, n: number): number {
  if (!(p > 0) || !(n > 0)) return 0;
  if (p >= 1) return 1;
  return -Math.expm1(n * Math.log1p(-p));
}

/** How many times the odds the hunt has gone: n × p (1 at 1/p encounters). */
export function oddsMultiple(p: number, n: number): number {
  return p > 0 && n > 0 ? n * p : 0;
}

/** Encounters needed for a `target` chance (0–1) of having seen the shiny. */
export function encountersFor(p: number, target: number): number {
  if (!(p > 0) || !(target > 0)) return 0;
  if (p >= 1) return 1;
  if (target >= 1) return Infinity;
  return Math.ceil(Math.log1p(-target) / Math.log1p(-p));
}

/** "1 in N" as a number: whole above 100, one decimal below (1 in 95.8). */
export function oneIn(p: number): number {
  if (!(p > 0)) return Infinity;
  const n = 1 / p;
  return n >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
}

/** Encounters per hour over the timed part of the hunt (null until there's a minute of it). */
export function perHour(count: number, ms: number): number | null {
  if (ms < 60_000 || count <= 0) return null;
  return (count * 3_600_000) / ms;
}

/** 3:04:05 or 4:05 (hours only when there are some). */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}
