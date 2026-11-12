import type { Athlete } from "@/lib/games/athlete";
import type { EventOutcome } from "@/lib/games/games";
import { eventShow } from "./build";
import { clip } from "./clip";
import { sequence, type Sequence } from "./sequence";
import type { SprintExtras } from "./sprint";
import type { Beat, Cue, Show } from "./types";

/**
 * A head to head cut for a short vertical video (TikTok, Reels, Shorts):
 * the opening shot under the hook card, the deciding stretch of the event
 * in real time (a long one cut to its start and its finish), the result,
 * then the slow-motion replay of the deciding moment. The result card is
 * the recorder's. Everything comes from the event's own broadcast (the
 * outcome is never touched), cut on its clock. Pure.
 */

/** The longest stretches kept (s). */
export const H2H_CUT = { intro: 2.6, action: 8, head: 2.6, result: 1.6, replay: 5.6 } as const;

/** The sounds a slow-motion replay repeats at its own pace: the landing, the clank, the splash, the impact. */
const REPLAYED = new Set<Cue["kind"]>(["thud", "stick", "sand", "clank", "splash", "impact", "whoosh"]);

/** The replay's own sound: each of the action's impact sounds, at the moment the replay reaches it (on the action's clock). */
export function replayCues(show: Show): Cue[] {
  const out: Cue[] = [];
  for (const r of show.beats) {
    if (r.kind !== "replay" || r.act == null || r.clock0 == null || !r.rate) continue;
    for (const a of show.beats) {
      if (a.kind !== "action" || a.act !== r.act || a.clock0 == null) continue;
      for (const c of show.cues) {
        if (!REPLAYED.has(c.kind) || c.t < a.t0 || c.t >= a.t1) continue;
        const clock = a.clock0 + (c.t - a.t0) * (a.rate ?? 1);
        const t = r.t0 + (clock - r.clock0) / r.rate;
        if (t >= r.t0 && t < r.t1) out.push({ t, kind: c.kind, gain: c.gain * 0.85 });
      }
    }
  }
  return out;
}

export function h2hClipShow(source: Show): Show[] {
  const extra = (source as Show & Partial<SprintExtras>).racePlan ? [] : replayCues(source);
  const main: Show = extra.length ? { ...source, cues: [...source.cues, ...extra].sort((x, y) => x.t - y.t) } : source;
  const beats = main.beats;
  const first = (k: Beat["kind"][]) => beats.find((b) => k.includes(b.kind));
  // A sprint keeps its own race graphics (lanes, clock, photo finish), so it's cut from the start: the start, the race and the replay.
  if ((main as Show & Partial<SprintExtras>).racePlan) {
    const replay = [...beats].reverse().find((b) => b.kind === "replay");
    return [clip(main, 0, replay ? replay.t1 : main.resultsAt, { keepExtras: true })];
  }
  // The all-around has no action of its own: its points board, event by event, to the champion.
  if (!first(["action"])) {
    const champ = [...beats].reverse().find((b) => b.kind === "result");
    return [clip(main, 0, champ ? champ.t1 : main.end)];
  }
  const out: Show[] = [];
  // 1. The opening: the establishing shot and the event's title card (the start list is the end card's job).
  const action0 = first(["action", "intro"])?.t0 ?? 0;
  const opening = beats.filter((b) => b.t1 <= action0 + 1e-6 && b.kind !== "startlist");
  if (opening.length) {
    let left: number = H2H_CUT.intro;
    for (const b of opening) {
      const d = Math.min(left, b.t1 - b.t0);
      if (d < 0.4) break;
      out.push(clip(main, b.t0, b.t0 + d));
      left -= d;
    }
  }
  // 2. The deciding stretch, live: the action up to the last result before the replay.
  const replay = beats.find((b) => b.kind === "replay");
  const acts = beats.filter((b) => (b.kind === "action" || b.kind === "intro") && (!replay || b.t1 <= replay.t0 + 1e-6));
  if (acts.length) {
    const a0 = acts[0].kind === "intro" && acts.length > 1 ? acts[1].t0 : acts[0].t0;
    const a1 = acts[acts.length - 1].t1;
    if (a1 - a0 <= H2H_CUT.action) out.push(clip(main, a0, a1));
    else {
      // Too long for the clip: its start, then a cut to its finish.
      out.push(clip(main, a0, a0 + H2H_CUT.head));
      out.push(clip(main, a1 - (H2H_CUT.action - H2H_CUT.head), a1));
    }
  }
  // 3. The result as it's called (the mark, the lights, the ring-out).
  const result = beats.find((b) => b.kind === "result" && (!replay || b.t0 < replay.t0));
  if (result) out.push(clip(main, result.t0, Math.min(result.t1, result.t0 + H2H_CUT.result)));
  // 4. The slow-motion replay of the deciding moment (a long one keeps its end: the touch, the landing, the hold).
  if (replay) {
    const d = replay.t1 - replay.t0;
    const keep = Math.min(d, H2H_CUT.replay);
    const from = main.venue === "pool" ? replay.t1 - keep : replay.t0 + (d - keep) * 0.5;
    out.push(clip(main, from, from + keep));
  }
  return out;
}

/** The head to head's clip: one sequence on one clock, ready for the recorder. */
export function h2hClip(outcome: EventOutcome, byKey: ReadonlyMap<string, Athlete>): Sequence {
  const main = eventShow(outcome, byKey, { budget: 16, video: true, quick: false, podium: false }).parts[0].show;
  return sequence(h2hClipShow(main), { event: outcome.event, hook: main.hook, headline: main.headline });
}
