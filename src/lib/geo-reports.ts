/**
 * Players' reports of bad PokéGuessr screenshots: the reasons, and the rule
 * that takes a shot out of rotation until a moderator looks at it. Shared by
 * the server and the browser; the store is src/lib/server/geo-reports.ts.
 */

export const GEO_REPORT_REASONS = {
  "wrong-place": "Wrong place",
  "wrong-game": "Wrong game",
  "gives-away": "Gives the answer away",
  "too-generic": "Too generic to place",
  "bad-image": "Bad image",
  other: "Something else",
} as const;
export type GeoReportReason = keyof typeof GEO_REPORT_REASONS;
export const GEO_REPORT_REASON_IDS = Object.keys(GEO_REPORT_REASONS) as [GeoReportReason, ...GeoReportReason[]];

/** Where the shot was reported from. */
export const GEO_REPORT_MODES = ["solo", "daily", "duel"] as const;
export type GeoReportMode = (typeof GEO_REPORT_MODES)[number];

/** Distinct reporters (different players on different networks) that take a shot out of rotation until it's reviewed. */
export const GEO_HIDE_THRESHOLD = 3;
export const GEO_REPORT_NOTE_MAX = 300;
export const GEO_SHOT_ID_RE = /^[A-Za-z0-9_-]{8,24}$/;

/** open: waiting for review. kept: a moderator kept the shot (the report is cleared). removed: the shot is out for good. */
export type GeoReportStatus = "open" | "kept" | "removed";

export interface GeoShotReport {
  id: number;
  shot: string;
  reason: GeoReportReason;
  note: string | null;
  mode: GeoReportMode;
  /** "u:<account id>" signed in, else "d:<device id>". */
  reporter: string;
  /** A keyed hash of the reporter's address (never the address itself). */
  ipHash: string | null;
  status: GeoReportStatus;
  at: number;
  reviewedAt: number | null;
  reviewedBy: string | null;
}

/**
 * Open reports count once per reporter, and reporters on one network count
 * once: one person clearing their cookies can't take a shot down alone.
 */
export function distinctReporters(reports: Pick<GeoShotReport, "reporter" | "ipHash" | "status">[]): number {
  const reporters = new Set<string>();
  const networks = new Set<string>();
  for (const r of reports) {
    if (r.status !== "open" || reporters.has(r.reporter)) continue;
    if (r.ipHash && networks.has(r.ipHash)) continue;
    reporters.add(r.reporter);
    if (r.ipHash) networks.add(r.ipHash);
  }
  return reporters.size;
}

/** Shots out of rotation: removed by a moderator, or reported by enough distinct reporters and not yet reviewed. */
export function hiddenShotIds(reports: Pick<GeoShotReport, "shot" | "reporter" | "ipHash" | "status">[]): Set<string> {
  const byShot = new Map<string, typeof reports>();
  for (const r of reports) byShot.set(r.shot, [...(byShot.get(r.shot) ?? []), r]);
  const hidden = new Set<string>();
  for (const [shot, list] of byShot) {
    if (list.some((r) => r.status === "removed") || distinctReporters(list) >= GEO_HIDE_THRESHOLD) hidden.add(shot);
  }
  return hidden;
}

/** A shot in the review queue, as moderators see it. */
export interface GeoShotReview {
  shot: string;
  src: string;
  /** Where the data says it is, and its game (null: no longer in the data). */
  place: string | null;
  game: string | null;
  reporters: number;
  hidden: boolean;
  reasons: Partial<Record<GeoReportReason, number>>;
  notes: string[];
  modes: GeoReportMode[];
  first: number;
  last: number;
  status: GeoReportStatus;
}

/** Groups reports by shot, most-reported first. */
export function groupShotReports(reports: GeoShotReport[]): Omit<GeoShotReview, "src" | "place" | "game">[] {
  const byShot = new Map<string, GeoShotReport[]>();
  for (const r of reports) byShot.set(r.shot, [...(byShot.get(r.shot) ?? []), r]);
  const hidden = hiddenShotIds(reports);
  return [...byShot]
    .map(([shot, list]) => {
      const reasons: Partial<Record<GeoReportReason, number>> = {};
      for (const r of list) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
      const status: GeoReportStatus = list.some((r) => r.status === "removed") ? "removed" : list.some((r) => r.status === "open") ? "open" : "kept";
      return {
        shot,
        reporters: status === "open" ? distinctReporters(list) : new Set(list.map((r) => r.reporter)).size,
        hidden: hidden.has(shot),
        reasons,
        notes: list.flatMap((r) => (r.note ? [r.note] : [])),
        modes: [...new Set(list.map((r) => r.mode))],
        first: Math.min(...list.map((r) => r.at)),
        last: Math.max(...list.map((r) => r.at)),
        status,
      };
    })
    .sort((a, b) => b.reporters - a.reporters || b.last - a.last);
}
