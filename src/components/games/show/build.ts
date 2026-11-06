import type { Athlete } from "@/lib/games/athlete";
import { eventOf, formatMark } from "@/lib/games/events";
import type { EventOutcome, Nation } from "@/lib/games/games";
import { highJumpShow } from "./highjump";
import { longJumpShow, type ShowOptions } from "./longjump";
import { podiumShow, type Medallist } from "./podium";
import { sequence, type Sequence } from "./sequence";
import { sprintShow } from "./sprint";
import { throwShow } from "./throws";
import type { Show } from "./types";

/**
 * An event's broadcast from its outcome (lib/games/games' runEvent): the
 * event's own show, then the medal ceremony.
 */

export function medallists(outcome: EventOutcome, byKey: ReadonlyMap<string, Athlete>, nations?: Nation[]): Medallist[] {
  const nationOf = (k: string) => nations?.find((n) => n.athletes.some((a) => a.key === k));
  const out: Medallist[] = [];
  const add = (keys: string[], medal: 1 | 2 | 3) => {
    for (const k of keys) {
      const a = byKey.get(k);
      if (!a) continue;
      const n = nationOf(k);
      const mark = outcome.event === "wrestling" ? (medal === 1 ? "Undefeated" : medal === 2 ? "Lost the final" : "Won the bronze bout") : formatMark(outcome.event, outcome.marks.get(k));
      out.push({ athlete: a, medal, mark, nation: n ? { name: n.name, color: n.color } : undefined });
    }
  };
  add(outcome.podium.gold, 1);
  add(outcome.podium.silver, 2);
  add(outcome.podium.bronze, 3);
  return out;
}

export function eventShowOnly(outcome: EventOutcome, o: ShowOptions): Show {
  const d = outcome.detail;
  switch (d.kind) {
    case "sprint":
      return sprintShow(d.result, o);
    case "jump-long":
      return longJumpShow(d.result, o);
    case "jump-high":
      return highJumpShow(d.result, o);
    case "throw":
      return throwShow(d.result, o);
    default:
      throw new Error(`no show for ${outcome.event} yet`);
  }
}

export function eventShow(outcome: EventOutcome, byKey: ReadonlyMap<string, Athlete>, o: ShowOptions & { nations?: Nation[]; podium?: boolean }): Sequence {
  const main = eventShowOnly(outcome, o);
  const parts: Show[] = [main];
  const meds = medallists(outcome, byKey, o.nations);
  if (o.podium !== false && meds.length) parts.push(podiumShow(outcome.event, eventOf(outcome.event).venue, meds, { video: o.video }));
  return sequence(parts, { event: outcome.event, hook: main.hook, headline: main.headline });
}
