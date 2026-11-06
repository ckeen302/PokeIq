import type { Athlete } from "@/lib/games/athlete";
import type { Venue } from "@/lib/games/events";
import type { Race } from "@/lib/race/race";
import type { Beat, Cue, Overlay, Show, ShowFrame } from "./types";

/**
 * Shows played back to back (an event, then its medal ceremony; the
 * Games' events in order): one clock, each part on its own stretch of it.
 * Pure.
 */

export interface Part {
  show: Show;
  t0: number;
  t1: number;
}

export interface Sequence extends Show {
  parts: Part[];
  /** The part playing at show time t. */
  partAt(t: number): Part;
}

export function sequence(shows: Show[], o: { event?: Show["event"]; hook?: string; headline?: string } = {}): Sequence {
  const parts: Part[] = [];
  let t = 0;
  for (const s of shows) {
    parts.push({ show: s, t0: t, t1: t + s.end });
    t += s.end;
  }
  const partAt = (x: number): Part => parts.find((p) => x < p.t1) ?? parts[parts.length - 1];
  const shift = (b: Beat, d: number): Beat => ({ ...b, t0: b.t0 + d, t1: b.t1 + d });
  const beats = parts.flatMap((p) => p.show.beats.map((b) => shift(b, p.t0)));
  const cues: Cue[] = parts.flatMap((p) => p.show.cues.map((c) => ({ ...c, t: c.t + p.t0 })));
  const seen = new Set<string>();
  const athletes: Athlete[] = [];
  for (const p of parts) for (const a of p.show.athletes) if (!seen.has(a.key)) { seen.add(a.key); athletes.push(a); }
  const race: Race | undefined = parts.find((p) => p.show.race)?.show.race;
  const falseRace = parts.find((p) => p.show.falseRace)?.show.falseRace ?? null;
  const at = (x: number, aspect: number): ShowFrame => {
    const p = partAt(x);
    const f = p.show.at(Math.min(p.show.end, x - p.t0), aspect);
    return { ...f, t: x, beat: shift(f.beat, p.t0), bursts: f.bursts.map((b) => ({ ...b, t0: b.t0 + p.t0, id: `${parts.indexOf(p)}:${b.id}` })), decals: f.decals.map((d) => ({ ...d, t0: d.t0 + p.t0, id: `${parts.indexOf(p)}:${d.id}` })), props: shiftProps(f.props, p.t0) };
  };
  const overlay = (x: number): Overlay => {
    const p = partAt(x);
    return p.show.overlay(Math.min(p.show.end, x - p.t0));
  };
  const first = parts[0]?.show;
  return {
    event: o.event ?? first.event,
    venue: first.venue as Venue,
    athletes,
    beats,
    cues,
    end: t,
    race,
    falseRace,
    at,
    overlay,
    resultsAt: parts.length > 1 ? parts[parts.length - 1].t0 : first.resultsAt,
    hook: o.hook ?? first.hook,
    headline: o.headline ?? first.headline,
    parts,
    partAt,
  };
}

function shiftProps(p: ShowFrame["props"], d: number): ShowFrame["props"] {
  if (p.kind === "podium") return { ...p, medals: p.medals.map((m) => ({ ...m, t0: m.t0 + d })) };
  return p;
}
