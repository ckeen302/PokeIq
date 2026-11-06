import type { Athlete } from "@/lib/games/athlete";
import { eventOf, type Venue } from "@/lib/games/events";
import { medalTable, type GamesResult, type MedalRow } from "@/lib/games/games";
import { POOL } from "@/lib/games/venues";
import { eventShow } from "./build";
import { crane } from "./cams";
import { sequence, type Sequence } from "./sequence";
import { NO_PROPS, type Overlay, type Show, type ShowFrame } from "./types";

/**
 * The Games as a broadcast: every event in order, each condensed (its
 * decisive moments and its medal ceremony), then the medal table as it
 * stands; the all-around closes the Games with the Champion of the Games.
 * Each event is its own part, loaded while the last one ends.
 */

export interface GamesShow {
  parts: Sequence[];
}

const AERIAL: Record<Venue, { target: [number, number, number]; from: [number, number, number]; to: [number, number, number] }> = {
  stadium: { target: [0, 2, 0], from: [-160, 90, 120], to: [-90, 46, 92] },
  arena: { target: [0, 1.5, 0], from: [26, 18, 26], to: [14, 9, 18] },
  pool: { target: [0, 0, 0], from: [-40, 22, 34], to: [-22, 12, 26] },
};

/** A results board over an aerial shot of a venue (the medal table between events). */
export function boardShow(event: Show["event"], venue: Venue, title: string, rows: NonNullable<Overlay["board"]>["rows"], dur = 4): Show {
  const a = AERIAL[venue];
  const beat = { kind: "board" as const, t0: 0, t1: dur, cam: "aerial" };
  return {
    event,
    venue,
    athletes: [],
    beats: [beat],
    cues: [{ t: 0.2, kind: "applause", gain: 0.4 }],
    end: dur,
    at: (t: number, aspect: number): ShowFrame => ({ t, venue, pose: crane(a.target, Math.min(1, t / dur), aspect, { from: a.from, to: a.to, fov0: 46, fov1: 40 }), beat, k: t / dur, actors: [], props: NO_PROPS, bursts: [], decals: [], excitement: 0.45, replay: 0, fade: 0, flash: 0, clock: "", screen: null }),
    overlay: (t: number): Overlay => ({ board: { title, rows, k: Math.min(1, t / 1.2) } }),
    resultsAt: 0,
    hook: "",
    headline: "",
  };
}

const tableRows = (t: MedalRow[]) => t.map((r) => ({ place: String(r.rank), name: r.nation.name, mark: `${r.gold} · ${r.silver} · ${r.bronze}`, key: r.nation.id, hi: r.rank === 1, note: "gold · silver · bronze" }));

export function gamesShow(g: GamesResult, byKey: ReadonlyMap<string, Athlete>, o: { budget: number; video?: boolean }): GamesShow {
  const parts: Sequence[] = [];
  g.outcomes.forEach((out, i) => {
    const ev = eventOf(out.event);
    const main = eventShow(out, byKey, { budget: o.budget, quick: true, video: o.video, nations: g.nations });
    const table = medalTable(g.nations, g.outcomes.slice(0, i + 1));
    const last = i === g.outcomes.length - 1;
    const tail = boardShow(out.event, ev.venue === "pool" ? "pool" : ev.venue, last ? "Final medal table" : `Medal table · after ${ev.lower}`, tableRows(table), last ? 6 : 3.6);
    const champ = last && g.champion ? byKey.get(g.champion) : null;
    parts.push(sequence([main.parts.length ? main : main, tail], { event: out.event, hook: main.hook, headline: champ ? `${champ.name} is the Champion of the Games` : main.headline }));
  });
  return { parts };
}

export const POOL_DECK = POOL.deck;
