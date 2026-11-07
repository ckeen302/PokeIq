import type { LucideIcon } from "lucide-react";
import { CalendarDays, Compass, Grid3x3, LayoutGrid, Search } from "lucide-react";
import { currentStreak, geoDailyStreak, type Progress } from "@/lib/progress";
import { dleStats } from "@/lib/dle-stats";
import { connStats } from "@/lib/connections/local";

/**
 * The home page's Today section: the five dailies, each with how today's went
 * on this device (read from the stored progress, nothing else), and the
 * longest daily streak still alive. Pure, so it's tested on its own
 * (tests/home-today.test.ts).
 */

export type DailyId = "daily" | "pokedle" | "guessr" | "connections" | "pikadoku";

export interface DailyInfo {
  id: DailyId;
  name: string;
  /** One short line about the game. */
  line: string;
  /** Where Play goes (PokéGuessr starts today's game straight away). */
  href: string;
  /** Where the card goes once today's is finished. */
  doneHref: string;
  icon: LucideIcon;
  /** HSL triplet. */
  accent: string;
}

export const DAILIES: readonly DailyInfo[] = [
  { id: "daily", name: "Daily Challenge", line: "Mixed Pokémon trivia, the same quiz for everyone", href: "/daily", doneHref: "/daily", icon: CalendarDays, accent: "340 86% 60%" },
  { id: "pokedle", name: "Pokédle", line: "Name today's mystery Pokémon from its clues", href: "/pokedle", doneHref: "/pokedle", icon: Search, accent: "258 94% 74%" },
  { id: "guessr", name: "PokéGuessr", line: "Drop a pin on today's places", href: "/guessr?play=daily", doneHref: "/guessr", icon: Compass, accent: "154 68% 46%" },
  { id: "connections", name: "Connections", line: "Sort the Pokémon into their hidden groups", href: "/connections", doneHref: "/connections", icon: LayoutGrid, accent: "42 98% 60%" },
  { id: "pikadoku", name: "Pikadoku", line: "Pokémon Sudoku: fill the grid", href: "/pikadoku", doneHref: "/pikadoku", icon: Grid3x3, accent: "190 90% 55%" },
];

export interface DailyStatus {
  id: DailyId;
  /** Not started, started and not finished, or finished (won or not). */
  state: "new" | "progress" | "done";
  /** Today's result once finished ("Solved in 4", "18,240 pts"). */
  result: string | null;
  /** The game's daily streak as of today (0 when broken). */
  streak: number;
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** How each daily stands today. `progress` or `today` null (the server, or before the browser has read them): all new. */
export function dailyStatuses(progress: Progress | null, today: string | null): Record<DailyId, DailyStatus> {
  const out = Object.fromEntries(DAILIES.map((d) => [d.id, { id: d.id, state: "new", result: null, streak: 0 }])) as Record<DailyId, DailyStatus>;
  if (!progress || !today) return out;

  const quiz = progress.daily?.results?.[today];
  out.daily = {
    id: "daily",
    state: quiz ? "done" : "new",
    result: quiz ? `${quiz.correct}/${quiz.total} right` : null,
    streak: progress.daily ? currentStreak(progress.daily.last, progress.daily.streak, today) : 0,
  };

  const dle = progress.dle?.results?.[today];
  out.pokedle = {
    id: "pokedle",
    state: dle?.over ? "done" : dle?.guesses?.length ? "progress" : "new",
    result: dle?.over ? (dle.solved ? `Solved in ${dle.guesses.length}` : "Missed today") : null,
    streak: progress.dle ? dleStats(progress.dle.results ?? {}, today).playStreak : 0,
  };

  const geo = progress.best?.[`geo-daily:${today}`];
  out.guessr = {
    id: "guessr",
    state: geo !== undefined ? "done" : "new",
    result: geo !== undefined ? `${fmt(geo)} pts` : null,
    streak: progress.best ? geoDailyStreak(progress, today) : 0,
  };

  const conn = progress.conn?.results?.[today];
  out.connections = {
    id: "connections",
    state: conn?.over ? "done" : conn?.guesses?.length ? "progress" : "new",
    result: conn?.over ? (conn.solved ? (conn.mistakes ? `Solved · ${conn.mistakes} mistake${conn.mistakes === 1 ? "" : "s"}` : "Perfect") : "Missed today") : null,
    streak: progress.conn ? connStats(progress.conn.results ?? {}, today).playStreak : 0,
  };

  const pdk = progress.pdk?.results?.[today];
  out.pikadoku = {
    id: "pikadoku",
    state: pdk?.over ? "done" : pdk?.guesses?.length ? "progress" : "new",
    result: pdk?.over ? `${pdk.solved}/9 filled` : null,
    streak: progress.pdk ? currentStreak(progress.pdk.last, progress.pdk.streak, today) : 0,
  };
  return out;
}

export interface StreakLine {
  days: number;
  /** The games on that streak, in the section's order. */
  games: string[];
  /** One of them isn't played yet today: it's kept by playing today's. */
  atRisk: boolean;
}

/** The longest daily streak alive today, and which games are on it; null without one. */
export function bestStreak(statuses: Record<DailyId, DailyStatus>): StreakLine | null {
  const days = Math.max(0, ...DAILIES.map((d) => statuses[d.id].streak));
  if (days < 1) return null;
  const on = DAILIES.filter((d) => statuses[d.id].streak === days);
  return { days, games: on.map((d) => d.name), atRisk: on.some((d) => statuses[d.id].state !== "done") };
}

/** "Pokédle", "Pokédle and PokéGuessr", "Pokédle, PokéGuessr and Connections". */
export function listNames(names: string[]): string {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "4-day Pokédle streak", "4-day Pokédle and PokéGuessr streaks", "4-day streaks in Pokédle, PokéGuessr and Pikadoku". */
export function streakText({ days, games }: Pick<StreakLine, "days" | "games">): string {
  if (games.length > 2) return `${days}-day streaks in ${listNames(games)}`;
  return `${days}-day ${listNames(games)} streak${games.length > 1 ? "s" : ""}`;
}

/** Every daily finished today. */
export const allDone = (statuses: Record<DailyId, DailyStatus>) => DAILIES.every((d) => statuses[d.id].state === "done");
