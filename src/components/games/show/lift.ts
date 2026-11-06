import { loadBar, liftMark, type LiftResult } from "@/lib/games/lift";
import { REF_LIGHTS } from "@/lib/games/venues";
import { liftAt, planLift, type LiftPlan } from "../scene/motions/lift";
import { smooth } from "../scene/motions/common";
import { pickAttempts, scoreAttempts, type Pick } from "./attempts";
import { crane, drift, framed, mixPose, tall, type CamPose } from "./cams";
import { fmtKg, ordinal, type ShowOptions } from "./longjump";
import { Timeline, beatAt, beatClock, beatK, type Burst, type Overlay, type Show, type ShowFrame } from "./types";

/**
 * Weightlifting as a broadcast: the crane down onto the platform, the
 * start list (opening weights), then the competition on the rising bar,
 * lift by lift: the lifts that matter in full (the walk out, the clean,
 * the jerk, the referees' lights), the rest from the jerk; a slow-motion
 * replay of the winning lift; the standings after every lift and the final
 * board with pound for pound. Pure.
 */

interface Item {
  pick: Pick;
  plan: LiftPlan;
  /** Standings after this lift: each lifter's best so far. */
  standing: { key: string; best: number | null }[];
  lead: boolean;
}

/** Half the loaded bar's length (m): the plates run past a real sleeve for a giant's load. */
function barHalf(weight: number): number {
  const l = loadBar(weight);
  if (!l) return 0.75;
  const grip = l.bar === 20 ? 0.655 : 0.6;
  return Math.max(l.bar === 20 ? 1.1 : 1.0, grip + 0.03 + l.side.reduce((s, p) => s + p.w + 0.004, 0) + (l.collars ? 0.09 : 0));
}

export function liftShow(result: LiftResult, o: ShowOptions): Show {
  const athletes = result.cards.map((c) => c.athlete);
  const byKey = new Map(athletes.map((a) => [a.key, a]));
  const cardOf = new Map(result.cards.map((c) => [c.athlete.key, c]));
  const seq = result.sequence;
  const list = seq.map((s, i) => ({ i, key: s.key, round: s.n, mark: s.success ? s.weight : null }));
  const podium = result.order.filter((c) => c.best != null).slice(0, 3).map((c) => c.athlete.key);
  const picks = pickAttempts(scoreAttempts(list, podium, (a, b) => a > b), Math.max(10, o.budget - (o.quick ? 4 : 12)), { full: 15, short: 5.2, replay: 5.5 });
  const items: Item[] = [];
  const bests = new Map<string, number | null>(athletes.map((a) => [a.key, null]));
  let leader = -1;
  for (const p of picks) {
    const s = seq[p.a.i];
    const card = cardOf.get(s.key)!;
    if (s.success) bests.set(s.key, Math.max(bests.get(s.key) ?? -1, s.weight));
    const lead = s.success && s.weight > leader;
    if (lead) leader = s.weight;
    items.push({ pick: p, plan: planLift(card.athlete, s, card.max), lead, standing: [...bests.entries()].map(([key, best]) => ({ key, best })).sort((x, y) => (y.best ?? -1) - (x.best ?? -1) || byKey.get(x.key)!.kg - byKey.get(y.key)!.kg) });
  }
  const tl = new Timeline();
  const shown = items.filter((x) => x.pick.cut !== "skip");
  const first = shown[0] ?? items[0];
  const fi = items.indexOf(first);
  if (!o.quick) {
    tl.add({ kind: "establish", cam: "crane", act: fi, clock0: first.plan.start, rate: 0 }, o.video ? 2.6 : 4.2);
    tl.add({ kind: "startlist", cam: "startlist", act: fi, clock0: first.plan.start, rate: 0 }, o.video ? 2.2 : 3.4);
  }
  items.forEach((it, idx) => {
    const p = it.pick;
    if (p.cut === "skip") return;
    const pl = it.plan;
    // Full: from the walk out. Short: from the jerk (or, for a stalled clean, the catch).
    const t0 = p.cut === "full" ? -6.2 : pl.fail === "clean" ? pl.catchT - 0.5 : pl.jerkT - 0.5;
    const t1 = Math.max(pl.downT, pl.landT) + (p.cut === "full" ? 1.6 : 0.9);
    const act = tl.add({ kind: "action", cam: "lift", act: idx, clock0: t0, rate: 1, key: p.a.key }, t1 - t0);
    const at = (tau: number) => act.t0 + (tau - t0);
    if (p.cut === "full") tl.cue(at(-4.3 + 0.05), "chalk", 0.4);
    if (t0 <= 0) tl.cue(at(0.55), "stomp", 0.35);
    if (pl.fail !== "clean") tl.cue(at(pl.jerkT + 0.6), "stomp", 0.6);
    tl.cue(at(pl.downT), "beep", 0.5);
    tl.cue(at(pl.landT), "clank", Math.min(1, 0.45 + pl.weight / 600));
    tl.cue(at(pl.downT + 0.15), pl.success ? (it.lead ? "cheer" : "applause") : "groan", it.lead ? 1 : 0.7);
    tl.add({ kind: "result", cam: "result", act: idx, clock0: t1, rate: 0.6, key: p.a.key }, p.cut === "full" ? 1.8 : 1.1);
    if (p.replay && pl.fail !== "clean") tl.add({ kind: "replay", cam: "replay", act: idx, clock0: pl.jerkT - 0.3, rate: 0.33, key: p.a.key }, Math.min(8, (pl.lockT + 0.9 - (pl.jerkT - 0.3)) / 0.33));
  });
  const last = items.length - 1;
  tl.add({ kind: "board", cam: "board", act: last, clock0: items[last].plan.end, rate: 0 }, o.video ? 2.6 : 4.4);
  const beats = tl.beats;
  const end = tl.t;

  const camera = (beat: ReturnType<typeof beatAt>, k: number, it: Item, tau: number, aspect: number, t: number): CamPose => {
    const pl = it.plan;
    const H = Math.max(0.5, pl.dims.h);
    const half = barHalf(pl.weight);
    const back = tall(aspect) ? 1.35 : 1;
    const W = Math.max(3.2, 2 * half + 0.8, 1.5 * pl.dims.w);
    const front = (tight: number): CamPose => {
      const h = (1.5 - 0.25 * tight) * H + 0.5;
      return framed([0.5 + 0.1 * H, 0.55 + 0.32 * H, (3.4 + 1.5 * Math.max(H, half)) * back], [0, 0.6 * H, 0], W * (1 - 0.15 * tight), h, aspect, 8, 50);
    };
    switch (beat.cam) {
      case "crane":
        return crane([0, 0.8, 0], k, aspect, { from: [26, 20, 30], to: [5 + H, 2.5 + H * 0.6, 9 + H], fov0: 52, fov1: 36 });
      case "startlist":
        return drift(framed([7, 3.5, 11 * back], [0, 1, 0], 8, 5, aspect, 10, 55), t);
      case "lift": {
        // The walk out from the side, then the front camera, pushing in as it stands and jerks; the lights at the decision.
        const walk = framed([3 + H, 0.6 + 0.4 * H, (3 + 1.4 * H) * back], [0, 0.55 * H, pl.z - 1], Math.max(4, 2.2 * H), 1.6 * H + 0.5, aspect, 8, 50);
        const push = smooth(pl.catchT, pl.jerkT + 0.7, tau);
        let pose = mixPose(walk, front(push), smooth(-3.4, -2, tau));
        const lightsShot = framed([REF_LIGHTS.x + 2.2, 1.6, REF_LIGHTS.z + 3.2], [REF_LIGHTS.x * 0.45, Math.min(1.8, 0.5 * H + 0.6), REF_LIGHTS.z * 0.45], Math.max(5, 1.6 * H), Math.max(3, 1.4 * H), aspect, 10, 55);
        if (tau > pl.downT - 0.1) pose = mixPose(pose, lightsShot, smooth(pl.downT - 0.1, pl.downT + 0.35, tau) * (1 - smooth(pl.downT + 1.4, pl.downT + 1.9, tau)));
        return drift(pose, t, 0.012);
      }
      case "result":
        return drift(front(0.2), t, 0.02);
      case "replay":
        // Low beside the platform, looking up at the bar as it goes overhead.
        return framed([1.2 + 0.7 * half + 0.5 * H, 0.35, (1.6 + 0.9 * H) * back], [0, 0.75 * H, 0], Math.max(2.4, 1.3 * H, 2 * half), 1.35 * H + 0.4, aspect, 12, 60);
      default:
        return drift(framed([0, 4 + H * 0.6, (13 + 2 * H) * back], [0, 1 + 0.4 * H, 0], 9 + 2 * H, 5 + H, aspect, 10, 55), t);
    }
  };

  const at = (t: number, aspect: number): ShowFrame => {
    const beat = beatAt(beats, t);
    const k = beatK(beat, t);
    const it = items[beat.act ?? 0] ?? items[0];
    const tau = beatClock(beat, t);
    const s = liftAt(it.plan, tau, t);
    const rate = beat.rate || 1;
    const H = it.plan.dims.h;
    const bursts: Burst[] = [];
    if (tau >= s.chalkAt && beat.kind === "action") bursts.push({ id: `wl${beat.act}-chalk`, t0: t - (tau - s.chalkAt) / rate, kind: "chalk", x: 0, y: 0.45 * H, z: it.plan.z - 0.6, size: Math.max(0.6, H * 0.4), power: 0.6, rate });
    if (s.landed != null) {
      const half = barHalf(it.plan.weight);
      for (const sd of [-1, 1]) bursts.push({ id: `wl${beat.act}-${beat.kind}-${sd}`, t0: t - s.landed / rate, kind: "chalk", x: sd * (half - 0.15), y: 0.12, z: s.bar?.[2] ?? 0, size: 0.8, power: 0.5, rate });
    }
    const excitement = beat.kind === "action" ? 0.25 + 0.35 * smooth(it.plan.catchT, it.plan.lockT, tau) + (tau > it.plan.downT ? (it.plan.success ? 0.4 : 0.1) * Math.exp(-(tau - it.plan.downT) / 2) : 0) : beat.kind === "result" ? (it.plan.success ? 0.8 : 0.35) : 0.35;
    return {
      t,
      venue: "arena",
      pose: camera(beat, k, it, tau, aspect, t),
      beat,
      k,
      actors: [{ key: it.pick.a.key, pose: s.pose }],
      props: { kind: "lift", bar: s.bar, weight: it.plan.weight, bend: s.bend, whip: s.whip, lights: s.lights, tilt: s.tilt },
      bursts,
      decals: [],
      excitement,
      replay: beat.kind === "replay" ? 1 : 0,
      dof: beat.kind === "replay" || beat.kind === "result" ? { focus: s.bar ?? s.com, k: 0.5 } : undefined,
      fade: 0,
      flash: 0,
      clock: "",
      screen: null,
    };
  };

  const attemptsLine = (key: string, upto?: number) => {
    const c = cardOf.get(key)!;
    const shownAt = new Set(seq.slice(0, (upto ?? seq.length - 1) + 1).filter((s) => s.key === key));
    return c.attempts.filter((a) => shownAt.has(a)).map((a) => `${a.weight}${a.success ? "✓" : "✗"}`).join("  ");
  };

  const overlay = (t: number): Overlay => {
    const beat = beatAt(beats, t);
    const k = beatK(beat, t);
    const it = items[beat.act ?? 0] ?? items[0];
    const s = seq[it.pick.a.i];
    const a = byKey.get(s.key)!;
    const bug = { title: "Weightlifting", sub: beat.kind === "board" ? "Final standings" : `Bar ${s.weight} kg` };
    switch (beat.kind) {
      case "establish":
        return { title: { text: "WEIGHTLIFTING", sub: `Clean & jerk · ${athletes.length} lifters · 3 attempts`, k } };
      case "startlist":
        return { bug, board: { title: "Start list · opening weight", rows: [...result.cards].sort((x, y) => (x.attempts[0]?.weight ?? 0) - (y.attempts[0]?.weight ?? 0)).map((c, i) => ({ place: String(i + 1), name: c.athlete.name, mark: c.attempts[0] && seq.includes(c.attempts[0]) ? `${c.attempts[0].weight} kg` : "—", key: c.athlete.key, note: `best ${liftMark(c.athlete)} kg`, plain: true })), k } };
      case "action": {
        const tau = beatClock(beat, t);
        const pl = it.plan;
        const decided = tau >= pl.downT;
        return {
          bug,
          lower: tau < pl.downT - 0.4 ? { key: a.key, name: a.name, line: `Attempt ${s.n} · ${s.weight} kg · ${(s.weight / a.kg).toFixed(s.weight / a.kg >= 10 ? 0 : 1)}× its ${fmtKg(a.kg)}`, tag: `Attempt ${s.n}`, k } : undefined,
          mark: decided ? { text: pl.success ? "GOOD LIFT" : "NO LIFT", sub: `${s.weight} kg`, tone: pl.success ? (it.lead ? "lead" : "good") : "bad", k: smooth(pl.downT, pl.downT + 0.3, tau) } : undefined,
          tags: tau < -2 ? [a.key] : [],
          caption: tau > pl.catchT && tau < pl.downT && pl.grind > 0.7 ? `${Math.round(pl.load * 100)}% of its best today` : undefined,
        };
      }
      case "result":
        return {
          bug,
          mark: { text: it.plan.success ? `${s.weight} kg` : "NO LIFT", sub: it.plan.success ? (it.lead ? "New leader" : `${ordinal(it.standing.findIndex((r) => r.key === a.key) + 1)} so far`) : `${s.weight} kg`, tone: it.plan.success ? (it.lead ? "lead" : "good") : "bad", k },
          board: { title: "Standings", rows: it.standing.slice(0, 8).map((r, i) => ({ place: String(i + 1), name: byKey.get(r.key)!.name, mark: r.best == null ? "—" : `${r.best} kg`, key: r.key, hi: r.key === a.key, note: attemptsLine(r.key, it.pick.a.i) })), k },
        };
      case "replay":
        return { replay: true, lower: { key: a.key, name: a.name, line: `${s.weight} kg overhead · ${(s.weight / a.kg).toFixed(1)}× bodyweight`, tag: "Replay", k } };
      default: {
        const p4p = result.p4p.find((c) => c.p4p != null);
        return {
          bug,
          board: { title: "Weightlifting · final", rows: result.order.map((c) => ({ place: c.best == null ? "—" : String(c.place), name: c.athlete.name, mark: c.best == null ? "NM" : `${c.best} kg`, key: c.athlete.key, hi: c.place === 1, note: c.best == null ? "no lift" : attemptsLine(c.athlete.key) })), k },
          caption: p4p ? `Pound for pound: ${p4p.athlete.name}, ${p4p.p4p!.toFixed(2)}× its bodyweight` : undefined,
        };
      }
    }
  };

  const gold = result.order[0];
  return {
    event: "weightlifting",
    venue: "arena",
    athletes,
    beats,
    cues: tl.cues,
    end,
    at,
    overlay,
    resultsAt: beats.find((b) => b.kind === "board")?.t0 ?? end,
    hook: "Which Pokémon lifts the most? 🏋️",
    headline: gold?.best != null ? `${gold.athlete.name} wins with ${gold.best} kg` : "No good lift",
  };
}
