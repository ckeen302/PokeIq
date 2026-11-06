import type { Athlete } from "@/lib/games/athlete";
import { formatMark } from "@/lib/games/events";
import { longJumpMark, type LongJumpResult } from "@/lib/games/longjump";
import { isFlier } from "@/lib/games/athlete";
import { LJ } from "@/lib/games/venues";
import { longJumpAt, planLongJump, type LongJumpPlan } from "../scene/motions/longjump";
import { dims, smooth } from "../scene/motions/common";
import { pickAttempts, scoreAttempts, type Pick } from "./attempts";
import { DEG, crane, drift, framed, mixPose, tall, type CamPose } from "./cams";
import { Timeline, beatAt, beatClock, beatK, type Burst, type Decal, type Overlay, type Show, type ShowFrame } from "./types";

/**
 * The long jump as a broadcast: the crane onto the runway, the start
 * list, then the competition round by round (the attempts that matter at
 * full length, the rest short), each landing measured on the tape with the
 * leader's line across the pit, a slow-motion replay of the winning jump
 * from the board, and the final standings.
 */

export interface ShowOptions {
  /** Seconds to aim for (the page ~70, the Games ~35, a video ~20). */
  budget: number;
  video?: boolean;
  /** Skip the crane and the start list. */
  quick?: boolean;
}

interface Item { pick: Pick; plan: LongJumpPlan; leaderBefore: number | null; standing: { key: string; best: number | null }[] }

export function longJumpShow(result: LongJumpResult, o: ShowOptions): Show {
  const athletes = result.cards.map((c) => c.athlete);
  const byKey = new Map(athletes.map((a) => [a.key, a]));
  // Chronological: round by round, in jumping order.
  const list: { i: number; key: string; round: number; mark: number | null }[] = [];
  for (let r = 0; r < 3; r++) for (const c of result.turns) list.push({ i: list.length, key: c.athlete.key, round: r + 1, mark: c.attempts[r]?.mark ?? null });
  const podium = result.order.filter((c) => c.best != null).slice(0, 3).map((c) => c.athlete.key);
  const scored = scoreAttempts(list, podium, (a, b) => a > b);
  const picks = pickAttempts(scored, Math.max(8, o.budget - (o.quick ? 4 : 12)), { full: 6.2, short: 3.2, replay: 5.5 });
  const pitFar = Math.max(10, ...result.cards.flatMap((c) => c.attempts.map((x) => x.physics.distance)));
  const items: Item[] = [];
  let leader: number | null = null;
  const bests = new Map<string, number | null>(athletes.map((a) => [a.key, null]));
  for (const p of picks) {
    const card = result.cards.find((c) => c.athlete.key === p.a.key)!;
    const att = card.attempts[p.a.round - 1];
    const item: Item = { pick: p, plan: planLongJump(card.athlete, att), leaderBefore: leader, standing: [] };
    if (att.mark != null) {
      if (leader == null || att.mark > leader) leader = att.mark;
      bests.set(p.a.key, Math.max(bests.get(p.a.key) ?? -1, att.mark));
    }
    item.standing = [...bests.entries()].map(([key, best]) => ({ key, best: best != null && best >= 0 ? best : null })).sort((a, b) => (b.best ?? -1) - (a.best ?? -1));
    items.push(item);
  }
  const tl = new Timeline();
  const first = items.find((x) => x.pick.cut !== "skip") ?? items[0];
  if (!o.quick) {
    tl.add({ kind: "establish", cam: "crane", title: "Long jump", sub: `Final · ${athletes.length} jumpers`, act: items.indexOf(first), clock0: first.plan.start, rate: 0 }, o.video ? 2.6 : 4.2);
    tl.add({ kind: "startlist", cam: "startlist", act: items.indexOf(first), clock0: first.plan.start, rate: 0 }, o.video ? 2.2 : 3.4);
  }
  let round = 0;
  items.forEach((it, idx) => {
    const p = it.pick;
    if (p.cut === "skip") return;
    if (p.a.round !== round) {
      round = p.a.round;
      tl.add({ kind: "card", cam: "runway", act: idx, clock0: Math.max(it.plan.start, -it.plan.run.T - 0.6), rate: 0.2, title: `Round ${round}`, sub: round === 3 ? "Last attempts" : "" }, 1.1);
    }
    const F = it.plan.attempt.physics.flight;
    const t0 = p.cut === "full" ? Math.max(it.plan.start + 0.6, -Math.min(2.6, it.plan.run.T)) : -Math.min(0.95, it.plan.run.T * 0.5);
    const t1 = F + (p.cut === "full" ? 1.6 : 0.9);
    const act = tl.add({ kind: "action", cam: "jump", act: idx, clock0: t0, rate: 1, key: p.a.key }, t1 - t0);
    tl.cue(act.t0 + (0 - t0), "whoosh", 0.25);
    tl.cue(act.t0 + (F - t0), "sand", Math.min(1, 0.35 + Math.cbrt(byKey.get(p.a.key)!.kg) / 8));
    const good = p.a.mark != null;
    tl.cue(act.t0 + (F - t0) + 0.3, good ? (p.lead ? "cheer" : "applause") : "groan", p.lead ? 1 : 0.6);
    tl.add({ kind: "result", cam: "mark", act: idx, clock0: t1, rate: 0.7, key: p.a.key }, p.cut === "full" ? 1.9 : 1.2);
    if (p.replay) tl.add({ kind: "replay", cam: "replay", act: idx, clock0: -0.5, rate: 0.3, key: p.a.key }, (F + 0.95) / 0.3);
  });
  const last = items.length - 1;
  tl.add({ kind: "board", cam: "board", act: last, clock0: items[last].plan.end, rate: 0 }, o.video ? 2.4 : 4);
  const beats = tl.beats;
  const end = tl.t;
  const winner = result.order[0];
  const nameOf = (k: string) => byKey.get(k)?.name ?? k;

  function world(t: number) {
    const beat = beatAt(beats, t);
    const it = items[beat.act ?? 0] ?? items[0];
    const tau = beatClock(beat, t);
    const s = longJumpAt(it.plan, tau, t);
    return { beat, it, tau, s };
  }

  function camera(beat: ReturnType<typeof beatAt>, k: number, it: Item, tau: number, s: ReturnType<typeof longJumpAt>, aspect: number, t: number): CamPose {
    const d = it.plan.dims;
    const H = Math.max(0.6, d.h), W = Math.max(0.6, d.w);
    const z = LJ.z;
    const back = tall(aspect) ? 1.35 : 1;
    const pitView = (): CamPose => {
      const xm = LJ.line + Math.max(3, it.plan.attempt.physics.distance * 0.55);
      const span = Math.max(it.plan.attempt.physics.distance + 2, H * 2.2);
      const dist = (6 + span * 0.55 + H * 0.8) * back;
      return framed([xm + 1.5, 0.6 + H * 0.45, z + dist], [xm, H * 0.45 + Math.max(0, s.com[1] - it.plan.attempt.physics.h0) * 0.4, z], span * (tall(aspect) ? 0.7 : 1), H * 2 + it.plan.attempt.physics.peak * 0.5, aspect, 8, 58);
    };
    switch (beat.cam) {
      case "crane":
        return crane([LJ.line - 8, 0.8, z], k, aspect, { from: [-70, 70, 110], to: [LJ.line - 28, 4 + H, z + 22], fov0: 52, fov1: 36 });
      case "startlist": {
        const x = LJ.line - 30 + 18 * k;
        return drift(framed([x + 10, 2.5 + H, z + 14 * back], [x - 6, 0.6 * H, z], 10, 4 + H, aspect, 10, 50), t);
      }
      case "jump": {
        // A rail camera alongside the runway, ahead of the jumper, three quarters from the front; it hands over to the pit camera at the board.
        const x = s.pose.x;
        const ahead = 6 + 2.2 * H;
        const rail = framed([x + ahead, 1.1 + 0.6 * H, z + (5 + 1.6 * H) * back], [x + 0.6, 0.5 * H, z], Math.max(3.2, W * 2.4), H * 2.1, aspect, 7, 50);
        return mixPose(rail, pitView(), smooth(-0.35, 0.25, tau));
      }
      case "mark": {
        // High over the pit by the mark, the tape and the athlete walking out in shot.
        const mx = LJ.line + (it.pick.a.mark ?? it.plan.attempt.physics.distance);
        const span = Math.max(6, H * 3.2, W * 2.4);
        const p = framed([mx - span * 0.15, 2.6 + span * 0.55, z + (4 + span * 0.75) * back], [mx - span * 0.08, 0.2 + H * 0.25, z], span, span * 0.5, aspect, 10, 55);
        return drift(p, t);
      }
      case "replay": {
        // Low by the board, looking down the pit as the jumper flies past.
        const span = it.plan.attempt.physics.distance + 2;
        return framed([LJ.line + span * 0.5, 0.35 + H * 0.15, z + (3.2 + span * 0.45 + H * 0.6) * back], [LJ.line + span * 0.42, H * 0.55 + it.plan.attempt.physics.peak * 0.3, z], span * 0.95, H * 2.4, aspect, 10, 62);
      }
      case "runway": {
        const x = s.pose.x;
        return drift(framed([x + 8 + 2 * H, 1.6 + H, z + (6 + 1.5 * H) * back], [x, 0.55 * H, z], Math.max(3, W * 2.5), H * 2.2, aspect, 8, 50), t);
      }
      default: {
        const x = LJ.line + 4;
        return framed([x + 6, 7 + H, z + 22 * back], [x - 6, 0.5, z], 22, 8, aspect, 10, 55);
      }
    }
  }

  const at = (t: number, aspect: number): ShowFrame => {
    const { beat, it, tau, s } = world(t);
    const k = beatK(beat, t);
    const actor = beat.kind === "board" ? { ...s.pose, visible: true } : s.pose;
    const bursts: Burst[] = [];
    const decals: Decal[] = [];
    const rate = beat.rate ?? 1;
    if (s.landed != null && s.mark) {
      const born = t - s.landed / Math.max(1e-3, rate || 1);
      const a = byKey.get(it.pick.a.key)!;
      bursts.push({ id: `lj${beat.act}-${beat.kind}`, t0: born, kind: "sand", x: s.mark.x - s.mark.len * 0.15, y: 0.02, z: LJ.z, size: Math.max(0.3, s.mark.len), power: Math.min(2.5, 0.5 + Math.cbrt(a.kg) / 6), dx: 1, dz: 0, rate: rate || 1 });
      decals.push({ id: `lj${beat.act}-mark`, t0: born, kind: "sand", x: s.mark.x - Math.min(0.9, s.mark.len * 0.18), y: 0.008, z: LJ.z, w: Math.max(0.18, Math.min(2.4, s.mark.w * 0.45)), l: Math.max(0.25, Math.min(3, s.mark.len * 0.42)), angle: Math.PI / 2 });
    }
    const showTape = (beat.kind === "result" || beat.kind === "board") && it.pick.a.mark != null;
    const leader = beat.kind === "result" || beat.kind === "board" ? (it.pick.lead ? it.pick.a.mark : it.leaderBefore) : it.leaderBefore;
    const excitement = beat.kind === "action" ? 0.35 + 0.35 * smooth(-2, 0, tau) + (s.landed != null ? 0.25 * Math.exp(-s.landed) : 0) : beat.kind === "result" ? (it.pick.lead ? 0.9 : 0.55) : 0.4;
    return {
      t,
      venue: "stadium",
      pose: camera(beat, k, it, tau, s, aspect, t),
      beat,
      k,
      actors: [{ key: it.pick.a.key, pose: actor }],
      props: { kind: "lj", pitFar, flag: s.flag || (s.landed != null && !it.plan.attempt.foul ? smooth(0.6, 1.1, s.landed) : 0), foul: it.plan.attempt.foul, tape: showTape ? it.pick.a.mark : null, leader },
      bursts,
      decals,
      excitement,
      replay: beat.kind === "replay" ? 1 : 0,
      dof: beat.kind === "result" || beat.kind === "replay" ? { focus: [s.pose.x, d0(it).h * 0.5, LJ.z], k: 0.5 } : undefined,
      fade: 0,
      flash: 0,
      clock: "",
      screen: beat.kind === "action" ? { pos: [s.pose.x + 4, 1.4, LJ.z + 5], target: [s.pose.x, 0.6, LJ.z], fov: 30 } : null,
    };
  };
  const d0 = (it: Item) => it.plan.dims;

  const overlay = (t: number): Overlay => {
    const beat = beatAt(beats, t);
    const k = beatK(beat, t);
    const it = items[beat.act ?? 0] ?? items[0];
    const a = byKey.get(it.pick.a.key)!;
    const bug = { title: "Long jump", sub: beat.kind === "board" ? "Final standings" : `Round ${it.pick.a.round}` };
    const line = `Speed ${a.stats.spe} · Attack ${a.stats.atk} · ${fmtKg(a.kg)}`;
    switch (beat.kind) {
      case "establish":
        return { title: { text: "LONG JUMP", sub: `${athletes.length} Pokémon · 3 attempts each`, k } };
      case "startlist":
        return { bug, board: { title: "Start list", rows: result.turns.map((c, i) => ({ place: String(i + 1), name: c.athlete.name, mark: `Best ${formatMark("long-jump", longJumpBest(c.athlete))}`, key: c.athlete.key, plain: true })), k } };
      case "card":
        return { bug, title: { text: beat.title ?? "", sub: beat.sub ?? "", k } };
      case "action":
        return { bug, lower: { key: a.key, name: a.name, line, tag: `Attempt ${it.pick.a.round}`, k }, tags: [a.key], caption: captionFor(a) };
      case "result": {
        const mark = it.pick.a.mark;
        return {
          bug,
          mark: mark == null ? { text: "FOUL", sub: "Over the line", tone: "bad", k } : { text: formatMark("long-jump", mark), sub: it.pick.lead ? "New leader" : `${placeIn(it, a.key)}`, tone: it.pick.lead ? "lead" : "good", k },
          board: { title: "Standings", rows: it.standing.slice(0, 8).map((r, i) => ({ place: String(i + 1), name: nameOf(r.key), mark: r.best == null ? "—" : formatMark("long-jump", r.best), key: r.key, hi: r.key === a.key })), k },
        };
      }
      case "replay":
        return { replay: true, lower: { key: a.key, name: a.name, line: `Take-off ${(it.plan.attempt.physics.vx * 3.6).toFixed(0)} km/h · ${(Math.atan2(it.plan.attempt.physics.vy, it.plan.attempt.physics.vx) / DEG).toFixed(0)}° · ${formatMark("long-jump", it.pick.a.mark)}`, tag: "Replay", k } };
      default:
        return { bug, board: { title: "Long jump · final", rows: result.order.map((c) => ({ place: c.best == null ? "—" : String(c.place), name: c.athlete.name, mark: c.best == null ? "NM" : formatMark("long-jump", c.best), key: c.athlete.key, hi: c.place === 1 })), k } };
    }
  };
  const placeIn = (it: Item, key: string) => {
    const i = it.standing.findIndex((r) => r.key === key);
    return i < 0 ? "" : `${ordinal(i + 1)} so far`;
  };

  return {
    event: "long-jump",
    venue: "stadium",
    athletes,
    beats,
    cues: tl.cues,
    end,
    at,
    overlay,
    resultsAt: beats.find((b) => b.kind === "board")?.t0 ?? end,
    hook: "Which Pokémon jumps the furthest? 🦘",
    headline: winner.best != null ? `${winner.athlete.name} wins with ${formatMark("long-jump", winner.best)}` : "No legal jump",
  };
}

/** The model's best on a perfect day (the records' mark). */
const longJumpBest = (a: Athlete) => longJumpMark(a);

export const fmtKg = (kg: number) => (kg >= 100 ? `${Math.round(kg)} kg` : `${kg.toFixed(kg < 1 ? 2 : 1)} kg`);
export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/** The commentary line: what's physically true and worth saying. */
export function captionFor(a: Athlete): string | undefined {
  const d = dims(a);
  if (isFlier(a)) return "No gliding: it's a jump, so the same physics as everyone";
  if (d.h > 4) return `${a.name}'s centre of mass starts ${(0.55 * d.h).toFixed(1)} m up`;
  return undefined;
}

/** The throws' commentary line: a giant lets go far above the ground. */
export function throwCaption(a: Athlete, releaseHeight: number): string | undefined {
  if (releaseHeight > 3) return `${a.name} lets go ${releaseHeight.toFixed(1)} m up: a head start on the drop`;
  return undefined;
}
