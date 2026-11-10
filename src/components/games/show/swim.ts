import { eventOf } from "@/lib/games/events";
import { swimAt, swimMark, type SwimRace } from "@/lib/games/swim";
import { POOL, poolX } from "@/lib/games/venues";
import { planSwim, swimPose } from "../scene/motions/swim";
import { smooth } from "../scene/motions/common";
import { crane, drift, fillFrame, framed, keepOut, tall, type CamPose, type Subject, type Vec3 } from "./cams";
import type { ShowOptions } from "./longjump";
import { Timeline, beatAt, beatClock, beatK, type Burst, type Overlay, type Show, type ShowFrame } from "./types";

/**
 * A swimming final as a broadcast: the crane over the pool, the lanes
 * introduced, the favourite in close on its block for "take your marks"
 * and the beep, then the race cut as a director would: the dive high and
 * wide over the start, the rail camera low on the deck with the leaders
 * (on whichever side a giant doesn't hide them), the spidercam over them
 * for a spell, the turn from over the wall in the 100, the touch from
 * behind the touchpads; the long middle of a slow race fast-forwarded,
 * the places, a slow-motion replay alongside the winner into the wall,
 * the results with reaction times. Pure.
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
    tl.add({ kind: "establish", cam: "crane", clock0: -8, rate: 0 }, o.lineup ? (o.video ? 2.6 : 4) : o.video ? 1.3 : 1.8);
    tl.add({ kind: "startlist", cam: "blocks", clock0: -6, rate: 0.2 }, o.lineup ? (o.video ? 2.4 : 3.6) : o.video ? 1.2 : 1.7);
  }
  tl.add({ kind: "intro", cam: "marks", clock0: o.lineup ? -3 : -1.8, rate: 1, title: "Take your marks" }, o.lineup ? 3 : 1.8);
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
  const wallX = D === 100 ? x0 : x1, finDir = D === 100 ? -1 : 1;
  const winPlan = plans.find((p) => p.run === win)!;
  const wtr = winPlan.run.trace;

  /**
   * The leading group at race time t: its front (world x) and direction, and its lane, body length and
   * height above the water, each swimmer weighted by how close it is to the lead (so it all moves smoothly
   * as places change).
   */
  const groupAt = (t: number) => {
    const xs = plans.map((p) => swimAt(p.run.trace, t).x);
    const lead = Math.max(...xs);
    let W = 0, gz = 0, gl = 0, ga = 0;
    plans.forEach((p, i) => {
      const w = Math.exp(-(lead - xs[i]) / 1.1);
      W += w; gz += w * p.z; gl += w * p.len; ga += w * p.above;
    });
    const pos = poolX(lead);
    return { lead, x: pos.x, dir: pos.dir, z: gz / W, len: gl / W, above: ga / W };
  };

  // The cameras run along the side with the clearer view of the leaders: a giant in a nearer lane would hide them.
  const S = (() => {
    let near = 0, far = 0;
    for (let t = wtr.entry; t < winT; t += 0.5) {
      const xs = plans.map((p) => swimAt(p.run.trace, t).x);
      const lead = Math.max(...xs);
      plans.forEach((p, i) => {
        if (lead - xs[i] > 2.5) return;
        plans.forEach((q, j) => {
          if (j === i || q.above < 0.5 * p.above + 0.3) return;
          if (xs[j] < xs[i] - p.len - 0.5 || xs[j] - q.len > xs[i] + 0.5) return;
          if (q.z > p.z) near += q.above; else far += q.above;
        });
      });
    }
    return far < near ? -1 : 1;
  })();
  const RAIL = 14.2 * S;
  // The favourite: the fastest on paper.
  const fav = plans.reduce((b, p) => (swimMark(p.athlete, ev, race.rain) < swimMark(b.athlete, ev, race.rain) ? p : b), plans[0]);

  // The race's shot list (race seconds): the dive, the rail camera with the leaders, the spidercam over
  // them for a spell in a long enough length, the turn from over the wall, the rail again to the touch,
  // then the wall from behind the touchpads as the rest come in. Cuts, as a director would.
  type Cam = "dive" | "rail" | "spider" | "turn" | "touch";
  const shots: { from: number; cam: Cam }[] = [{ from: -Infinity, cam: "dive" }, { from: wtr.entry + 1.5, cam: "rail" }];
  const spell = (a: number, b: number) => { if (b - a > 3 && b - a < 60) { shots.push({ from: a, cam: "spider" }, { from: a + 4, cam: "rail" }); } };
  if (D === 100 && wtr.turn != null && wtr.pushOff != null) {
    if (wtr.turn - 2.4 - (wtr.entry + 6) > 8) spell(wtr.entry + 6, wtr.entry + 10);
    shots.push({ from: wtr.turn - 2.4, cam: "turn" }, { from: wtr.pushOff + 1.6, cam: "rail" });
    if (winT - (wtr.pushOff + 6) > 10) spell(wtr.pushOff + 6, wtr.pushOff + 10);
  } else if (winT - (wtr.entry + 5) > 10) spell(wtr.entry + 5, wtr.entry + 9);
  shots.push({ from: winT + 0.5, cam: "touch" });
  shots.sort((a, b) => a.from - b.from);
  const shotAt = (t: number): Cam => { let c: Cam = "dive"; for (const s of shots) if (t >= s.from) c = s.cam; return c; };

  /** The rail camera: low on the deck beside the leaders, on a long lens, a little ahead of them. */
  const rail = (t: number, aspect: number): CamPose => {
    const g = groupAt(t);
    const span = Math.max(7, Math.min(22, 4 + 3 * g.len));
    const tx = g.x - g.dir * Math.min(g.len, span * 0.6) * 0.3 + g.dir * span * 0.06;
    const ty = Math.min(1.4, 0.1 + g.above * 0.3);
    const pos: Vec3 = [tx + g.dir * span * 0.16, 2.2 + span * 0.05, RAIL];
    return framed(pos, [tx, ty, g.z], span * (tall(aspect) ? 0.62 : 1), span * 0.4, aspect, 8, 62);
  };
  /** The spidercam: high over the lanes ahead of the leaders, looking back down at them. */
  const spider = (t: number, aspect: number): CamPose => {
    const g = groupAt(t);
    const span = Math.max(11, Math.min(28, 8 + 2.4 * g.len));
    const pos: Vec3 = [g.x + g.dir * span * 0.3, 5.5 + span * 0.26, g.z + S * span * 0.45];
    return framed(pos, [g.x - g.dir * span * 0.1, 0, g.z], span * (tall(aspect) ? 0.62 : 1), span * 0.55, aspect, 10, 62);
  };

  const camera = (beat: ReturnType<typeof beatAt>, k: number, t: number, show: number, aspect: number): CamPose => {
    const back = tall(aspect) ? 1.45 : 1;
    const wide = tall(aspect) ? 0.62 : 1;
    switch (beat.cam) {
      case "crane":
        // Under the roof from a high corner, down onto the pool.
        return crane([0, 0, 0], k, aspect, { from: [36, 17, 15 * S], to: [-12, 7, 13 * S], fov0: 54, fov1: 44 });
      case "blocks":
        // Along the line of blocks from the side, the swimmers stepping up.
        return drift(framed([x0 - 4, 2.4, 15.2 * S], [x0 + 0.5, 0.9, 0], 28 * wide, 7, aspect, 10, 70), show, 0.02);
      case "marks": {
        // "Take your marks": in close on the favourite crouched on its block, from out over the water.
        const H = fav.dims.h, Wd = fav.dims.w;
        const w = Math.max(2.6, 2.2 * Math.max(H, Wd));
        return drift(framed([x0 + 1.5 + w * 0.55, POOL.block + 0.5 + H * 0.4, fav.z + S * (1.2 + w * 0.5) * back], [x0 - 0.3, POOL.block + H * 0.42, fav.z], w * wide, Math.max(H * 1.4, w * 0.5), aspect, 10, 60), show, 0.01);
      }
      case "race": {
        switch (shotAt(t)) {
          case "dive":
            // High and wide over the start end: the whole line in the air at once, over a giant's back.
            return drift(framed([x0 + 15, 10, 15.4 * S], [x0 + 5, 0.4, 0], 30 * wide, 12, aspect, 10, 70), show, 0.015);
          case "spider":
            return spider(t, aspect);
          case "turn": {
            // Over the turning wall, down the lanes: the leaders tumbling and pushing off towards the lens.
            const g = groupAt(t);
            return framed([x1 + 0.6, 6, g.z * 0.5], [x1 - 7, 0, g.z * 0.8], 20 * wide, 8, aspect, 10, 70);
          }
          case "touch":
            // From behind the touchpads, down the lanes: the rest coming in.
            return drift(framed([wallX + finDir * 0.6, 6.5, 0], [wallX - finDir * 10, 0, 0], 26 * wide, 10, aspect, 10, 70), show, 0.015);
          default:
            return drift(rail(t, aspect), show, 0.012);
        }
      }
      case "result":
        // (Above the tallest swimmer: a giant in the near lane reaches over the deck.)
        return drift(framed([wallX - finDir * 2, 3 + Math.max(...plans.map((p) => p.above)) * 0.9, 15.2 * S], [wallX - finDir * 2.5, 0.2, 0], 24 * wide, 10, aspect, 10, 70), show, 0.02);
      case "replay": {
        // From the next lane over, a little above the water, alongside the winner into the wall: the touch in slow motion.
        const w = Math.max(5, winPlan.len * 3.2);
        const fx = poolX(swimAt(wtr, t).x).x;
        const tx = finDir > 0 ? Math.min(wallX - w * 0.3, fx - winPlan.len * 0.4) : Math.max(wallX + w * 0.3, fx + winPlan.len * 0.4);
        const cx = finDir > 0 ? Math.min(wallX - 0.8, tx + w * 0.3) : Math.max(wallX + 0.8, tx - w * 0.3);
        // (Over the backstroke flags' line, not through it.)
        return framed([cx, 2.2 + w * 0.1, winPlan.z + S * (2.2 + w * 0.25) * back], [tx, 0.1 + winPlan.above * 0.3, winPlan.z], w * wide, w * 0.42, aspect, 12, 60);
      }
      default:
        return drift(framed([0, 14, 34 * back * S], [0, 0, 0], 54 * wide, 18, aspect, 10, 60), show, 0.02);
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
      emit(`s${i}-touch`, tr.finish, poolX(D).x, p.z, "splash", sz * 0.6, 0.6);
      const s = scenes[i];
      if (s.wake && !s.finished && !s.under && rt > tr.entry + 1) {
        // The kick behind it, and its arms (or paws, or head) breaking the water up front with each stroke.
        const n = Math.floor(rt / 0.45);
        const kx = s.wake.x - s.wake.dir * p.len * 0.95;
        emit(`s${i}-k${n}`, n * 0.45, kx, p.z, "spray", Math.min(4, 0.4 + sz * 0.7), Math.min(1.5, 0.45 + s.wake.v / 3), -s.wake.dir);
        const per = 1 / Math.max(0.5, p.rate * (p.stroke === "crawl" ? 2 : p.stroke === "paddle" ? 3.2 : 1.6));
        const m = Math.floor((rt - tr.entry) / per);
        const fx = s.wake.x - s.wake.dir * p.len * (p.stroke === "crawl" ? 0.22 : 0.08);
        emit(`s${i}-a${m}`, tr.entry + m * per, fx, p.z + (m % 2 ? 0.12 : -0.12) * Math.min(3, p.len), "spray", Math.min(3, 0.3 + sz * 0.45), Math.min(1.2, 0.35 + s.wake.v / 4), s.wake.dir * 0.3);
      }
    });
    const wakes = scenes.map((s) => s.wake).filter((w): w is NonNullable<typeof w> => !!w);
    const L = leaderAt(rt);
    const excitement = beat.kind === "action" ? 0.45 + 0.4 * smooth(D - 15, D, L.x) : beat.kind === "result" ? 0.9 : 0.35;
    let cam = camera(beat, k, rt, t, aspect);
    // A tall frame: the camera closes in on the leader and whoever swims with it (the winner alone in the replay).
    if (tall(aspect) && (beat.cam === "race" || beat.cam === "replay") && rt > wtr.entry) {
      const far = plans.map((p) => swimAt(p.run.trace, Math.max(0, rt)).x);
      const front = beat.cam === "replay" ? far[plans.indexOf(winPlan)] : Math.max(...far);
      const order = plans.map((_, i) => i).sort((a, b) => Math.abs(far[a] - front) - Math.abs(far[b] - front));
      const subjects: Subject[] = order.map((i) => {
        const gap = Math.abs(far[i] - front);
        const k2 = Math.max(0, Math.min(1, (gap - (beat.cam === "replay" ? 0.2 : 2)) / 4));
        return { x: scenes[i].pose.x, y: -0.4, z: plans[i].z, w: Math.max(1.2, plans[i].len), h: Math.max(1, plans[i].above + 0.8), weight: 1 - k2 * k2 * (3 - 2 * k2) };
      });
      cam = fillFrame(keepOut(cam, "pool"), subjects, aspect, 0.3);
    }
    // A swimmer's relief faces the camera across the pool; from above it would show its edge, so it tilts back
    // (away from the lens) about its line of travel by the camera's elevation, pivoting where it breaks the
    // surface: seen from the spidercam it lies in the water, its back and head out and its body under the
    // surface showing through.
    scenes.forEach((sc, i) => {
      const p = sc.pose;
      if (p.clipY == null || !p.visible) return;
      const dz = cam.pos[2] - p.z;
      const sgn = Math.sign(dz) || 1;
      const elev = Math.atan2(cam.pos[1] - plans[i].above * 0.5, Math.max(0.5, Math.abs(dz)));
      const th = Math.max(-0.15, Math.min(1.05, elev)) * 0.9;
      p.sway = (p.sway ?? 0) - sgn * Math.sign(p.dx || 1) * th;
      const hw = -p.y;
      if (hw > 0) {
        p.y = -hw * Math.cos(th);
        p.z += sgn * hw * Math.sin(th);
      }
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
          // Everyone's lane at the start and the finish; in between, the leader's.
          tags: rt < 1.5 || rt > winT - 0.2 || L.x > D - 6 ? athletes.map((a) => a.key) : [L.plan.athlete.key],
          tagText: tagFor(rt),
          // (k runs through the time it's up: in with a pop, held, out at the end.)
          mark: rt >= winT ? { text: fmt(win.time), sub: `${win.athlete.name} wins`, tone: "lead", k: Math.min(1, (rt - winT) / Math.max(2.5, raceEnd - winT)) } : showSplit ? { text: fmt(split[0].trace.split!), sub: `${split[0].athlete.name} at the turn`, tone: "plain", k: Math.min(1, (rt - split[0].trace.split!) / 4) } : undefined,
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
