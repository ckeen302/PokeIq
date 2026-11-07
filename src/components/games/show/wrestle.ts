import type { Athlete } from "@/lib/games/athlete";
import { braceForce, pushForce, type Bracket, type BracketBout } from "@/lib/games/wrestle";
import { RITUALS, boutPose, planBout, type WrestlePlan } from "../scene/motions/wrestle";
import { smooth } from "../scene/motions/common";
import { crane, drift, framed, mixPose, tall, type CamPose } from "./cams";
import type { ShowOptions } from "./longjump";
import { Timeline, beatAt, beatClock, beatK, type Burst, type Decal, type Overlay, type Show, type ShowFrame } from "./types";

/**
 * Wrestling as a broadcast: the crane down onto the dohyō, the draw, then
 * the bracket round by round: the early bouts from their decisive moments,
 * the semi-finals longer, the final in full from the ritual (stamps, salt,
 * the crouch) through the charge to the ring-out, with a slow-motion
 * replay; the clay scuffed where feet slid; the final standings. Pure.
 */

interface Item {
  bout: BracketBout & { trace: NonNullable<BracketBout["trace"]> };
  plan: WrestlePlan;
  cut: "full" | "medium" | "short" | "skip";
  replay: boolean;
  scuffs: Decal[];
}

const kN = (n: number) => `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} kN`;
const secs = (t: number) => `${t.toFixed(1)} s`;

export function wrestleShow(result: Bracket, o: ShowOptions): Show {
  const athletes: Athlete[] = result.order;
  const bouts: BracketBout[] = [...result.rounds.flatMap((r) => (r.name === "Final" ? [] : r.bouts)), ...(result.bronze ? [result.bronze] : []), ...result.rounds[result.rounds.length - 1].bouts];
  const items: Item[] = bouts
    .filter((b): b is Item["bout"] => !!b.trace)
    .map((b) => ({ bout: b, plan: planBout(b.trace), cut: "short" as Item["cut"], replay: false, scuffs: [] }));
  // Cuts within the budget: the final in full with its replay, the semi-finals medium, the rest short (or left to the board).
  const lenOf = (it: Item, cut: Item["cut"]) => {
    const e = it.bout.trace.end;
    if (cut === "skip") return 0;
    if (cut === "short") return Math.min(e, 2.6) + 1.2 + 1.2;
    if (cut === "medium") return 1.5 + Math.min(e, 6) + 1.5 + 1.4;
    return 4.5 + Math.min(e, 9) + 2.5 + 1.8;
  };
  const final = items[items.length - 1];
  for (const it of items) it.cut = it === final ? "full" : it.bout.round === "Semi-finals" ? "medium" : "short";
  final.replay = true;
  const budget = Math.max(12, o.budget - (o.quick ? 4 : 12)) - 6;
  const total = () => items.reduce((s, it) => s + lenOf(it, it.cut), 0) + new Set(items.map((x) => x.bout.round)).size * 1.3;
  for (const it of items) if (total() > budget && it.cut === "short" && it.bout.round !== "Bronze") it.cut = "skip";
  for (const it of items) if (total() > budget && it.cut === "medium") it.cut = "short";
  if (total() > budget && result.bronze) { const b = items.find((x) => x.bout.round === "Bronze"); if (b) b.cut = "skip"; }
  // Scuffs where feet slid back on the clay.
  for (const it of items) {
    const tr = it.bout.trace;
    let last = 0, foot = 0;
    const n = Math.min(tr.s.length - 1, Math.floor(tr.end / tr.step));
    for (let i = 1; i <= n; i++) {
      if (Math.abs(tr.s[i] - last) < 0.22 * it.plan.scale) continue;
      const back = tr.s[i] > last ? 1 : -1;
      last = tr.s[i];
      const x = tr.s[i] + (back > 0 ? tr.db : -tr.da);
      foot++;
      it.scuffs.push({ id: `sc${foot}`, t0: i * tr.step, kind: "scuff", x, y: it.plan.top + 0.006, z: (foot % 2 ? 0.22 : -0.22) * Math.min(3, it.plan.scale), w: 0.32 * Math.min(3, it.plan.scale), l: 0.5 * Math.min(3, it.plan.scale), angle: 0 });
    }
  }

  const tl = new Timeline();
  const shown = items.filter((x) => x.cut !== "skip");
  const first = shown[0] ?? final;
  const fi = items.indexOf(first);
  if (!o.quick) {
    tl.add({ kind: "establish", cam: "crane", act: fi, clock0: -6.5, rate: 0 }, o.video ? 2.6 : 4.2);
    tl.add({ kind: "startlist", cam: "startlist", act: fi, clock0: -6.5, rate: 0 }, o.video ? 2.2 : 3.6);
  }
  let round = "";
  items.forEach((it, idx) => {
    if (it.cut === "skip") return;
    const tr = it.bout.trace;
    const e = tr.end;
    if (it.bout.round !== round) {
      round = it.bout.round;
      tl.add({ kind: "card", cam: "dohyo", act: idx, clock0: -2, rate: 0.2, title: round === "Bronze" ? "Bronze bout" : round, sub: round === "Final" ? "For the gold" : "" }, 1.3);
    }
    const segs: [number, number][] = [];
    if (it.cut === "full") {
      if (e <= 9) segs.push([-4.5, e + 2.5]);
      else segs.push([-4.5, 3], [e - 6, e + 2.5]);
    } else if (it.cut === "medium") {
      if (e <= 6) segs.push([-1.5, e + 1.5]);
      else segs.push([-1.5, 2.2], [e - 3.8, e + 1.5]);
    } else segs.push([Math.max(-0.4, e - 2.6), e + 1.2]);
    segs.forEach(([a, b], j) => {
      const act = tl.add({ kind: "action", cam: "bout", act: idx, clock0: a, rate: 1, key: it.bout.a.key, sub: j > 0 ? "later" : undefined }, b - a);
      const at = (tau: number) => act.t0 + (tau - a);
      if (a < 0 && b > 0) tl.cue(at(0.28), "impact", Math.min(1, 0.5 + (it.bout.a.kg + it.bout.b!.kg) / 1500));
      for (const r of RITUALS) if (r.t > a && r.t < b && r.kind === "stamp") tl.cue(at(r.t), "stomp", 0.6);
      if (e > a && e < b) {
        if (tr.ringOut) { tl.cue(at(e + 0.75), "thud", 0.6); tl.cue(at(e + 0.1), "roar", 1); }
        else tl.cue(at(e), "buzzer", 0.7);
        tl.cue(at(e + 0.3), "cheer", it.cut === "full" ? 1 : 0.7);
      }
    });
    tl.add({ kind: "result", cam: "result", act: idx, clock0: e + 1.2, rate: 0.5, key: it.bout.winner.key }, it.cut === "short" ? 1.2 : 1.6);
    if (it.replay && tr.ringOut) tl.add({ kind: "replay", cam: "replay", act: idx, clock0: Math.max(-0.2, e - 1.6), rate: 0.33, key: it.bout.winner.key }, Math.min(8, (Math.min(e, 1.6) + 1.2) / 0.33));
  });
  tl.add({ kind: "board", cam: "board", act: items.length - 1, clock0: final.plan.end, rate: 0 }, o.video ? 2.6 : 4.2);
  const beats = tl.beats;
  const end = tl.t;

  const camera = (beat: ReturnType<typeof beatAt>, k: number, it: Item, tau: number, aspect: number, t: number): CamPose => {
    const pl = it.plan;
    const H = Math.max(pl.da.h, pl.db.h, 0.6);
    const R = pl.ring;
    const back = tall(aspect) ? 1.4 : 1;
    const top = pl.top;
    const s = boutPose(pl, tau, t);
    const span = Math.max(4.2, (it.bout.trace.da + it.bout.trace.db) * 2.4 + 1.2, H * 2.2);
    // Side-on, following the contact point, widening as the ring's edge comes into play.
    const edgeK = Math.min(1, Math.abs(s.contact[0]) / Math.max(0.5, R * 0.8));
    const side = (): CamPose => {
      const w = span * (1 + 0.5 * edgeK);
      const cx = s.contact[0] * 0.85;
      return framed([cx + 0.6, top + 0.8 + 0.42 * H, (2.4 + w * 1.05) * back], [cx, top + 0.5 * H, 0], w, 1.6 * H + 0.8, aspect, 10, 55);
    };
    switch (beat.cam) {
      case "crane":
        return crane([0, top, 0], k, aspect, { from: [24, 20, 30], to: [R * 1.4 + 3, top + 2.5 + H * 0.5, R * 2.2 + 5], fov0: 52, fov1: 36 });
      case "startlist":
        return drift(framed([R * 1.2 + 4, top + 3, (R * 2 + 8) * back], [0, top + 0.5, 0], R * 2.6 + 3, R + 3, aspect, 10, 55), t);
      case "dohyo":
        return drift(framed([R * 0.6, top + 1.2 + 0.5 * H, (R * 2.4 + 3) * back], [0, top + 0.4 * H, 0], R * 3, Math.max(2.5, 1.5 * H), aspect, 10, 55), t, 0.02);
      case "bout": {
        // The ritual wide, then side-on for the charge and the push.
        const wide = framed([R * 0.4, top + 1.4 + 0.5 * H, (R * 2.2 + 3 + H) * back], [0, top + 0.45 * H, 0], R * 2.9 + 2, 1.7 * H + 1, aspect, 10, 55);
        let pose = mixPose(wide, side(), smooth(-1.8, -0.6, tau));
        // The ring-out: pull back to see it go off the edge.
        if (s.out != null) pose = mixPose(pose, framed([s.contact[0] * 0.6, top + 1 + 0.5 * H, (R * 2 + 4 + H) * back], [s.contact[0] * 0.8, top + 0.3 * H, 0], R * 2.8 + 2, 1.8 * H + 1.2, aspect, 10, 55), smooth(0, 0.6, s.out));
        return drift(pose, t, 0.012);
      }
      case "result":
        return drift(side(), t, 0.02);
      case "replay": {
        // Low at the edge the loser went out over.
        const sgn = it.bout.trace.winner === "a" ? 1 : -1;
        return framed([sgn * (R * 1.35 + 0.8), top + 0.25, (R * 0.9 + 1.4 + 0.4 * H) * back], [s.contact[0], top + 0.45 * H, 0], Math.max(3.5, span * 0.9), 1.5 * H + 0.5, aspect, 12, 60);
      }
      default:
        return drift(framed([0, top + 4 + H * 0.5, (R * 2.4 + 9) * back], [0, top + 0.5, 0], R * 3 + 5, 5 + H, aspect, 10, 55), t);
    }
  };

  const at = (t: number, aspect: number): ShowFrame => {
    const beat = beatAt(beats, t);
    const k = beatK(beat, t);
    const it = items[beat.act ?? 0] ?? final;
    const tau = beatClock(beat, t);
    const s = boutPose(it.plan, tau, t);
    const rate = beat.rate || 1;
    const born = (tt: number) => t - (tau - tt) / rate;
    const bursts: Burst[] = [];
    const decals: Decal[] = [];
    const pl = it.plan;
    if (beat.kind === "action" || beat.kind === "replay" || beat.kind === "result") {
      for (const r of s.rituals) {
        if (tau < r.t || tau - r.t > 3) continue;
        const p = r.who === "a" ? s.a : s.b;
        const d = r.who === "a" ? pl.da : pl.db;
        bursts.push(r.kind === "stamp"
          ? { id: `w${beat.act}-${beat.kind}-${r.t}`, t0: born(r.t), kind: "clay", x: p.x, y: pl.top, z: 0, size: Math.max(0.4, d.w * 0.4), power: 0.6, rate }
          : { id: `w${beat.act}-${beat.kind}-${r.t}`, t0: born(r.t), kind: "chalk", x: p.x + (r.who === "a" ? 1 : -1) * d.w * 0.4, y: pl.top + d.h * 0.8, z: 0.2, size: Math.max(0.8, d.w * 0.6), power: 0.8, rate });
      }
      if (tau >= 0.28) bursts.push({ id: `w${beat.act}-${beat.kind}-clash`, t0: born(0.28), kind: "dust", x: s.contact[0], y: pl.top + 0.1, z: 0, size: Math.max(0.6, (pl.da.w + pl.db.w) * 0.25), power: 0.7, rate });
      if (s.out != null) {
        const loser = it.bout.trace.winner === "a" ? s.b : s.a;
        if (s.out > 0.8) bursts.push({ id: `w${beat.act}-${beat.kind}-fall`, t0: born(it.bout.trace.end + 0.8), kind: "clay", x: loser.x, y: 0.02, z: 0, size: 1, power: 0.9, rate });
      }
      for (const d of it.scuffs) if (tau >= d.t0) decals.push({ ...d, id: `w${beat.act}-${d.id}`, t0: born(d.t0) });
    }
    const excitement = beat.kind === "action" ? 0.35 + 0.35 * smooth(-1, 0.5, tau) + 0.25 * Math.min(1, Math.abs(s.contact[0]) / Math.max(0.5, pl.ring)) + (s.out != null ? 0.3 : 0) : beat.kind === "result" ? 0.85 : 0.35;
    return {
      t,
      venue: "arena",
      pose: camera(beat, k, it, tau, aspect, t),
      beat,
      k,
      actors: [{ key: it.bout.a.key, pose: s.a }, { key: it.bout.b!.key, pose: s.b }],
      props: { kind: "wrestle", ring: pl.ring },
      bursts,
      decals,
      excitement,
      replay: beat.kind === "replay" ? 1 : 0,
      dof: beat.kind === "replay" ? { focus: s.contact, k: 0.5 } : undefined,
      fade: beat.kind === "action" && beat.sub === "later" ? Math.max(0, 1 - (t - beat.t0) / 0.35) : 0,
      flash: 0,
      clock: "",
      screen: null,
    };
  };

  const overlay = (t: number): Overlay => {
    const beat = beatAt(beats, t);
    const k = beatK(beat, t);
    const it = items[beat.act ?? 0] ?? final;
    const { a, b } = it.bout;
    const bb = b!;
    const tr = it.bout.trace;
    const tau = beatClock(beat, t);
    const bug = { title: "Wrestling", sub: beat.kind === "board" ? "Final standings" : it.bout.round === "Bronze" ? "Bronze bout" : it.bout.round };
    switch (beat.kind) {
      case "establish":
        return { title: { text: "WRESTLING", sub: `Push-out · ${athletes.length} wrestlers · knockout`, k } };
      case "startlist": {
        const first = result.rounds[0];
        return { bug, board: { title: `The draw · ${first.name.toLowerCase()}`, rows: first.bouts.map((x, i) => ({ place: String(i + 1), name: x.b ? `${x.a.name} v ${x.b.name}` : `${x.a.name} (bye)`, mark: "", key: x.a.key, plain: true })), k } };
      }
      case "card": {
        // The round's title; from the second round on, the last round's results under the round's name instead.
        const prev = result.rounds.find((r) => r.bouts.some((x) => x.loser && items.indexOf(items.find((y) => y.bout === x)!) < items.indexOf(it)) && r.name !== it.bout.round && r.name !== "Final");
        const done = prev ? prev.bouts.filter((x) => x.b && x.trace) : [];
        if (!done.length) return { bug, title: { text: beat.title ?? "", sub: beat.sub ?? "", k } };
        return { bug, board: { title: `${beat.title} · after the ${prev!.name.toLowerCase()}`, rows: done.map((x, i) => ({ place: String(i + 1), name: `${x.winner.name} beat ${x.loser!.name}`, mark: x.trace!.ringOut ? `out in ${secs(x.trace!.end)}` : "on the bell", key: x.winner.key, plain: true })), k } };
      }
      case "action":
        return {
          bug: { title: "Wrestling", sub: tau > 0 ? `${it.bout.round === "Bronze" ? "Bronze" : it.bout.round} · ${Math.min(tau, tr.end).toFixed(1)} s` : bug.sub },
          lower: tau < Math.min(tr.end, 1.5) ? { key: a.key, name: `${a.name} v ${bb.name}`, line: `Push ${kN(pushForce(a))} · brace ${kN(braceForce(a))}  |  push ${kN(pushForce(bb))} · brace ${kN(braceForce(bb))}`, tag: it.bout.round === "Bronze" ? "Bronze" : it.bout.round.replace("-finals", "-final"), k } : undefined,
          tags: [a.key, bb.key],
          // (k runs over the rest of the shot: in with a pop, held, out as it ends.)
          mark: tau >= tr.end ? { text: tr.ringOut ? "OUT!" : "TIME", sub: `${it.bout.winner.name} wins`, tone: "lead", k: Math.min(1, (tau - tr.end) / (it.cut === "full" ? 2.5 : it.cut === "medium" ? 1.5 : 1.2)) } : undefined,
          caption: beat.sub === "later" && tau < tr.end - 2 ? `${Math.floor(tau)} s in` : undefined,
        };
      case "result":
        return { bug, mark: { text: `${it.bout.winner.name.toUpperCase()} WINS`, sub: tr.ringOut ? `Ring-out in ${secs(tr.end)}` : "Pushed further back at the bell", tone: "good", k } };
      case "replay":
        return { replay: true, lower: { key: it.bout.winner.key, name: it.bout.winner.name, line: `${(it.bout.winner.kg).toLocaleString("en")} kg v ${(it.bout.loser!.kg).toLocaleString("en")} kg · out in ${secs(tr.end)}`, tag: "Replay", k } };
      default:
        return { bug, board: { title: "Wrestling · final", rows: result.order.map((x, i) => ({ place: String(i + 1), name: x.name, mark: i === 0 ? "Gold" : i === 1 ? "Silver" : x === result.bronzeMedal ? "Bronze" : "", key: x.key, hi: i === 0 })), k } };
    }
  };

  return {
    event: "wrestling",
    venue: "arena",
    athletes,
    beats,
    cues: tl.cues,
    end,
    at,
    overlay,
    resultsAt: beats.find((b) => b.kind === "board")?.t0 ?? end,
    hook: "Which Pokémon pushes everyone out of the ring? 💥",
    headline: `${result.gold.name} wins the wrestling`,
  };
}

