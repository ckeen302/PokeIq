import type { Athlete } from "@/lib/games/athlete";
import { formatMark } from "@/lib/games/events";
import { countback, highJumpMark, type HighJumpResult, type HjCard, type HjJump } from "@/lib/games/highjump";
import { HJ } from "@/lib/games/venues";
import { highJumpAt, planHighJump, type HighJumpPlan } from "../scene/motions/highjump";
import { smooth } from "../scene/motions/common";
import { crane, drift, framed, mixPose, tall, type CamPose } from "./cams";
import { captionFor, fmtKg, type ShowOptions } from "./longjump";
import { Timeline, beatAt, beatClock, beatK, type Overlay, type Show, type ShowFrame } from "./types";

/**
 * The high jump as a broadcast: the crane onto the fan, the start list
 * with each athlete's opening height, then the bar going up: the jumps that
 * decide it at full length (the winning clearance, the medallists' last
 * heights, the failures that cost a medal, a jump-off), the rest short, a
 * slow-motion replay of the winning clearance from beside the standard,
 * and the standings by countback.
 */

interface Item { jump: HjJump; plan: HighJumpPlan; cut: "full" | "short"; replay: boolean; jumpOff: boolean; i: number }

export function highJumpShow(result: HighJumpResult, o: ShowOptions): Show {
  const athletes = result.cards.map((c) => c.athlete);
  const byKey = new Map(athletes.map((a) => [a.key, a]));
  const cardOf = new Map(result.cards.map((c) => [c.athlete.key, c]));
  const all: { jump: HjJump; jumpOff: boolean }[] = [...result.jumps.map((jump) => ({ jump, jumpOff: false })), ...result.jumpOff.map((jump) => ({ jump, jumpOff: true }))];
  const gold = result.order[0];
  const podium = result.order.filter((c) => c.best != null && c.place <= 3);
  const bronzeBest = Math.min(...podium.map((c) => c.best ?? 0));
  const firstOf = new Set<number>();
  const seen = new Set<string>();
  all.forEach((x, i) => { if (!seen.has(x.jump.key)) { seen.add(x.jump.key); firstOf.add(i); } });
  const winIdx = (() => {
    if (!gold || gold.best == null) return -1;
    for (let i = all.length - 1; i >= 0; i--) if (all[i].jump.key === gold.athlete.key && all[i].jump.cleared) return i;
    return -1;
  })();
  const scored = all.map((x, i) => {
    let s = 1;
    const c = cardOf.get(x.jump.key)!;
    if (i === winIdx) s += 10;
    if (x.jumpOff) s += 8;
    if (x.jump.cleared && c.best != null && Math.abs(x.jump.height - c.best) < 1e-6 && c.place <= 3) s += 6;
    if (!x.jump.cleared && x.jump.height >= bronzeBest - 1e-6) s += 4;
    if (firstOf.has(i)) s += 2;
    return { ...x, i, s };
  });
  // Budget: the winning clearance (full + replay), then by score, full while it lasts, then short.
  let left = Math.max(10, o.budget - (o.quick ? 4 : 11));
  const cut = new Map<number, "full" | "short">();
  if (winIdx >= 0) { cut.set(winIdx, "full"); left -= 6 + 5.5; }
  for (const x of [...scored].sort((p, q) => q.s - p.s || p.i - q.i)) {
    if (cut.has(x.i)) continue;
    if (x.s >= 6 && left >= 6) { cut.set(x.i, "full"); left -= 6; }
    else if (left >= 3.4) { cut.set(x.i, "short"); left -= 3.4; }
  }
  const items: Item[] = scored.filter((x) => cut.has(x.i)).map((x) => ({ jump: x.jump, plan: planHighJump(byKey.get(x.jump.key)!, x.jump), cut: cut.get(x.i)!, replay: x.i === winIdx, jumpOff: x.jumpOff, i: x.i }));
  const tl = new Timeline();
  const first = items[0];
  if (!o.quick) {
    tl.add({ kind: "establish", cam: "crane", act: 0, clock0: first.plan.start, rate: 0 }, o.video ? 2.6 : 4.2);
    tl.add({ kind: "startlist", cam: "startlist", act: 0, clock0: first.plan.start, rate: 0 }, o.video ? 2.2 : 3.4);
  }
  let lastH = -1;
  items.forEach((it, idx) => {
    if (Math.abs(it.jump.height - lastH) > 1e-6 && it.cut === "full") {
      lastH = it.jump.height;
      tl.add({ kind: "card", cam: "bar", act: idx, clock0: it.plan.start, rate: 0, title: it.jumpOff ? `Jump-off · ${it.jump.height.toFixed(2)} m` : `${it.jump.height.toFixed(2)} m`, sub: it.jumpOff ? "One attempt each" : "The bar goes up" }, 1.2);
    }
    lastH = it.jump.height;
    const p = it.plan;
    const t0 = it.cut === "full" ? Math.max(p.start + 0.5, -Math.min(2.4, p.tApp)) : -Math.min(0.85, p.tApp);
    const t1 = p.tLand + (it.cut === "full" ? 1.6 : 0.9);
    const act = tl.add({ kind: "action", cam: "jump", act: idx, clock0: t0, rate: 1, key: it.jump.key }, t1 - t0);
    const at = (x: number) => act.t0 + (x - t0);
    tl.cue(at(p.tPeak * 1.05), it.plan.contact === "clear" ? "whoosh" : "clank", it.plan.contact === "clear" ? 0.3 : 0.8);
    tl.cue(at(p.tLand), "thud", 0.5);
    tl.cue(at(p.tPeak * 1.05) + 0.25, it.jump.cleared ? "cheer" : "groan", it.jump.cleared ? 0.8 : 0.7);
    tl.add({ kind: "result", cam: "mat", act: idx, clock0: t1, rate: 0.7, key: it.jump.key }, it.cut === "full" ? 1.7 : 1.1);
    if (it.replay) tl.add({ kind: "replay", cam: "replay", act: idx, clock0: -0.35, rate: 0.3, key: it.jump.key }, (p.tLand + 0.8) / 0.3);
  });
  tl.add({ kind: "board", cam: "board", act: items.length - 1, clock0: items[items.length - 1].plan.end, rate: 0 }, o.video ? 2.4 : 4);
  const beats = tl.beats;
  const end = tl.t;

  /** Standings as they stood after jump i (chronological). */
  const standingAfter = (i: number) => {
    const best = new Map<string, number | null>(athletes.map((a) => [a.key, null]));
    for (let j = 0; j <= i && j < all.length; j++) if (all[j].jump.cleared && !all[j].jumpOff) best.set(all[j].jump.key, Math.max(best.get(all[j].jump.key) ?? 0, all[j].jump.height));
    return [...best.entries()].sort((a, b) => (b[1] ?? -1) - (a[1] ?? -1));
  };

  const camera = (beat: ReturnType<typeof beatAt>, k: number, it: Item, tau: number, s: ReturnType<typeof highJumpAt>, aspect: number, t: number): CamPose => {
    const d = it.plan.dims;
    const H = Math.max(0.6, d.h);
    const back = tall(aspect) ? 1.4 : 1;
    const barH = it.jump.height;
    const sideSpan = Math.max(5, 2.2 * H, barH * 1.6);
    // Side on to the bar, framing the bar and the whole jumper over it (a giant's body reaches well above the bar).
    const sideH = Math.max(barH + H * 1.3 + 0.6, 3.5);
    const side = (): CamPose => framed([HJ.barX + sideSpan * 0.25, Math.max(1.2, barH * 0.75), HJ.z + (sideSpan * 1.2 + 4) * back], [HJ.barX + 0.4 * it.plan.s, Math.max(barH * 0.72 + 0.3, sideH * 0.46), HJ.z], sideSpan * (tall(aspect) ? 0.8 : 1.3), sideH, aspect, 10, 58);
    switch (beat.cam) {
      case "crane":
        return crane([HJ.barX, 1.2, HJ.z], k, aspect, { from: [HJ.barX + 70, 60, 90], to: [HJ.barX + 18, 5 + barH, 18], fov0: 50, fov1: 38 });
      case "startlist":
        return drift(framed([HJ.barX + 12, 3 + barH, HJ.z + 12 * back], [HJ.barX, barH * 0.6, HJ.z], 10, 5 + barH, aspect, 10, 50), t);
      case "bar":
        return drift(framed([HJ.barX + 2.2, barH + 0.5, HJ.z + 4.5 * back], [HJ.barX, barH, HJ.z], 4.5, 2 + barH * 0.2, aspect, 8, 50), t, 0.02);
      case "jump": {
        // Tracking the approach from the infield, then the side camera for the jump.
        const c = s.com;
        const track = framed([c[0] + 5 + 2 * H, 1.2 + 0.8 * H, c[2] + (5 + 2 * H) * back], [c[0] - 1, c[1] * 0.8, c[2]], Math.max(3.5, 2.6 * H), H * 2.2, aspect, 8, 50);
        return mixPose(track, side(), smooth(-0.9, -0.15, tau));
      }
      case "replay": {
        // Low beside the near standard, looking up across the bar.
        const span = Math.max(4, 2 * H, barH * 1.3);
        return framed([HJ.barX + span * 0.5, Math.max(0.4, barH * 0.35), HJ.z + HJ.barLength / 2 + 1.2 + span * 0.35], [HJ.barX - 0.2, barH * 0.92, HJ.z - 0.4], span * 1.3, barH + H, aspect, 14, 62);
      }
      case "mat":
        return drift(framed([HJ.barX - 1.5, HJ.matH + 1.6 + H * 0.8, HJ.z + (6 + H * 1.4) * back], [HJ.barX - HJ.matD / 2, HJ.matH + H * 0.3, HJ.z], Math.max(6, H * 2.4), Math.max(3, barH + 0.6), aspect, 10, 55), t);
      default:
        return framed([HJ.barX + 14, 6 + barH, HJ.z + 16 * back], [HJ.barX, barH * 0.6, HJ.z], 14, 8 + barH, aspect, 10, 55);
    }
  };

  const at = (t: number, aspect: number): ShowFrame => {
    const beat = beatAt(beats, t);
    const k = beatK(beat, t);
    const it = items[beat.act ?? 0] ?? items[0];
    const tau = beatClock(beat, t);
    const s = highJumpAt(it.plan, tau, t);
    const rate = beat.rate || 1;
    const excitement = beat.kind === "action" ? 0.3 + 0.4 * smooth(-1.5, 0, tau) + (tau > 0 ? 0.25 * Math.exp(-Math.max(0, tau - it.plan.tPeak)) : 0) : beat.kind === "result" ? (it.jump.cleared ? 0.85 : 0.4) : 0.4;
    const bursts = s.landed != null ? [{ id: `hj${beat.act}-${beat.kind}`, t0: t - s.landed / rate, kind: "dust" as const, x: s.com[0], y: HJ.matH, z: s.com[2], size: it.plan.dims.w * 0.5, power: 0.3, rate }] : [];
    return {
      t,
      venue: "stadium",
      pose: camera(beat, k, it, tau, s, aspect, t),
      beat,
      k,
      actors: [{ key: it.jump.key, pose: s.pose }],
      props: { kind: "hj", bar: it.jump.height, ...s.bar, dent: s.dent },
      bursts,
      decals: [],
      excitement,
      replay: beat.kind === "replay" ? 1 : 0,
      dof: beat.kind === "replay" || beat.kind === "result" ? { focus: s.com, k: 0.55 } : undefined,
      fade: 0,
      flash: 0,
      clock: it.jump.height.toFixed(2),
      screen: beat.kind === "action" ? { pos: [HJ.barX + 6, 2.2, HJ.z + 7], target: [HJ.barX, it.jump.height * 0.7, HJ.z], fov: 34 } : null,
    };
  };

  const series = (c: HjCard) => {
    // "xo" style marks at the athlete's last two heights.
    const hs = [...new Set(c.jumps.map((j) => j.height))].slice(-2);
    return hs.map((h) => `${h.toFixed(2)} ${c.jumps.filter((j) => j.height === h).map((j) => (j.cleared ? "o" : "x")).join("")}`).join(" · ");
  };

  const overlay = (t: number): Overlay => {
    const beat = beatAt(beats, t);
    const k = beatK(beat, t);
    const it = items[beat.act ?? 0] ?? items[0];
    const a = byKey.get(it.jump.key)!;
    const bug = { title: "High jump", sub: beat.kind === "board" ? "Final standings" : `Bar ${it.jump.height.toFixed(2)} m` };
    switch (beat.kind) {
      case "establish":
        return { title: { text: "HIGH JUMP", sub: `${athletes.length} Pokémon · three failures and out`, k } };
      case "startlist":
        return { bug, board: { title: "Start list · opening height", rows: [...result.cards].sort((x, y) => x.opening - y.opening).map((c, i) => ({ place: String(i + 1), name: c.athlete.name, mark: `${c.opening.toFixed(2)} m`, key: c.athlete.key, note: `best ${formatMark("high-jump", highJumpMark(c.athlete))}`, plain: true })), k } };
      case "card":
        return { bug, title: { text: beat.title ?? "", sub: beat.sub ?? "", k } };
      case "action":
        return { bug, lower: { key: a.key, name: a.name, line: `Attack ${a.stats.atk} · ${fmtKg(a.kg)} · ${a.height.toFixed(1)} m tall`, tag: it.jumpOff ? "Jump-off" : `Attempt ${it.jump.n}`, k }, tags: [a.key], caption: captionFor(a) };
      case "result": {
        const st = standingAfter(it.i);
        return {
          bug,
          mark: it.jump.cleared ? { text: `${it.jump.height.toFixed(2)} m`, sub: it.jumpOff ? "Wins the jump-off" : it.jump.n === 1 ? "First time" : `At attempt ${it.jump.n}`, tone: "good", k } : { text: "✕", sub: it.plan.contact === "near" ? "Brushed it off" : "Knocked it down", tone: "bad", k },
          board: { title: "Standings", rows: st.slice(0, 8).map(([key, best], i) => ({ place: String(i + 1), name: byKey.get(key)!.name, mark: best == null ? "—" : `${best.toFixed(2)} m`, key, hi: key === a.key })), k },
        };
      }
      case "replay":
        return { replay: true, lower: { key: a.key, name: a.name, line: `Take-off ${it.plan.vv.toFixed(2)} m/s up · centre of mass peaks ${(it.plan.com + (it.plan.vv ** 2) / 19.62).toFixed(2)} m`, tag: "Replay", k } };
      default:
        return { bug, board: { title: "High jump · final", rows: [...result.order].sort((x, y) => x.place - y.place || countback(x, y)).map((c) => ({ place: c.best == null ? "—" : String(c.place), name: c.athlete.name, mark: c.best == null ? "NM" : `${c.best.toFixed(2)} m`, key: c.athlete.key, hi: c.place === 1, note: c.best == null ? undefined : series(c) })), k } };
    }
  };

  return {
    event: "high-jump",
    venue: "stadium",
    athletes,
    beats,
    cues: tl.cues,
    end,
    at,
    overlay,
    resultsAt: beats.find((b) => b.kind === "board")?.t0 ?? end,
    hook: "Which Pokémon jumps the highest? ⬆️",
    headline: gold?.best != null ? `${gold.athlete.name} wins with ${gold.best.toFixed(2)} m` : "No clearance",
  };
}

export type { Athlete };
