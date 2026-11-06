import { formatMark } from "@/lib/games/events";
import { javelinMark, shotMark, type ThrowResult } from "@/lib/games/throws";
import { JT, SP, jtLine } from "@/lib/games/venues";
import { planThrow, throwAt, type ThrowPlan } from "../scene/motions/throws";
import { clamp01, smooth } from "../scene/motions/common";
import { pickAttempts, scoreAttempts, type Pick } from "./attempts";
import { crane, drift, framed, mixPose, tall, type CamPose } from "./cams";
import { fmtKg, ordinal, throwCaption, type ShowOptions } from "./longjump";
import { Timeline, beatAt, beatClock, beatK, type Burst, type Decal, type Overlay, type Show, type ShowFrame } from "./types";

/**
 * The shot put and the javelin as a broadcast: the crane onto the circle
 * or the runway, the start list, the competition round by round with the
 * throws that matter at full length, a camera following the implement's
 * flight, the landing measured with the tape and the leader's arc across
 * the sector, a slow-motion replay of the winning throw, the standings.
 */

interface Item { pick: Pick; plan: ThrowPlan; leaderBefore: number | null; standing: { key: string; best: number | null }[] }

export function throwShow(result: ThrowResult, o: ShowOptions): Show {
  const shot = result.implement === "shot";
  const ev = shot ? "shot-put" : "javelin";
  const name = shot ? "Shot put" : "Javelin";
  const athletes = result.cards.map((c) => c.athlete);
  const byKey = new Map(athletes.map((a) => [a.key, a]));
  const list: { i: number; key: string; round: number; mark: number | null }[] = [];
  for (let r = 0; r < 3; r++) for (const c of result.turns) list.push({ i: list.length, key: c.athlete.key, round: r + 1, mark: c.attempts[r]?.mark ?? null });
  const podium = result.order.filter((c) => c.best != null).slice(0, 3).map((c) => c.athlete.key);
  const planFor = new Map<number, ThrowPlan>();
  const planOf = (a: { i: number; key: string; round: number }) => {
    let pl = planFor.get(a.i);
    if (!pl) { const card = result.cards.find((c) => c.athlete.key === a.key)!; pl = planThrow(card.athlete, card.attempts[a.round - 1]); planFor.set(a.i, pl); }
    return pl;
  };
  const picks = pickAttempts(scoreAttempts(list, podium, (a, b) => a > b), Math.max(8, o.budget - (o.quick ? 4 : 12) - 3.3), (a, cut) => {
    const pl = planOf(a);
    const F = pl.noMark ? 0.6 : pl.flight;
    if (cut === "replay") return Math.min(9, (Math.min(F, 2.2) + 0.7) / 0.32);
    return cut === "full" ? (F + 1.4 - Math.max(pl.start + 0.3, shot ? -2.4 : -2.6)) + 1.9 : (F + 0.8 + (shot ? 0.7 : 0.9)) + 1.2;
  });
  const items: Item[] = [];
  let leader: number | null = null;
  const bests = new Map<string, number | null>(athletes.map((a) => [a.key, null]));
  for (const p of picks) {
    const card = result.cards.find((c) => c.athlete.key === p.a.key)!;
    const att = card.attempts[p.a.round - 1];
    const item: Item = { pick: p, plan: planOf(p.a), leaderBefore: leader, standing: [] };
    if (att.mark != null) {
      if (leader == null || att.mark > leader) leader = att.mark;
      bests.set(p.a.key, Math.max(bests.get(p.a.key) ?? -1, att.mark));
    }
    item.standing = [...bests.entries()].map(([key, best]) => ({ key, best: best != null && best >= 0 ? best : null })).sort((a, b) => (b.best ?? -1) - (a.best ?? -1));
    items.push(item);
  }
  const tl = new Timeline();
  const shown = items.filter((x) => x.pick.cut !== "skip");
  const first = shown[0] ?? items[0];
  const fi = items.indexOf(first);
  if (!o.quick) {
    tl.add({ kind: "establish", cam: "crane", act: fi, clock0: first.plan.start, rate: 0 }, o.video ? 2.6 : 4.2);
    tl.add({ kind: "startlist", cam: "startlist", act: fi, clock0: first.plan.start, rate: 0 }, o.video ? 2.2 : 3.4);
  }
  let round = 0;
  items.forEach((it, idx) => {
    const p = it.pick;
    if (p.cut === "skip") return;
    if (p.a.round !== round) {
      round = p.a.round;
      tl.add({ kind: "card", cam: "throw", act: idx, clock0: it.plan.start, rate: 0.15, title: `Round ${round}`, sub: round === 3 ? "Last throws" : "" }, 1.1);
    }
    const pl = it.plan;
    const t0 = p.cut === "full" ? Math.max(pl.start + 0.3, shot ? -2.4 : -2.6) : shot ? -0.7 : -0.9;
    const t1 = (pl.noMark ? 0.6 : pl.flight) + (p.cut === "full" ? 1.4 : 0.8);
    const act = tl.add({ kind: "action", cam: "throw", act: idx, clock0: t0, rate: 1, key: p.a.key }, t1 - t0);
    if (!pl.noMark) {
      tl.cue(act.t0 - t0, "whoosh", 0.35);
      tl.cue(act.t0 + pl.flight - t0, "thud", shot ? 0.5 : 0.3);
    }
    tl.cue(act.t0 + Math.max(0, (pl.noMark ? 0 : pl.flight) - t0) + 0.25, p.a.mark != null ? (p.lead ? "cheer" : "applause") : "groan", p.lead ? 1 : 0.6);
    tl.add({ kind: "result", cam: "mark", act: idx, clock0: t1, rate: 0.6, key: p.a.key }, p.cut === "full" ? 1.9 : 1.2);
    if (p.replay) tl.add({ kind: "replay", cam: "replay", act: idx, clock0: -0.45, rate: 0.32, key: p.a.key }, Math.min(9, (Math.min(pl.flight, 2.2) + 0.7) / 0.32));
  });
  const last = items.length - 1;
  tl.add({ kind: "board", cam: "board", act: last, clock0: items[last].plan.end, rate: 0 }, o.video ? 2.4 : 4);
  const beats = tl.beats;
  const end = tl.t;
  const winner = result.order[0];
  const markOf = shot ? shotMark : javelinMark;
  const lineX = shot ? SP.x - SP.r : jtLine();
  const cz = shot ? SP.z : JT.z;

  const camera = (beat: ReturnType<typeof beatAt>, k: number, it: Item, tau: number, s: ReturnType<typeof throwAt>, aspect: number, t: number): CamPose => {
    const d = it.plan.dims;
    const H = Math.max(0.6, d.h);
    const back = tall(aspect) ? 1.4 : 1;
    const range = Math.max(4, it.plan.noMark ? 3 : it.plan.attempt.physics.distance);
    const peak = Math.max(1, it.plan.attempt.physics.peak);
    // The flight, as a director covers it: the athlete and the implement together as it leaves the hand
    // (from beside and above, so the field is behind them, not the stands); then the implement in the air
    // (the shot from beside and above, its tracer arcing over the sector; the javelin, high and long, from
    // behind and above it, looking down the sector with its arc traced back towards the lens), followed all
    // the way into the ground; then a cut to the spot, low beside it.
    const flight = (): CamPose => {
      const p = s.pos ?? [lineX, 1, cz];
      const F = Math.max(0.3, it.plan.flight);
      const u = clamp01(tau / F);
      const ax = it.plan.releaseX + 0.3;
      const bx = Math.max(H * 1.6 + 3, ax - p[0] + 4 + H);
      const by = Math.max(p[1], H) + 1.5;
      const bc = (ax + p[0]) / 2;
      const both = framed([bc + bx * 0.12, Math.max(2.5, 1.2 + bx * 0.38 + by * 0.3), cz + (bx * 0.85 + 2) * back], [bc - bx * 0.05, Math.max(0.4, by * 0.42), cz], bx, by, aspect, 10, 62);
      const w = Math.max(10, H * 1.6, Math.min(20, range * 0.22));
      const air = shot
        ? framed([p[0] + w * 0.4, Math.max(2.5, p[1] + 2.5 + w * 0.32), cz + w * 0.95 * back], [p[0] - w * 0.08, Math.max(0.3, p[1] * 0.85), cz], w, w * 0.56, aspect, 10, 60)
        : framed([p[0] + 8, p[1] + 6, cz + 3 * back], [p[0] - 0.6, p[1] - 0.45, cz], 9, 5.5, aspect, 12, 62);
      // Cuts: off the hand for most of a second, then with it all the way down; a moment after it lands, in
      // close beside the spot.
      const cut1 = Math.min(0.3, Math.max(0.12, 0.9 / F));
      if (u < cut1) return both;
      if (tau < F + 0.2) return shot ? mixPose(both, air, smooth(cut1, cut1 + 0.18, u)) : air;
      const lx = it.plan.landX;
      const lw = shot ? 8 : 11;
      return framed([lx + lw * 0.3, 1.2 + lw * 0.22, cz + lw * 0.85 * back], [lx - lw * 0.08, 0.5, cz], lw, lw * 0.5, aspect, 10, 60);
    };
    const thrower = (): CamPose => {
      const x = s.com[0];
      return framed([x - 3 - H * 1.2, 1.2 + 0.7 * H, cz + (4.5 + 2.2 * H) * back], [x + 0.3, H * 0.55, cz], Math.max(3.4, H * 2.4, d.w * 2.4), H * 2.1, aspect, 8, 52);
    };
    switch (beat.cam) {
      case "crane":
        return shot
          ? crane([SP.x, 1, SP.z], k, aspect, { from: [SP.x + 60, 55, 80], to: [SP.x - 10, 6, 16], fov0: 50, fov1: 40 })
          : crane([jtLine() + 6, 1, JT.z], k, aspect, { from: [jtLine() + 40, 60, 90], to: [jtLine() - 14, 6, 18], fov0: 50, fov1: 40 });
      case "startlist":
        return drift(framed([lineX - 20, 8, cz + 26 * back], [lineX - 30, 0, cz], 40, 12, aspect, 10, 55), t);
      case "throw":
        return tau < 0 || !s.pos ? thrower() : mixPose(thrower(), flight(), smooth(0.02, 0.45, tau));
      case "mark": {
        // The measurement: from just past the mark, looking back the way it came: the implement in the turf,
        // the tape running back to the line, the tracer's arc overhead.
        const lx = it.plan.landX;
        if (it.plan.noMark) return drift(framed([lx + 3, 2, cz + 4 * back], [lx, 0.4, cz], 6, 3, aspect, 10, 60), t);
        const reach = Math.min(range, 45);
        return drift(framed([lx - 12, 6.5, cz + 3 * back], [lx + reach * 0.3, 0, cz], Math.max(12, reach * 0.5), Math.max(6.5, reach * 0.27), aspect, 12, 62), t, 0.02);
      }
      case "replay": {
        // Slow motion from low beside the athlete, in close on the release; then off with the implement.
        const x = it.plan.releaseX;
        const low = framed([x - 1.5 - H, 0.45 + 0.35 * H, cz + (2.6 + 1.6 * Math.max(H, d.w * 0.6)) * back], [x + 0.2, H * 0.6, cz], Math.max(3, H * 2, d.w * 2), H * 1.8, aspect, 10, 55);
        return tau < 0 || !s.pos ? low : mixPose(low, flight(), smooth(0.04, 0.5, tau));
      }
      default:
        return framed([lineX - range * 0.4 + 10, 10 + peak * 0.3, cz + (range * 0.55 + 20) * back], [lineX - range * 0.45, 0, cz], range + 10, 12, aspect, 10, 60);
    }
  };

  const at = (t: number, aspect: number): ShowFrame => {
    const beat = beatAt(beats, t);
    const k = beatK(beat, t);
    const it = items[beat.act ?? 0] ?? items[0];
    const tau = beatClock(beat, t);
    const s = throwAt(it.plan, tau, t);
    const rate = beat.rate || 1;
    const bursts: Burst[] = [];
    const decals: Decal[] = [];
    if (s.landed != null) {
      const born = t - s.landed / rate;
      bursts.push({ id: `th${beat.act}-${beat.kind}`, t0: born, kind: "turf", x: it.plan.landX, y: 0.02, z: cz, size: shot ? 0.6 : 0.4, power: shot ? 1 : 0.5, rate });
      decals.push({ id: `th${beat.act}-divot`, t0: born, kind: "divot", x: it.plan.landX - (shot ? 0.1 : -0.1), y: 0.01, z: cz, w: shot ? 0.45 : 0.25, l: shot ? 0.55 : 0.35, angle: 0 });
    }
    const showTape = (beat.kind === "result" || beat.kind === "board") && it.pick.a.mark != null;
    const leader = beat.kind === "result" || beat.kind === "board" ? (it.pick.lead ? it.pick.a.mark : it.leaderBefore) : it.leaderBefore;
    const excitement = beat.kind === "action" ? 0.35 + 0.3 * smooth(-1.5, 0, tau) + (tau > 0 ? 0.3 * smooth(0, it.plan.flight, tau) : 0) : beat.kind === "result" ? (it.pick.lead ? 0.9 : 0.5) : 0.4;
    return {
      t,
      venue: "stadium",
      pose: camera(beat, k, it, tau, s, aspect, t),
      beat,
      k,
      actors: [{ key: it.pick.a.key, pose: s.pose }],
      props: { kind: "throw", implement: result.implement, tape: showTape ? it.pick.a.mark : null, leader, pos: s.pos, dir: s.dir, trail: s.trail, stuck: s.stuck },
      bursts,
      decals,
      excitement,
      replay: beat.kind === "replay" ? 1 : 0,
      dof: beat.kind === "replay" ? { focus: s.pos ?? s.com, k: 0.5 } : undefined,
      fade: 0,
      flash: 0,
      clock: "",
      screen: beat.kind === "action" ? { pos: [s.com[0] - 4, 1.6, cz + 6], target: [s.com[0], 1, cz], fov: 32 } : null,
    };
  };

  const overlay = (t: number): Overlay => {
    const beat = beatAt(beats, t);
    const k = beatK(beat, t);
    const it = items[beat.act ?? 0] ?? items[0];
    const a = byKey.get(it.pick.a.key)!;
    const bug = { title: name, sub: beat.kind === "board" ? "Final standings" : `Round ${it.pick.a.round}` };
    const ph = it.plan.attempt.physics;
    switch (beat.kind) {
      case "establish":
        return { title: { text: name.toUpperCase(), sub: shot ? "The real 7.26 kg shot · 3 throws each" : "The real 800 g javelin · 3 throws each", k } };
      case "startlist":
        return { bug, board: { title: "Start list", rows: result.turns.map((c, i) => ({ place: String(i + 1), name: c.athlete.name, mark: `Best ${formatMark(ev, markOf(c.athlete) || null)}`, key: c.athlete.key, plain: true })), k } };
      case "card":
        return { bug, title: { text: beat.title ?? "", sub: beat.sub ?? "", k } };
      case "action": {
        // The name up for the run-up (gone before the release), the distance the moment it lands.
        const tau = beatClock(beat, t);
        const t0 = beat.clock0 ?? 0, nameEnd = -0.35;
        const down = it.plan.noMark ? 0.3 : it.plan.flight;
        const t1 = (it.plan.noMark ? 0.6 : it.plan.flight) + (it.pick.cut === "full" ? 1.4 : 0.8);
        return {
          bug,
          lower: tau < nameEnd && nameEnd - t0 > 1.2 ? { key: a.key, name: a.name, line: `Attack ${a.stats.atk} · ${fmtKg(a.kg)}${it.plan.armless ? " · no arms: a flick at 60%" : ""}`, tag: `Throw ${it.pick.a.round}`, k: (tau - t0) / (nameEnd - t0) } : undefined,
          tags: tau < 0 ? [a.key] : [],
          caption: tau < 1 ? (it.plan.noMark ? `${a.name} can't lift a ${shot ? "7.26 kg shot" : "800 g javelin"}` : throwCaption(a, ph.height)) : undefined,
          mark: tau >= down ? markFor(it, a.key, 0.5 * Math.min(1, (tau - down) / Math.max(0.5, t1 - down))) : undefined,
        };
      }
      case "result": {
        return {
          bug,
          // (Carried on from the landing: no second pop.)
          mark: markFor(it, a.key, 0.5 + 0.5 * k),
          board: { title: "Standings", rows: it.standing.slice(0, 8).map((r, i) => ({ place: String(i + 1), name: byKey.get(r.key)!.name, mark: r.best == null ? "—" : formatMark(ev, r.best), key: r.key, hi: r.key === a.key })), k },
        };
      }
      case "replay":
        return { replay: true, lower: { key: a.key, name: a.name, line: `Release ${(ph.v * 3.6).toFixed(0)} km/h at ${((ph.angle * 180) / Math.PI).toFixed(0)}° · ${ph.peak.toFixed(1)} m high · ${formatMark(ev, it.pick.a.mark)}`, tag: "Replay", k } };
      default:
        return { bug, board: { title: `${name} · final`, rows: result.order.map((c) => ({ place: c.best == null ? "—" : String(c.place), name: c.athlete.name, mark: c.best == null ? "NM" : formatMark(ev, c.best), key: c.athlete.key, hi: c.place === 1 })), k } };
    }
  };
  const markFor = (it: Item, key: string, k: number): NonNullable<Overlay["mark"]> => {
    const mark = it.pick.a.mark;
    return mark == null ? { text: "NO MARK", sub: it.plan.noMark ? "Couldn't lift it" : "", tone: "bad", k } : { text: formatMark(ev, mark), sub: it.pick.lead ? "New leader" : `${place(it, key)}`, tone: it.pick.lead ? "lead" : "good", k };
  };
  const place = (it: Item, key: string) => {
    const i = it.standing.findIndex((r) => r.key === key);
    return i < 0 ? "" : `${ordinal(i + 1)} so far`;
  };

  return {
    event: ev,
    venue: "stadium",
    athletes,
    beats,
    cues: tl.cues,
    end,
    at,
    overlay,
    resultsAt: beats.find((b) => b.kind === "board")?.t0 ?? end,
    hook: shot ? "Which Pokémon throws the furthest? 💪" : "Who throws the javelin furthest? 🎯",
    headline: winner.best != null ? `${winner.athlete.name} wins with ${formatMark(ev, winner.best)}` : "No legal throw",
  };
}
