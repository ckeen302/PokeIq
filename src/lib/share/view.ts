import { DLE_FORMAT_LABEL } from "@/lib/dle-format";
import { DLE_ASSIST_INFO } from "@/lib/dle-assist";
import { MODULE_INFO } from "@/lib/modes";
import { GEO_MAX_ROUND_SCORE, GEO_ROUNDS, WORLD_REGION } from "@/lib/geo-types";
import { PLAY_FORMAT_INFO } from "@/lib/battle/play";
import { battleOpponent, clock, connMistakes, connectionsScore, connectionsTitle, guessrTitle, pikadokuSolved, pikadokuTitle, quizTitle } from "./text";
import type { ShareResult } from "./payload";

/**
 * How a shared result looks on its landing page (/s/<payload>) and its
 * preview card: everything here is derived from a decoded, validated
 * payload, and only ever rendered as text.
 */

/** One square of a board. */
export type ShareTile = "hit" | "near" | "far" | "miss" | "wrong" | "up" | "down" | "mask" | ConnShareTile | PdkShareTile;
/** Pikadoku's rarity colours: under 1%, under 10%, under 25%, 25% and over, and wrong or empty. */
export type PdkShareTile = "pdk-purple" | "pdk-blue" | "pdk-green" | "pdk-yellow" | "pdk-empty";
const PDK_TILE: Record<string, PdkShareTile> = { p: "pdk-purple", b: "pdk-blue", g: "pdk-green", y: "pdk-yellow", x: "pdk-empty" };
/** PokéConnections' group colours, easiest to hardest. */
export type ConnShareTile = "conn-yellow" | "conn-green" | "conn-blue" | "conn-purple";
export const CONN_SHARE_TILES: readonly ConnShareTile[] = ["conn-yellow", "conn-green", "conn-blue", "conn-purple"];

export type ShareAccent = "violet" | "green" | "yellow" | "pink" | "cyan";

export interface ShareView {
  /** "Pokédle", "PokéGuessr", "Who's That Pokémon?". */
  game: string;
  /** "Pokédle #142 · Classic": the eyebrow. */
  label: string;
  /** The big number: "4/8", "18,240", "Victory". */
  headline: string;
  /** One line under it. */
  detail: string;
  /** Small facts: "Hard mode", "5-day streak". */
  chips: string[];
  /** The board, rows of squares (empty for a battle). */
  tiles: ShareTile[][];
  /** Numbers under the board (PokéGuessr's points per round). */
  numbers?: string[];
  accent: ShareAccent;
  /** Where "Play" goes, and what it says. */
  playHref: string;
  playLabel: string;
  /** Link preview title and description. */
  title: string;
  description: string;
}

const fmt = (n: number) => n.toLocaleString("en-US");

const DLE_TILE: Record<string, ShareTile> = { g: "hit", c: "hit", y: "near", p: "near", b: "miss", x: "miss", u: "up", d: "down", m: "mask" };

/** "kanto" -> "Kanto". */
export const regionName = (id: string) => (id === WORLD_REGION ? "World" : id.charAt(0).toUpperCase() + id.slice(1));

export function guessrTile(points: number): ShareTile {
  if (points >= 4000) return "hit";
  if (points >= 2000) return "near";
  if (points > 0) return "far";
  return "wrong";
}

export function describeShare(r: ShareResult): ShareView {
  switch (r.game) {
    case "pokedle": {
      const label = r.daily !== undefined ? `Pokédle #${r.daily}${r.archive ? " (archive)" : ""}` : "Pokédle Practice";
      const score = `${r.solved ? r.rows.length : "X"}/${r.max}`;
      const chips = [
        r.hard && "Hard mode",
        r.assist && `Pokédex: ${DLE_ASSIST_INFO[r.assist].label}`,
        r.hints?.length && `${r.hints.length} hint${r.hints.length === 1 ? "" : "s"}`,
        r.streak && `${r.streak}-day streak`,
        r.top !== undefined && r.players !== undefined && `Top ${r.top}% of ${fmt(r.players)}`,
      ].filter((c): c is string => Boolean(c));
      const detail = r.solved ? `Solved in ${r.rows.length} of ${r.max} guesses` : `Not solved in ${r.max} guesses`;
      return {
        game: "Pokédle",
        label: `${label} · ${DLE_FORMAT_LABEL[r.format]}`,
        headline: score,
        detail,
        chips,
        tiles: r.rows.map((row) => [...row].map((c) => DLE_TILE[c] ?? "miss")),
        accent: "violet",
        playHref: "/pokedle",
        playLabel: "Play today's Pokédle",
        title: `${label}: ${score}${r.hard ? "*" : ""}`,
        description: `${detail}. Guess the mystery Pokémon from its clues: a new one every day on PokéIQ. Can you do better?`,
      };
    }
    case "guessr": {
      const title = guessrTitle(r, regionName(r.region));
      if (r.streak !== undefined) {
        return {
          game: "PokéGuessr",
          label: title,
          headline: `${r.streak} in a row`,
          detail: `Named ${r.streak} place${r.streak === 1 ? "" : "s"} in a row from in-game screenshots`,
          chips: [regionName(r.region), "Streak"],
          tiles: [[...Array.from({ length: Math.min(r.streak, 9) }, () => "hit" as const), "wrong"]],
          accent: "green",
          playHref: "/guessr",
          playLabel: "Play PokéGuessr",
          title: `${title}: ${r.streak} in a row`,
          description: "GeoGuessr for the Pokémon world: look at the in-game view, drop a pin on the map. Can you beat this streak?",
        };
      }
      const rounds = r.rounds ?? [];
      const total = rounds.reduce((s, p) => s + p, 0);
      const max = (rounds.length || GEO_ROUNDS) * GEO_MAX_ROUND_SCORE;
      return {
        game: "PokéGuessr",
        label: title,
        headline: fmt(total),
        detail: `out of ${fmt(max)} points over ${rounds.length || GEO_ROUNDS} places`,
        chips: [regionName(r.region), r.daily !== undefined ? "Daily game" : `${rounds.length || GEO_ROUNDS} rounds`],
        tiles: [rounds.map(guessrTile)],
        numbers: rounds.map(fmt),
        accent: "green",
        playHref: "/guessr",
        playLabel: r.daily !== undefined ? "Play today's PokéGuessr" : "Play PokéGuessr",
        title: `${title}: ${fmt(total)}/${fmt(max)}`,
        description: "GeoGuessr for the Pokémon world: look at the in-game view, drop a pin on the map, score up to 25,000. Can you beat it?",
      };
    }
    case "quiz": {
      const daily = r.daily !== undefined;
      const test = r.format === "adaptive" && !daily;
      const game = daily ? "Daily Challenge" : test ? "PokéIQ Test" : MODULE_INFO[r.module].title;
      const label = daily ? `Daily Challenge #${r.daily}` : test ? "The PokéIQ Test" : quizTitle(r);
      const grid = [...r.grid].map((c): ShareTile => (c === "1" ? "hit" : "wrong"));
      const tiles: ShareTile[][] = [];
      for (let i = 0; i < grid.length; i += 10) tiles.push(grid.slice(i, i + 10));
      return {
        game,
        label,
        headline: test ? `PokéIQ ${r.pokeiq}` : `${r.correct}/${r.total}`,
        detail: test ? `${r.correct}/${r.total} right · ${fmt(r.score)} pts` : `PokéIQ ${r.pokeiq} · ${fmt(r.score)} pts`,
        chips: [r.seconds !== undefined && `Time ${clock(r.seconds)}`, r.streak && `${r.streak}-day streak`].filter((c): c is string => Boolean(c)),
        tiles,
        accent: daily ? "pink" : test ? "violet" : "yellow",
        playHref: daily ? "/daily" : test ? "/iq-test" : "/play",
        playLabel: daily ? "Take today's Daily Challenge" : test ? "Take the PokéIQ Test" : "Play the quizzes",
        title: `${label}: ${test ? `PokéIQ ${r.pokeiq}` : `${r.correct}/${r.total}`}`,
        description: daily
          ? "Ten Pokémon questions, the same for every trainer, every day. Keep your streak going on PokéIQ."
          : "How well do you know Pokémon? Free quizzes on all 1,025 Pokémon, no sign-up. Can you beat this score?",
      };
    }
    case "connections": {
      const label = connectionsTitle(r);
      const found = r.rows.filter((row) => /^([0-3])\1{3}$/.test(row)).length;
      const mistakes = connMistakes(r.rows);
      const time = r.seconds !== undefined ? ` in ${clock(r.seconds)}` : "";
      const detail = r.solved
        ? `Found all four groups with ${mistakes === 0 ? "no mistakes" : `${mistakes} mistake${mistakes === 1 ? "" : "s"}`}${time}`
        : `Found ${found} of 4 groups before running out of mistakes`;
      const headline = r.solved ? (mistakes === 0 ? "Perfect" : "Solved") : `${found}/4`;
      return {
        game: "PokéConnections",
        label,
        headline,
        detail,
        chips: [r.seconds !== undefined && `Time ${clock(r.seconds)}`, r.streak && `${r.streak}-day streak`, r.hinted && "Hint used"].filter((c): c is string => Boolean(c)),
        tiles: r.rows.map((row) => [...row].map((d) => CONN_SHARE_TILES[Number(d)])),
        accent: "violet",
        playHref: "/connections",
        playLabel: r.daily !== undefined ? "Play today's PokéConnections" : "Play PokéConnections",
        title: `${label}: ${connectionsScore(r)}`,
        description: "Sixteen Pokémon, four hidden groups. Find what links them in a new puzzle every day on PokéIQ. Can you do better?",
      };
    }
    case "pikadoku": {
      const label = pikadokuTitle(r);
      const solved = pikadokuSolved(r.grid);
      const rare = [...r.grid].filter((c) => c === "p" || c === "b").length;
      const detail = solved === 9 ? "Filled the whole grid" : `Filled ${solved} of 9 cells`;
      return {
        game: "Pikadoku",
        label,
        headline: `${solved}/9`,
        detail: r.score !== undefined ? `${detail} · uniqueness score ${r.score}` : detail,
        chips: [r.score !== undefined && `Score ${r.score}`, rare > 0 && `${rare} rare pick${rare === 1 ? "" : "s"}`, r.streak && `${r.streak}-day streak`].filter((c): c is string => Boolean(c)),
        tiles: [0, 1, 2].map((row) => [...r.grid.slice(row * 3, row * 3 + 3)].map((c) => PDK_TILE[c] ?? "pdk-empty")),
        accent: "yellow",
        playHref: "/pikadoku",
        playLabel: r.weekly !== undefined ? "Play this week's Pikadoku" : "Play today's Pikadoku",
        title: `${label}: ${solved}/9${r.score !== undefined ? ` · score ${r.score}` : ""}`,
        description: "Pokémon Sudoku: one Pokémon for each cell, matching its row and column. The rarer your picks, the lower your score. Can you do better?",
      };
    }
    case "battle": {
      const format = PLAY_FORMAT_INFO[r.format].name;
      const headline = r.outcome === "win" ? "Victory" : r.outcome === "loss" ? "Defeat" : "Draw";
      const turns = `${r.turns} turn${r.turns === 1 ? "" : "s"}`;
      return {
        game: "Battle",
        label: `Battle · ${format}`,
        headline,
        detail: `${r.outcome === "win" ? "Won" : r.outcome === "loss" ? "Lost" : "Drew"} in ${turns} · ${battleOpponent(r)}`,
        chips: [battleOpponent(r), turns],
        tiles: [],
        accent: "pink",
        playHref: "/battle/play",
        playLabel: "Start a battle",
        title: `${headline} in ${format}`,
        description: "Pokémon battles on Pokémon Showdown's engine, against the computer or a friend. Free, in your browser.",
      };
    }
  }
}

