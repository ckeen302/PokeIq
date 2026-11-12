import type { Show } from "./types";

/**
 * A stretch of a show, [t0, t1] of its clock, as a show of its own (the
 * Games' summary video keeps each event's decisive moment). Everything
 * timed (beats, cues, bursts, decals, medals) is moved to the clip's clock.
 * Pure.
 */
export function clip(show: Show, t0: number, t1: number, o: { keepExtras?: boolean } = {}): Show {
  const a = Math.max(0, t0), b = Math.min(show.end, Math.max(a + 0.1, t1));
  const d = b - a;
  // Asked for, a clip from the very start keeps the show's own extras (a sprint's race plan and photo finish run on the same clock).
  return {
    ...(o.keepExtras && a === 0 ? show : {}),
    event: show.event,
    venue: show.venue,
    athletes: show.athletes,
    race: show.race,
    falseRace: show.falseRace,
    beats: show.beats.filter((x) => x.t1 > a && x.t0 < b).map((x) => ({ ...x, t0: Math.max(0, x.t0 - a), t1: Math.min(d, x.t1 - a) })),
    cues: show.cues.filter((c) => c.t >= a && c.t < b).map((c) => ({ ...c, t: c.t - a })),
    end: d,
    at(t, aspect) {
      const f = show.at(Math.min(b, a + Math.max(0, t)), aspect);
      const props = f.props.kind === "podium" ? { ...f.props, medals: f.props.medals.map((m) => ({ ...m, t0: m.t0 - a })) } : f.props;
      return { ...f, t, beat: { ...f.beat, t0: f.beat.t0 - a, t1: f.beat.t1 - a }, bursts: f.bursts.map((x) => ({ ...x, t0: x.t0 - a })), decals: f.decals.map((x) => ({ ...x, t0: x.t0 - a })), props };
    },
    overlay: (t) => show.overlay(Math.min(b, a + Math.max(0, t))),
    hook: show.hook,
    headline: show.headline,
    resultsAt: 0,
  };
}
