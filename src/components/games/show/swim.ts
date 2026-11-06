import { eventOf } from "@/lib/games/events";
import { swimAt, swimMark, type SwimRace } from "@/lib/games/swim";
import { POOL, poolX } from "@/lib/games/venues";
import { planSwim, swimPose } from "../scene/motions/swim";
import { smooth } from "../scene/motions/common";
import { crane, drift, framed, mixPose, tall, type CamPose } from "./cams";
import type { ShowOptions } from "./longjump";
import { Timeline, beatAt, beatClock, beatK, type Burst, type Overlay, type Show, type ShowFrame } from "./types";

/**
 * A swimming final as a broadcast: the crane over the pool, the lanes
 * introduced, the swimmers on their blocks, "take your marks" and the
 * beep, then the race on the rail camera along the pool side (the dive
 * from the side, the turn from the wall in the 100, the finish from
 * behind the touchpads), the long middle of a slow race fast-forwarded,
 * the touch and the places, a slow-motion replay of the finish, the
 * results with reaction times. Pure.
 */

const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}` : s.toFixed(2));

export function swimShow(race: SwimRace, o: ShowOptions): Show {
  const ev = race.event;
  const name = eventOf(ev).name;
  const plans = race.runs.map(planSwim);
  const athletes = race.runs.map((r) => r.athlete);
  const order = race.order;
  const win = order[0];
  const winT = win.trace.finish;
  const third = order[Math.min(2, order.length - 1)].trace.finish;
  // The race on screen: to the winner's touch and on until the podium is decided (and a little after).
  const raceEnd = Math.min(Math.max(winT + 2.2, third + 1.2), winT + 9);
  const tl = new Timeline();
  if (!o.quick) {
    tl.add({ kind: "establish", cam: "crane", clock0: -8, rate: 0 }, o.video ? 2.6 : 4);
    tl.add({ kind: "startlist", cam: "blocks", clock0: -6, rate: 0.2 }, o.video ? 2.4 : 3.6);
  }
  tl.add({ kind: "intro", cam: "blocks", clock0: -3, rate: 1, title: "Take your marks" }, 3);
  tl.cue(tl.t, "beep", 0.8);
  // The race: at full speed, but a long middle (a slow field over 100 m) goes by fast.
  const budget = Math.max(14, o.budget - (o.quick ? 6 : 16));
  const raceLen = raceEnd;
  const ffFrom = Math.min(winT - 9, 12), ffTo = winT - 8;
  const ff = raceLen > budget && ffTo - ffFrom > 6;
  const ffRate = ff ? Math.max(2, Math.min(6, (ffTo - ffFrom) / Math.max(4, budget - (raceLen - (ffTo - ffFrom))))) : 1;
  const segs: [number, number, number][] = ff ? [[0, ffFrom, 1], [ffFrom, ffTo, ffRate], [ffTo, raceEnd, 1]] : [[0, raceEnd, 1]];
  for (const [a, b, rate] of segs) {
    const beat = tl.add({ kind: "action", cam: "race", clock0: a, rate }, (b - a) / rate);
    const at = (rt: number) => beat.t0 + (rt - a) / rate;
    if (rate === 1) {
      for (const r of race.runs) {
        if (r.trace.entry >= a && r.trace.entry < b) tl.cue(at(r.trace.entry), "dive", Math.min(1, 0.3 + r.athlete.kg / 400) / 3);
        if (r.trace.finish >= a && r.trace.finish < b && r.place <= 3) tl.cue(at(r.trace.finish), "splash", 0.5);
      }
      if (winT >= a && winT < b) tl.cue(at(winT + 0.05), "roar", 1);
      if (a === 0) tl.cue(at(0.6), "cheer", 0.6);
    }
  }
  tl.add({ kind: "result", cam: "result", clock0: raceEnd, rate: 0.5 }, o.video ? 2 : 2.8);
  tl.add({ kind: "replay", cam: "replay", clock0: winT - 2.6, rate: 0.3 }, 3.4 / 0.3);
  tl.add({ kind: "board", cam: "board", clock0: raceEnd + 3, rate: 0.4 }, o.video ? 2.6 : 4.4);
  const beats = tl.beats;
  const end = tl.t;

  /** The leader's distance at race time t (the one furthest along). */
  const leaderAt = (t: number) => {
    let best = -1, who = plans[0];
    for (const p of plans) { const s = swimAt(p.run.trace, t); if (s.x > best) { best = s.x; who = p; } }
    return { x: best, plan: who };
  };
  const D = race.distance;
  const x0 = POOL.startX, x1 = POOL.startX + POOL.length;

  const camera = (beat: ReturnType<typeof beatAt>, k: number, t: number, show: number, aspect: number): CamPose => {
    const back = tall(aspect) ? 1.45 : 1;
    const wide = tall(aspect) ? 0.62 : 1;
    switch (beat.cam) {
      case "crane":
        return crane([0, 0, 0], k, aspect, { from: [44, 30, 46], to: [-10, 9, 30], fov0: 50, fov1: 42 });
      case "blocks":
        // Along the line of blocks from the side, the swimmers stepping up.
        return drift(framed([x0 - 4, 2.4, 15.2], [x0 + 0.5, 0.9, 0], 28 * wide, 7, aspect, 10, 70), show, 0.02);
      case "race": {
        const L = leaderAt(t);
        const lx = poolX(L.x).x;
        const turnK = D === 100 && L.plan.run.trace.turn != null ? Math.max(0, 1 - Math.abs(t - L.plan.run.trace.turn) / 3.2) : 0;
        const finishK = smooth(D - 12, D - 4, L.x);
        // The dive from the side; the rail camera with the leader; the turn from behind the wall; the finish from behind the pads.
        const dive = framed([x0 + 9, 2.6, 15.2], [x0 + 6, 0.2, 0], 26 * wide, 9, aspect, 10, 70);
        // The rail camera frames the leaders: wide enough for the biggest of them, close enough to see a small one.
        const front = plans.map((p) => ({ p, x: swimAt(p.run.trace, t).x })).sort((a, b) => b.x - a.x).slice(0, 3);
        const span = Math.max(11, Math.min(36, 7 + 3.2 * Math.max(...front.map((f) => f.p.len))));
        const zc = front.reduce((s, f) => s + f.p.z, 0) / front.length;
        // Low on the deck beside the leaders (never in the stands): the swimmers side-on, in the water; a giant widens the lens.
        const rz = Math.min(15.2, zc + (3 + span * 0.85) * back);
        const rail = framed([lx + span * 0.15, 1.5 + span * 0.05, rz], [lx - span * 0.1, 0.1, zc], span * wide, span * 0.38, aspect, 10, 72);
        const turnCam = framed([x1 + 3.5, 2.4, 9], [x1 - 7, 0, -1], 26 * wide, 9, aspect, 10, 70);
        const wallX = D === 100 ? x0 : x1, dir = D === 100 ? -1 : 1;
        const fin = framed([wallX + dir * 5, 2.4, 11], [wallX - dir * 9, 0, 0], 26 * wide, 9, aspect, 10, 70);
        let pose = t < 0.2 ? dive : mixPose(dive, rail, smooth(L.plan.run.trace.entry + 0.6, L.plan.run.trace.entry + 2.2, t));
        if (turnK > 0) pose = mixPose(pose, turnCam, smooth(0, 0.35, turnK));
        if (finishK > 0) pose = mixPose(pose, fin, finishK);
        return drift(pose, show, 0.015);
      }
      case "result": {
        const wallX = D === 100 ? x0 : x1, dir = D === 100 ? -1 : 1;
        return drift(framed([wallX - dir * 2, 3, 15.2], [wallX - dir * 2.5, 0.2, 0], 24 * wide, 10, aspect, 10, 70), show, 0.02);
      }
      case "replay": {
        // Low over the water at the finish wall, the touch in slow motion.
        const wallX = D === 100 ? x0 : x1, dir = D === 100 ? -1 : 1;
        const wp = plans.find((p) => p.run === win)!;
        const w = Math.max(5, wp.len * 3.2);
        return framed([wallX - dir * w * 0.45, 0.35 + w * 0.08, wp.z + (1.5 + w * 0.55) * back], [wallX - dir * w * 0.3, 0.05, wp.z], w * wide, w * 0.42, aspect, 12, 60);
      }
      default:
        return drift(framed([0, 14, 34 * back], [0, 0, 0], 54 * wide, 18, aspect, 10, 60), show, 0.02);
    }
  };

  const at = (t: number, aspect: number): ShowFrame => {
    const beat = beatAt(beats, t);
    const k = beatK(beat, t);
    const rt = beatClock(beat, t);
    const rate = beat.rate || 1;
    const scenes = plans.map((p) => swimPose(p, rt, t));
    const bursts: Burst[] = [];
    // Splashes: the dive's entry, the kick behind each swimmer, the turn and the touch (born once each, by id).
    const emit = (id: string, at: number, x: number, z: number, kind: Burst["kind"], size: number, power: number, dx = 0) => {
      if (rt >= at && rt - at < 0.8) bursts.push({ id, t0: t - (rt - at) / rate, kind, x, y: 0.02, z, size, power, dx, rate });
    };
    plans.forEach((p, i) => {
      const tr = p.run.trace;
      const sz = Math.max(0.5, Math.min(6, p.len));
      emit(`s${i}-in`, tr.entry, x0 + tr.entryAt, p.z, "splash", sz, Math.min(2, 0.6 + p.athlete.kg / 300));
      if (tr.turn != null) emit(`s${i}-turn`, tr.turn, x1 - 0.3, p.z, "splash", sz * 0.7, 0.8);
      emit(`s${i}-touch`, tr.finish, poolX(D).x, p.z, "spray", sz * 0.6, 0.7);
      const s = scenes[i];
      if (s.wake && !s.finished && !s.under && rt > tr.entry + 1) {
        const n = Math.floor(rt / 0.45);
        const kickAt = n * 0.45;
        const kx = s.wake.x - s.wake.dir * p.len * 0.95;
        emit(`s${i}-k${n}`, kickAt, kx, p.z, "spray", Math.min(4, 0.4 + sz * 0.7), Math.min(1.5, 0.45 + s.wake.v / 3), -s.wake.dir);
      }
    });
    const wakes = scenes.map((s) => s.wake).filter((w): w is NonNullable<typeof w> => !!w);
    const L = leaderAt(rt);
    const excitement = beat.kind === "action" ? 0.45 + 0.4 * smooth(D - 15, D, L.x) : beat.kind === "result" ? 0.9 : 0.35;
    const cam = camera(beat, k, rt, t, aspect);
    // A swimmer's relief faces the camera across the pool; from above it would show its edge, so it tilts back
    // about its line of travel by the camera's elevation and the lens sees its face.
    scenes.forEach((sc, i) => {
      const p = sc.pose;
      if (p.clipY == null || !p.visible) return;
      const elev = Math.atan2(cam.pos[1] - Math.max(0, p.y + plans[i].dims.h * 0.5), Math.max(0.5, Math.abs(cam.pos[2] - p.z)));
      p.sway = (p.sway ?? 0) - Math.max(-0.2, Math.min(1.1, elev)) * 0.9 * Math.sign(p.dx || 1);
    });
    return {
      t,
      venue: "pool",
      pose: cam,
      beat,
      k,
      actors: plans.map((p, i) => ({ key: p.athlete.key, pose: scenes[i].pose })),
      props: { kind: "swim", rain: race.rain, wakes, board: beat.kind === "result" || beat.kind === "board" },
      bursts,
      decals: [],
      excitement,
      replay: beat.kind === "replay" ? 1 : 0,
      dof: beat.kind === "replay" ? { focus: [poolX(D).x, 0.3, plans.find((p) => p.run === win)!.z], k: 0.5 } : undefined,
      fade: 0,
      flash: 0,
      clock: "",
      screen: null,
    };
  };

  const tagFor = (rt: number) => {
    const text: Record<string, string> = {};
    for (const r of race.runs) text[r.athlete.key] = rt >= r.trace.finish ? `${r.place} · ${fmt(r.time)}` : `${r.lane} · ${r.athlete.name}`;
    return text;
  };

  const overlay = (t: number): Overlay => {
    const beat = beatAt(beats, t);
    const k = beatK(beat, t);
    const rt = beatClock(beat, t);
    const bug = { title: name, sub: race.rain ? "Final · rain" : "Final" };
    switch (beat.kind) {
      case "establish":
        return { title: { text: name.toUpperCase(), sub: race.rain ? "Final · the roof open, rain falling: Swift Swim doubles Speed" : `Final · ${race.runs.length} lanes · a 50 m pool`, k } };
      case "startlist":
        return { bug, board: { title: "The lanes", rows: [...race.runs].sort((a, b) => a.lane - b.lane).map((r) => ({ place: String(r.lane), name: r.athlete.name, mark: fmt(swimMark(r.athlete, ev, race.rain)), key: r.athlete.key, note: "best", plain: true })), k } };
      case "intro":
        return { bug, caption: rt > -2.2 ? "Take your marks" : undefined, tags: athletes.map((a) => a.key), tagText: tagFor(-1) };
      case "action": {
        const L = leaderAt(rt);
        const ffw = (beat.rate ?? 1) > 1;
        const split = D === 100 ? order.filter((r) => r.trace.split != null).sort((a, b) => a.trace.split! - b.trace.split!) : [];
        const showSplit = D === 100 && split.length && rt > split[0].trace.split! && rt < split[0].trace.split! + 4;
        return {
          bug: { title: name, sub: `${fmt(Math.max(0, rt))}${ffw ? ` · » ${Math.round(beat.rate!)}×` : ""}` },
          tags: rt < 1.5 || rt > winT - 0.2 || L.x > D - 6 ? athletes.map((a) => a.key) : [],
          tagText: tagFor(rt),
          mark: rt >= winT ? { text: fmt(win.time), sub: `${win.athlete.name} wins`, tone: "lead", k: smooth(winT, winT + 0.3, rt) } : showSplit ? { text: fmt(split[0].trace.split!), sub: `${split[0].athlete.name} at the turn`, tone: "plain", k: smooth(split[0].trace.split!, split[0].trace.split! + 0.3, rt) } : undefined,
          caption: rt > 0.8 && rt < 4 ? (race.rain ? "Rain: Swift Swim doubles Speed" : undefined) : undefined,
        };
      }
      case "result":
        return { bug, board: { title: `${name} · result`, rows: order.map((r) => ({ place: String(r.place), name: r.athlete.name, mark: fmt(r.time), key: r.athlete.key, hi: r.place === 1, note: `lane ${r.lane}` })), k }, tags: order.slice(0, 3).map((r) => r.athlete.key), tagText: tagFor(rt) };
      case "replay":
        return { replay: true, lower: { key: win.athlete.key, name: win.athlete.name, line: `${fmt(win.time)} · top speed ${(win.trace.vSwim * 3.6).toFixed(1)} km/h in the water`, tag: "Replay", k } };
      default:
        return { bug, board: { title: `${name} · final`, rows: order.map((r) => ({ place: String(r.place), name: r.athlete.name, mark: fmt(r.time), key: r.athlete.key, hi: r.place === 1, note: `reaction ${r.trace.reaction.toFixed(2)}` })), k } };
    }
  };

  return {
    event: ev,
    venue: "pool",
    athletes,
    beats,
    cues: tl.cues,
    end,
    at,
    overlay,
    resultsAt: beats.find((b) => b.kind === "result")?.t0 ?? end,
    hook: race.rain ? "Swift Swim in the rain: who swims fastest? 🌧️" : "Which Pokémon swims fastest? 🏊",
    headline: `${win.athlete.name} wins in ${fmt(win.time)}`,
  };
}
