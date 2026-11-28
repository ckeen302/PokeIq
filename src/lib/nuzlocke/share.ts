import LZString from "lz-string";
import type { EncounterKind } from "./model";
import { BADGES_MAX, NAME_MAX, NICK_MAX, RUN_VERSION, TEXT_MAX, type AreaResult, type MonStatus, type Rules, type Run, type RunMon } from "./run";

/**
 * Share links: the whole run, compressed into the URL (?s=…, lz-string), so a link shows the run as it was shared with
 * no database. Read-only: opening one never touches the runs saved in that browser (unless the viewer saves a copy).
 * Keys are kept short (the format below); anything malformed is dropped, never thrown.
 */

export const SHARE_VERSION = 1;
const MAX_RAW = 24_000;

const KINDS: readonly EncounterKind[] = ["wild", "gift", "static", "trade", "egg", "fossil", "roaming"];
const STATUSES: readonly MonStatus[] = ["team", "box", "dead"];
const RULE_BITS: (keyof Rules)[] = ["dupes", "shiny", "gifts", "statics", "caps"];

/** A Pokémon: area, met, now ("" when the same), nickname, status, flags (1 shiny, 2 free), level (0 none), kind, death. */
type MonRow = [string, string, string, string, number, number, number, number, DeathRow?];
/** A death: by (species, 0 none), by in words, area, level (0 none), when (seconds). */
type DeathRow = [number, string, string, number, number];
/** An area: id, 0 caught (then the Pokémon's index) / 1 failed (then what it was) / 2 skipped. */
type AreaRow = [string, 0 | 1 | 2, (number | string)?];

interface Payload {
  v: number;
  g: string;
  e: string;
  n: string;
  r: number;
  b?: string[];
  h?: number;
  t?: [number, number];
  a?: AreaRow[];
  m?: MonRow[];
}

const sec = (ms: number) => Math.round(ms / 1000);

export function encodeRun(run: Run): string {
  const index = new Map(run.mons.map((m, i) => [m.id, i]));
  const p: Payload = {
    v: SHARE_VERSION,
    g: run.game,
    e: run.version,
    n: run.name,
    r: RULE_BITS.reduce((bits, k, i) => (run.rules[k] ? bits | (1 << i) : bits), 0),
  };
  if (run.beaten.length) p.b = run.beaten;
  if (run.badges) p.h = run.badges;
  p.t = [sec(run.createdAt), sec(run.updatedAt)];
  const areas = Object.entries(run.areas).map(([id, r]): AreaRow => (r.kind === "caught" ? [id, 0, index.get(r.mon) ?? -1] : r.kind === "failed" ? (r.met ? [id, 1, r.met] : [id, 1]) : [id, 2]));
  if (areas.length) p.a = areas;
  if (run.mons.length)
    p.m = run.mons.map((m): MonRow => {
      const row: MonRow = [m.area, m.met, m.mon === m.met ? "" : m.mon, m.nickname, STATUSES.indexOf(m.status), (m.shiny ? 1 : 0) | (m.free ? 2 : 0), m.level ?? 0, KINDS.indexOf(m.kind ?? "wild")];
      if (m.death) row.push([m.death.by ?? 0, m.death.byText ?? "", m.death.area ?? "", m.death.level ?? 0, sec(m.death.at)]);
      return row;
    });
  return LZString.compressToEncodedURIComponent(JSON.stringify(p));
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const key = (v: unknown): string | null => (typeof v === "string" && v.length > 0 && v.length <= 80 ? v : null);
const int = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);
const MAX_SEC = 8.64e12;

/** A link's run, or null if it isn't a link this tracker wrote. Its id is "shared". */
export function decodeRun(raw: string | null | undefined): Run | null {
  if (!raw || raw.length > MAX_RAW) return null;
  let p: Payload;
  try {
    const json = LZString.decompressFromEncodedURIComponent(raw);
    if (!json) return null;
    p = JSON.parse(json);
  } catch {
    return null;
  }
  if (!p || typeof p !== "object" || p.v !== SHARE_VERSION || !key(p.g) || !key(p.e)) return null;
  const rules = Object.fromEntries(RULE_BITS.map((k, i) => [k, typeof p.r === "number" && (p.r & (1 << i)) !== 0])) as unknown as Rules;
  const [created, updated] = Array.isArray(p.t) ? p.t.map((x) => int(x, 0, MAX_SEC) ?? 0) : [0, 0];
  const mons: RunMon[] = [];
  for (const row of Array.isArray(p.m) ? p.m.slice(0, 2000) : []) {
    if (!Array.isArray(row)) continue;
    const [area, met, now, nick, status, flags, level, kind, death] = row;
    if (!key(area) || !key(met)) continue;
    const m: RunMon = {
      id: `m${mons.length}`,
      area: area as string,
      met: met as string,
      mon: key(now) ?? (met as string),
      nickname: str(nick, NICK_MAX),
      status: STATUSES[int(status, 0, 2) ?? 1],
      caughtAt: 0,
    };
    const f = int(flags, 0, 3) ?? 0;
    if (f & 1) m.shiny = true;
    if (f & 2) m.free = true;
    const lv = int(level, 1, 100);
    if (lv) m.level = lv;
    const k = KINDS[int(kind, 0, KINDS.length - 1) ?? 0];
    if (k !== "wild") m.kind = k;
    if (m.status === "dead") {
      const d = Array.isArray(death) ? death : [];
      m.death = { at: (int(d[4], 0, MAX_SEC) ?? 0) * 1000 };
      const by = int(d[0], 1, 2000);
      if (by) m.death.by = by;
      if (str(d[1], TEXT_MAX)) m.death.byText = str(d[1], TEXT_MAX);
      if (key(d[2])) m.death.area = d[2] as string;
      const dl = int(d[3], 1, 100);
      if (dl) m.death.level = dl;
    }
    mons.push(m);
  }
  const areas: Record<string, AreaResult> = {};
  for (const row of Array.isArray(p.a) ? p.a.slice(0, 2000) : []) {
    if (!Array.isArray(row) || !key(row[0]) || areas[row[0]]) continue;
    const [id, kind, ref] = row;
    if (kind === 0) {
      const i = int(ref, 0, mons.length - 1);
      if (i !== null) areas[id] = { kind: "caught", mon: mons[i].id };
    } else if (kind === 1) areas[id] = key(ref) ? { kind: "failed", met: ref as string } : { kind: "failed" };
    else if (kind === 2) areas[id] = { kind: "skipped" };
  }
  return {
    v: RUN_VERSION,
    id: "shared",
    game: p.g,
    version: p.e,
    name: str(p.n, NAME_MAX),
    rules,
    areas,
    mons,
    beaten: Array.isArray(p.b) ? [...new Set(p.b.filter((b): b is string => !!key(b)))].slice(0, 200) : [],
    badges: int(p.h, 0, BADGES_MAX) ?? 0,
    createdAt: created * 1000,
    updatedAt: updated * 1000,
  };
}
