import type { Athlete } from "@/lib/games/athlete";
import { MARK_EVENTS, eventOf } from "@/lib/games/events";
import type { AllAroundResult } from "@/lib/games/games";
import { bump, dims, idleActor, smooth } from "../scene/motions/common";
import type { ActorPose } from "../scene/pose";
import { crane, drift, framed, mixPose, tall, type CamPose, type Vec3 } from "./cams";
import type { ShowOptions } from "./longjump";
import { Timeline, beatAt, beatK, type Burst, type Overlay, type Show, type ShowFrame } from "./types";

/**
 * The all-around as a broadcast: every athlete lined up on the infield in
 * front of the main stand, the points of each event added up on the board
 * one event at a time (World Athletics' combined-events tables: the
 * reference's elite marks score about 1,000 each), the camera moving down
 * the line to whoever scored most, the lead changing hands, and then the
 * Champion of the Games in the spotlight with the confetti. Pure.
 */

const LINE_Z = 14;

export function allAroundShow(result: AllAroundResult, athletes: Athlete[], o: ShowOptions & { champion?: boolean }): Show {
  const byKey = new Map(athletes.map((a) => [a.key, a]));
  const rows = result.rows.filter((r) => byKey.has(r.key));
  // The line-up, left to right in the final order's reverse (the winner ends up in the middle of the shot at the end).
  const lineup = [...rows].sort((a, b) => a.key.localeCompare(b.key));
  const ds = new Map(lineup.map((r) => [r.key, dims(byKey.get(r.key)!)]));
  const gap = 0.8;
  const widths = lineup.map((r) => Math.max(0.6, ds.get(r.key)!.w));
  const total = widths.reduce((s, w) => s + w, 0) + gap * (lineup.length - 1);
  const xs = new Map<string, number>();
  let x = -total / 2;
  lineup.forEach((r, i) => { xs.set(r.key, x + widths[i] / 2); x += widths[i] + gap; });
  const tallest = Math.max(1, ...lineup.map((r) => ds.get(r.key)!.h));
  const events = MARK_EVENTS.filter((id) => rows.some((r) => (r.points[id] ?? 0) > 0));
  const tl = new Timeline();
  if (!o.quick) tl.add({ kind: "establish", cam: "crane" }, o.lineup ? (o.video ? 2.6 : 4) : o.video ? 1.3 : 1.8);
  const per = Math.max(1.1, Math.min(2.4, (Math.max(12, o.budget - 12)) / Math.max(1, events.length)));
  events.forEach((id, i) => {
    const b = tl.add({ kind: "board", cam: "line", act: i, title: eventOf(id).name }, per);
    tl.cue(b.t0 + 0.15, "beep", 0.4);
  });
  const champ = rows[0];
  const cb = tl.add({ kind: "result", cam: "champion", key: champ?.key, title: o.champion ? "Champion of the Games" : "All-around champion" }, o.video ? 3 : 4.2);
  tl.cue(cb.t0 + 0.3, "cheer", 1);
  tl.cue(cb.t0 + 0.2, "fanfare", 0.8);
  tl.add({ kind: "board", cam: "final", act: events.length }, o.video ? 2.4 : 3.6);
  const beats = tl.beats;
  const end = tl.t;

  /** Totals after the first `n` events. */
  const after = (n: number) => rows.map((r) => ({ key: r.key, total: events.slice(0, n).reduce((s, id) => s + (r.points[id] ?? 0), 0), last: n > 0 ? r.points[events[n - 1]] ?? 0 : 0 })).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));

  const camera = (beat: ReturnType<typeof beatAt>, k: number, t: number, aspect: number): CamPose => {
    const back = tall(aspect) ? 1.5 : 1;
    const wideShot = framed([0, 2 + tallest * 0.6, LINE_Z + (8 + total * 0.6) * back], [0, tallest * 0.45, LINE_Z], total + 2, tallest * 1.5, aspect, 10, 60);
    switch (beat.cam) {
      case "crane":
        return crane([0, 1, LINE_Z], k, aspect, { from: [30, 34, 80], to: [0, 3 + tallest * 0.5, LINE_Z + 10 + total * 0.5], fov0: 50, fov1: 40 });
      case "line": {
        // Down the line to the event's top scorer.
        const n = (beat.act ?? 0) + 1;
        const top = after(n).slice().sort((a, b) => b.last - a.last)[0];
        const d = ds.get(top.key)!;
        const fx = xs.get(top.key)!;
        const close = framed([fx + 1 + d.h * 0.3, 0.8 + d.h * 0.5, LINE_Z + (3 + d.h * 1.6) * back], [fx, d.h * 0.5, LINE_Z], Math.max(3, d.w * 2.2), d.h * 1.5, aspect, 10, 55);
        return drift(mixPose(wideShot, close, smooth(0.05, 0.6, k) * 0.75), t, 0.02);
      }
      case "champion": {
        const key = champ?.key;
        const d = key ? ds.get(key)! : { w: 1, h: 1 };
        const fx = key ? xs.get(key)! : 0;
        const close = framed([fx + 0.6, 0.6 + d.h * 0.45, LINE_Z + (2.6 + d.h * 1.4) * back], [fx, d.h * 0.55, LINE_Z], Math.max(2.6, d.w * 1.9), d.h * 1.35, aspect, 10, 55);
        return drift(mixPose(wideShot, close, smooth(0, 0.5, k)), t, 0.015);
      }
      default:
        return drift(wideShot, t, 0.02);
    }
  };

  const at = (t: number, aspect: number): ShowFrame => {
    const beat = beatAt(beats, t);
    const k = beatK(beat, t);
    const n = beat.cam === "line" ? (beat.act ?? 0) + 1 : beat.cam === "crane" ? 0 : events.length;
    const st = after(n);
    const leader = st[0]?.key;
    const topNow = beat.cam === "line" ? st.slice().sort((a, b) => b.last - a.last)[0]?.key : null;
    const actors = lineup.map((r, i) => {
      const a = byKey.get(r.key)!;
      const d = ds.get(r.key)!;
      const p: ActorPose = idleActor(a, d, xs.get(r.key)!, LINE_Z, 0, 1, t, i);
      // The event's top scorer hops; the leader waves; the champion's arms go up.
      if (r.key === topNow) p.y = 0.12 * d.h * bump(0.1, 0.45, k);
      if (beat.cam === "champion" && r.key === champ?.key) { p.raise = smooth(0.1, 0.4, k); p.y = 0.1 * d.h * Math.max(0, Math.sin(t * 6)) * smooth(0.1, 0.3, k); }
      else if (r.key === leader && beat.cam === "line") p.raise = 0.35 * bump(0.2, 0.9, k);
      return { key: r.key, pose: p };
    });
    const bursts: Burst[] = [];
    if (beat.cam === "champion" && champ) {
      const d = ds.get(champ.key)!;
      const p: Vec3 = [xs.get(champ.key)!, d.h * 1.2 + 1, LINE_Z];
      bursts.push({ id: `aa-confetti`, t0: beat.t0 + 0.25, kind: "confetti", x: p[0], y: p[1], z: p[2], size: Math.max(3, d.w * 2), power: 1 });
    }
    return {
      t,
      venue: "stadium",
      pose: camera(beat, k, t, aspect),
      beat,
      k,
      actors,
      props: { kind: "none" },
      bursts,
      decals: [],
      excitement: beat.cam === "champion" ? 1 : 0.4 + 0.3 * (n / Math.max(1, events.length)),
      replay: 0,
      fade: 0,
      flash: beat.cam === "champion" ? 0.5 * bump(0, 0.12, k) : 0,
      clock: "",
      screen: null,
    };
  };

  const overlay = (t: number): Overlay => {
    const beat = beatAt(beats, t);
    const k = beatK(beat, t);
    const name = (key: string) => byKey.get(key)?.name ?? key;
    const bug = { title: "All-around", sub: beat.cam === "line" ? `After ${eventOf(events[beat.act ?? 0]).name.toLowerCase()}` : "Points" };
    switch (beat.cam) {
      case "crane":
        return { title: { text: "ALL-AROUND", sub: `${rows.length} Pokémon · ${events.length} events · World Athletics points`, k } };
      case "line": {
        const n = (beat.act ?? 0) + 1;
        const st = after(n);
        const top = st.slice().sort((a, b) => b.last - a.last)[0];
        return {
          bug,
          board: { title: `Points after ${eventOf(events[n - 1]).name}`, rows: st.map((r, i) => ({ place: String(i + 1), name: name(r.key), mark: r.total.toLocaleString("en"), key: r.key, hi: r.key === top.key, note: `+${r.last.toLocaleString("en")}` })), k: Math.min(1, k * 4) },
          tags: top ? [top.key] : [],
        };
      }
      case "champion":
        return { mark: { text: champ ? name(champ.key).toUpperCase() : "", sub: `${beat.title} · ${champ?.total.toLocaleString("en")} points`, tone: "lead", k }, tags: champ ? [champ.key] : [] };
      default:
        return { bug: { title: "All-around", sub: "Final" }, board: { title: "All-around · final", rows: rows.map((r) => ({ place: String(r.place), name: name(r.key), mark: `${r.total.toLocaleString("en")} pts`, key: r.key, hi: r.place === 1 })), k } };
    }
  };

  return {
    event: "all-around",
    venue: "stadium",
    athletes: lineup.map((r) => byKey.get(r.key)!),
    beats,
    cues: tl.cues,
    end,
    at,
    overlay,
    resultsAt: beats.find((b) => b.cam === "final")?.t0 ?? end,
    hook: "Who's the best all-round Pokémon? 🏆",
    headline: champ ? `${byKey.get(champ.key)?.name} wins the all-around with ${champ.total.toLocaleString("en")} points` : "The all-around",
  };
}
