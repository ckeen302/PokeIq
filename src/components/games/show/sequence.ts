import type { Athlete } from "@/lib/games/athlete";
import type { Venue } from "@/lib/games/events";
import type { Race } from "@/lib/race/race";
import { dims } from "../scene/motions/common";
import { fillFrame, keepOnField, keepOut, tall, type CamPose, type Subject } from "./cams";
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
    f.pose = placed(f, aspect, size);
    return { ...f, t: x, beat: shift(f.beat, p.t0), bursts: f.bursts.map((b) => ({ ...b, t0: b.t0 + p.t0, id: `${parts.indexOf(p)}:${b.id}` })), decals: f.decals.map((d) => ({ ...d, t0: d.t0 + p.t0, id: `${parts.indexOf(p)}:${d.id}` })), props: shiftProps(f.props, p.t0) };
  };
  const sizes = new Map(athletes.map((a) => [a.key, dims(a)]));
  const size = (key: string) => sizes.get(key);
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

const FRAMED = new Set<Beat["kind"]>(["intro", "action", "replay", "result", "podium"]);

/**
 * The frame's camera, kept inside its venue, and in a tall frame aimed at
 * what the beat is about so it fills the frame: the athlete (or the two
 * wrestlers, or the medallists), the bar it lifts, the implement once it
 * has left the hand.
 */
function placed(f: ShowFrame, aspect: number, size: (key: string) => { w: number; h: number } | undefined): CamPose {
  if (f.race || !FRAMED.has(f.beat.kind)) return f.pose;
  const pose = f.venue === "stadium" ? keepOnField(f.pose) : keepOut(f.pose, f.venue);
  if (!tall(aspect)) return pose;
  const shown = f.actors.filter((a) => a.pose.visible);
  if (!shown.length || shown.length > 3) return pose;
  // A medallist's own close-up is already framed on it.
  if (f.beat.kind === "podium" && f.beat.cam.startsWith("m")) return pose;
  const subjects: Subject[] = [];
  for (const a of shown) {
    const d = size(a.key);
    if (!d) continue;
    const k = a.pose.scale ?? 1;
    subjects.push({ x: a.pose.x, y: a.pose.y, z: a.pose.z, w: d.w * k, h: d.h * k });
  }
  if (!subjects.length) return pose;
  // A tiny one next to a giant gets a margin of its own (its box grown to a quarter of the giant's size), so it sits
  // well inside the frame instead of on its edge.
  if (subjects.length > 1) {
    const big = Math.max(...subjects.map((x) => Math.max(x.w, x.h)));
    for (const x of subjects) if (Math.max(x.w, x.h) < big * 0.25) { x.w = Math.max(x.w, big * 0.25); x.h = Math.max(x.h, big * 0.25); }
  }
  const pr = f.props;
  if (pr.kind === "throw" && pr.pos) {
    // In flight the camera follows the implement; the thrower drops out of the frame as it flies away.
    const a = subjects[0];
    const away = Math.hypot(pr.pos[0] - a.x, pr.pos[2] - a.z);
    const k = Math.max(0, Math.min(1, (away - 2.5) / 6));
    a.weight = 1 - k * k * (3 - 2 * k);
    const box = 2.2 + 3.2 * k;
    subjects.unshift({ x: pr.pos[0], y: Math.max(0, pr.pos[1] - box / 2), z: pr.pos[2], w: box, h: box });
  } else if (pr.kind === "lift" && pr.bar) {
    subjects.push({ x: pr.bar[0], y: pr.bar[1] - 0.25, z: pr.bar[2], w: 2.2, h: 0.5 });
  }
  const fill = f.beat.kind === "podium" ? 0.36 : 0.42;
  let out = fillFrame(pose, subjects, aspect, fill);
  // Two of very different sizes (a Pikachu against a Snorlax) can need more than the widest lens: step the camera back
  // along its line until both fit, so the small one never drops out of the frame.
  for (let i = 0; i < 4 && subjects.length > 1 && out.fov >= 61.5; i++) {
    const k = 1.35 ** (i + 1);
    const back: CamPose = { ...pose, pos: [pose.target[0] + (pose.pos[0] - pose.target[0]) * k, pose.target[1] + (pose.pos[1] - pose.target[1]) * k, pose.target[2] + (pose.pos[2] - pose.target[2]) * k] };
    out = fillFrame(back, subjects, aspect, fill);
  }
  return out;
}
