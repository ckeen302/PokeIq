import { excitementAt, photoWindow, planShow, raceTimeAt, shotAt, shotProgress, type Phase } from "@/lib/race/broadcast";
import { cameraFor } from "@/lib/race/director";
import { formatTime, leaderAt, spotsAt } from "@/lib/race/race";
import { formatSeconds } from "@/lib/games/events";
import type { SprintEventResult } from "@/lib/games/sprint";
import { NO_PROPS, beatAt, beatK, type Beat, type Cue, type Overlay, type Show, type ShowFrame } from "./types";
import type { ShowOptions } from "./longjump";

/**
 * The 100 m, 200 m and 400 m: the Pokémon Race's broadcast (lib/race/
 * broadcast and director: the crane, the lane intros, "On your marks…
 * Set…", the gun, the rail, bend, head-on and line cameras, the
 * slow-motion replay, the photo finish, the results) on the Games' race,
 * where every runner waits its own reaction after the gun and dips at the
 * line. A false start plays first: the field goes, the recall gun fires, a
 * red card, and the restart without the runner who went early.
 */

export function sprintShow(result: SprintEventResult, o: ShowOptions): Show {
  const fin = result.final;
  const race = fin.race;
  const plan = planShow(race, { video: o.video, quick: o.quick || o.budget < 40 });
  const falseRace = fin.falseStart?.race ?? null;
  const pre = falseRace ? (o.video ? 3.4 : 4.6) : 0;
  const cues: Cue[] = [];
  const beats: Beat[] = [];
  if (falseRace) {
    beats.push({ kind: "action", t0: 0, t1: 1.0, cam: "marks", act: -1, title: "On your marks" });
    beats.push({ kind: "action", t0: 1.0, t1: 1.8, cam: "marks", act: -1, title: "Set" });
    beats.push({ kind: "action", t0: 1.8, t1: 2.45, cam: "marks", act: -1, clock0: 0, rate: 1 });
    beats.push({ kind: "card", t0: 2.45, t1: pre, cam: "marks", act: -2, title: "False start" });
    cues.push({ t: 1.8, kind: "gun", gain: 1 }, { t: 2.15, kind: "recall", gain: 1 }, { t: 2.5, kind: "groan", gain: 0.8 });
  }
  for (const s of plan.shots) beats.push({ kind: s.phase === "replay" ? "replay" : s.phase === "photo" ? "photo" : s.phase === "results" ? "board" : "action", t0: s.t0 + pre, t1: s.t1 + pre, cam: s.camera, clock0: s.race0, rate: s.rate, title: s.phase, ...(s.lane != null ? { act: s.lane } : {}) });
  const end = plan.end + pre;
  cues.push({ t: plan.gun + pre, kind: "gun", gain: 1 });
  const winner = fin.order[0];
  // The roar as the winner crosses (live).
  for (const s of plan.shots) {
    if ((s.phase === "race" || s.phase === "fast") && race.first >= s.race0 && race.first <= s.race0 + (s.t1 - s.t0) * s.rate) {
      cues.push({ t: pre + s.t0 + (race.first - s.race0) / Math.max(1e-6, s.rate), kind: "roar", gain: 1 });
      break;
    }
  }
  const photo = plan.shots.find((s) => s.phase === "photo");
  if (photo) cues.push({ t: pre + photo.t0 + 0.1, kind: "beep", gain: 1 });
  const starts = spotsAt(race, 0);
  const falseStarts = falseRace ? spotsAt(falseRace, 0) : starts;
  const runOf = new Map(fin.runs.map((r) => [r.athlete.key, r]));

  const at = (t: number, aspect: number): ShowFrame => {
    if (falseRace && t < pre) {
      const beat = beatAt(beats, t);
      const k = beatK(beat, t);
      const rt = beat.clock0 != null ? beat.clock0 + (t - beat.t0) : beat.act === -2 ? 0.65 : 0;
      const spots = spotsAt(falseRace, Math.max(0, rt));
      const pose = cameraFor("marks", k, spots, { distance: race.distance, aspect, starts: falseStarts });
      return { t, venue: "stadium", pose, beat, k, race: { t: rt, pre: rt > 0 ? "race" : beat.title === "Set" ? "set" : "marks", index: 1 }, actors: [], props: NO_PROPS, bursts: [], decals: [], excitement: beat.act === -2 ? 0.3 : 0.08, replay: 0, fade: 0, flash: 0, clock: rt > 0 ? formatTime(rt) : "0.00", screen: null };
    }
    const st = t - pre;
    const shot = shotAt(plan, Math.min(st, plan.end));
    const beat = beatAt(beats, t);
    const atEnd = st >= plan.end;
    const raceT = raceTimeAt(plan, Math.min(st, plan.end));
    const spots = spotsAt(race, raceT);
    const ctx = { distance: race.distance, aspect, lane: shot.lane, starts };
    const pose = cameraFor(atEnd ? "results" : shot.camera, atEnd ? Math.min(1, (st - plan.end) / 20) : shotProgress(shot, st), spots, ctx);
    const ph: Phase = shot.phase;
    const lead = leaderAt(race, raceT);
    return {
      t,
      venue: "stadium",
      pose,
      beat,
      k: beatK(beat, t),
      race: { t: raceT, pre: ph === "marks" ? "marks" : ph === "set" ? "set" : raceT > 0 ? "race" : "idle", focus: ph === "intro" ? shot.lane : undefined },
      actors: [],
      props: NO_PROPS,
      bursts: [],
      decals: [],
      excitement: excitementAt(plan, race, Math.min(st, plan.end - 0.01)),
      replay: ph === "replay" ? 1 : 0,
      fade: 0,
      flash: 0,
      clock: raceT <= 0 ? "0.00" : formatTime(Math.min(raceT, race.first), raceT < race.first ? (raceT < 10 ? 2 : 1) : 2),
      screen: raceT > 0 && raceT < race.last + 1.5 ? cameraFor("chase", 0.5, spots, { ...ctx, aspect: 16 / 9, lane: lead.lane }) : null,
    };
  };

  const overlay = (t: number): Overlay => {
    if (falseRace && t < pre) {
      const beat = beatAt(beats, t);
      if (beat.act === -2) {
        const cheat = runOf.get(fin.falseStart!.key)!;
        return { mark: { text: "FALSE START", sub: `${cheat.athlete.name} · reaction ${fin.falseStart!.reaction.toFixed(3)} s · disqualified`, tone: "bad", k: beatK(beat, t) } };
      }
      return {};
    }
    const resultsT0 = (plan.shots.find((x) => x.phase === "results")?.t0 ?? plan.end) + pre;
    if (t >= resultsT0) {
      return {
        board: {
          title: `${result.event === "100m" ? "100 m" : result.event === "200m" ? "200 m" : "400 m"} · results`,
          rows: fin.order.map((r) => ({ place: r.dq ? "DQ" : String(r.place), name: r.athlete.name, mark: r.dq ? "False start" : `${r.photoNeeded ? r.photo.toFixed(3) : formatSeconds(r.time)}`, key: r.athlete.key, hi: r.place === 1, note: r.dq ? undefined : `react ${r.reaction.toFixed(3)}` })),
          k: Math.min(1, (t - resultsT0) / 1.5),
        },
      };
    }
    return {};
  };

  return {
    event: result.event,
    venue: "stadium",
    athletes: [],
    beats,
    cues,
    end,
    race,
    falseRace,
    at,
    overlay,
    resultsAt: (plan.shots.find((s) => s.phase === "results")?.t0 ?? plan.end) + pre,
    hook: result.event === "100m" ? "Who's the fastest Pokémon? 100 m ⚡" : result.event === "200m" ? "Who wins the 200 m? 🏃" : "Which Pokémon runs the fastest lap? 🏁",
    headline: `${winner.athlete.name} wins in ${winner.photoNeeded ? winner.photo.toFixed(3) : formatSeconds(winner.time)} s`,
    // The Race's plan, for the page's sprint graphics.
    ...({ racePlan: plan, pre, photoFrame: photoWindow(race), falseRace } as object),
  };
}

export interface SprintExtras {
  racePlan: ReturnType<typeof planShow>;
  pre: number;
  photoFrame: ReturnType<typeof photoWindow>;
  falseRace: import("@/lib/race/race").Race | null;
}
