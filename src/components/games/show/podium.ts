import type { Athlete } from "@/lib/games/athlete";
import { eventOf, type EventId, type Venue } from "@/lib/games/events";
import { POOL } from "@/lib/games/venues";
import { dims } from "../scene/motions/common";
import type { ActorPose } from "../scene/pose";
import { framed, tall, type CamPose, type Vec3 } from "./cams";
import { Timeline, beatAt, beatK, type Overlay, type Show, type ShowFrame } from "./types";

/**
 * The medal ceremony: the three medallists on the podium in the event's
 * venue (gold in the middle, highest), bronze, then silver, then gold hung
 * round their necks, confetti and the fanfare with the gold, then the
 * anthem while the camera pushes in. Ties share a step. Pure.
 */

export interface Medallist {
  athlete: Athlete;
  medal: 1 | 2 | 3;
  mark: string;
  /** In the Games: the nation it won for. */
  nation?: { name: string; color: string };
}

const SPOT: Record<Venue, { at: Vec3; face: [number, number] }> = {
  // In the stadium: on the infield in front of the main stand; indoors on the floor; at the pool, on the deck at the start end.
  stadium: { at: [0, 0, 16], face: [0, 1] },
  arena: { at: [0, 0, -1.5], face: [0, 1] },
  pool: { at: [POOL.startX - 4.5, POOL.deck, 5], face: [0, 1] },
};

const STEP = { 1: { h: 0.6, x: 0 }, 2: { h: 0.42, x: -1.25 }, 3: { h: 0.3, x: 1.25 } } as const;

export function podiumShow(event: EventId, venue: Venue, medallists: Medallist[], o: { video?: boolean; title?: string } = {}): Show {
  const ath = medallists.map((m) => m.athlete);
  const ds = ath.map(dims);
  const hs = ds.map((d) => d.h).sort((a, b) => a - b);
  // A podium as big as its typical medallist (a giant on a human-sized podium wouldn't fit on its step).
  const scale = Math.max(0.6, Math.min(5, (hs[Math.floor(hs.length / 2)] ?? 1.6) / 1.6));
  const spot = SPOT[venue];
  const at = spot.at;
  const tl = new Timeline();
  tl.add({ kind: "podium", cam: "wide", title: o.title ?? eventOf(event).name }, o.video ? 2 : 2.6);
  const order: (1 | 2 | 3)[] = [3, 2, 1];
  const medalAt = new Map<number, number>();
  for (const m of order) {
    if (!medallists.some((x) => x.medal === m)) continue;
    const b = tl.add({ kind: "podium", cam: `m${m}`, act: m }, o.video ? 1.5 : 2.1);
    medalAt.set(m, b.t0 + 0.5);
    tl.cue(b.t0 + 0.5, m === 1 ? "fanfare" : "applause", m === 1 ? 1 : 0.5);
  }
  const anthem = tl.add({ kind: "podium", cam: "push" }, o.video ? 3 : 5.5);
  tl.cue(anthem.t0 - 0.2, "anthem", 1);
  tl.cue((medalAt.get(1) ?? anthem.t0) + 0.1, "cheer", 1);
  const beats = tl.beats;
  const end = tl.t;
  // Where each medallist stands: its step (ties share it, side by side).
  const place = medallists.map((m, i) => {
    const same = medallists.filter((x) => x.medal === m.medal);
    const j = same.indexOf(m);
    const s = STEP[m.medal];
    const spread = (j - (same.length - 1) / 2) * 0.55 * scale;
    return { m, d: ds[i], x: at[0] + s.x * scale + spread, y: at[1] + s.h * scale, z: at[2] };
  });
  const tallest = Math.max(...ds.map((d) => d.h)) + 0.6 * scale;
  const span = Math.max(4.2 * scale, ...place.map((p) => Math.abs(p.x - at[0]) * 2 + p.d.w));

  const camera = (cam: string, k: number, aspect: number, t: number): CamPose => {
    const back = tall(aspect) ? 1.5 : 1;
    const c: Vec3 = [at[0], at[1] + tallest * 0.5, at[2]];
    const fz = spot.face[1];
    if (cam.startsWith("m")) {
      const p = place.find((x) => `m${x.m.medal}` === cam) ?? place[0];
      const H = p.d.h + 0.4;
      const target: Vec3 = [p.x, p.y + H * 0.55, p.z];
      return framed([p.x + 0.6 * H, p.y + H * 0.7, p.z + fz * (2.6 + 2.2 * H) * back], target, Math.max(1.4, p.d.w * 1.6), H * 1.5, aspect, 8, 55);
    }
    if (cam === "push") {
      const dist = (span * 0.9 + tallest * 0.8 + 3) * back * (1 - 0.12 * k);
      const ang = 0.22 * Math.sin(t * 0.25);
      return framed([c[0] + Math.sin(ang) * dist, c[1] + tallest * 0.15, c[2] + fz * Math.cos(ang) * dist], c, span * 1.15, tallest * 1.35, aspect, 10, 58);
    }
    const dist = (span * 1.3 + tallest + 5) * back;
    return framed([c[0] + dist * 0.35 * (1 - k), c[1] + tallest * 0.5 + 2 * (1 - k), c[2] + fz * dist], c, span * 1.4, tallest * 1.6, aspect, 10, 60);
  };

  const frame = (t: number, aspect: number): ShowFrame => {
    const beat = beatAt(beats, t);
    const k = beatK(beat, t);
    const actors = place.map((p, i) => {
      const pose: ActorPose = {
        visible: true, x: p.x, y: p.y, z: p.z, dx: 0, dz: 1, lean: 0.02 * Math.sin(t * 0.9 + i), roll: 0, squash: 0.012 * Math.sin(t * 2.1 + i * 1.7),
        gait: { motion: p.m.athlete.entrant.motion, phase: 0, v: 0 }, shadow: 1, ground: p.y,
        // Arms up when its medal is on.
        raise: (medalAt.get(p.m.medal) ?? 1e9) <= t ? Math.min(1, (t - medalAt.get(p.m.medal)!) / 0.6) * (p.m.medal === 1 ? 1 : 0.6) : 0,
        faceDir: [0, 1],
      };
      return { key: p.m.athlete.key, pose };
    });
    const medals = place.filter((p) => medalAt.has(p.m.medal)).map((p) => {
      const size = Math.max(0.05, Math.min(1.2, 0.09 * Math.max(0.6, p.d.h / 1.4)));
      const pos: Vec3 = [p.x, p.y + p.d.h * 0.56, p.z + Math.max(0.12, p.d.w * 0.18) + 0.02];
      return { medal: p.m.medal, t0: medalAt.get(p.m.medal)!, pos, size };
    });
    const gold = medalAt.get(1);
    return {
      t,
      venue,
      pose: camera(beat.cam, k, aspect, t),
      beat,
      k,
      actors,
      props: { kind: "podium", at: [at[0], at[1], at[2]], scale, medals },
      bursts: gold != null && t >= gold ? [{ id: `confetti-${event}`, t0: gold, kind: "confetti", x: at[0], y: at[1] + tallest + 3, z: at[2] + 1, size: Math.max(4, span), power: 1 }] : [],
      decals: [],
      excitement: gold != null && t >= gold ? 0.95 : 0.6,
      replay: 0,
      dof: { focus: [at[0], at[1] + tallest * 0.5, at[2]], k: 0.35 },
      fade: 0,
      flash: gold != null && t >= gold && t < gold + 0.25 ? 0.35 * (1 - (t - gold) / 0.25) : 0,
      clock: "",
      screen: null,
    };
  };

  const overlay = (t: number): Overlay => {
    const beat = beatAt(beats, t);
    const k = beatK(beat, t);
    if (beat.cam.startsWith("m")) {
      const m = medallists.find((x) => `m${x.medal}` === beat.cam)!;
      return { lower: { key: m.athlete.key, name: m.athlete.name, line: `${m.mark}${m.nation ? ` · ${m.nation.name}` : ""}`, tag: m.medal === 1 ? "Gold" : m.medal === 2 ? "Silver" : "Bronze", k } };
    }
    if (beat.cam === "wide") return { title: { text: "MEDAL CEREMONY", sub: o.title ?? eventOf(event).name, k } };
    return { tags: medallists.map((m) => m.athlete.key) };
  };

  return {
    event,
    venue,
    athletes: ath,
    beats,
    cues: tl.cues,
    end,
    at: frame,
    overlay,
    resultsAt: 0,
    hook: eventOf(event).hook,
    headline: medallists[0] ? `${medallists[0].athlete.name} takes gold` : "",
  };
}
