import { DLE_FORMAT_LABEL } from "@/lib/dle-format";
import { DLE_ASSIST_INFO } from "@/lib/dle-assist";
import { MODULE_INFO } from "@/lib/modes";
import { GEO_MAX_ROUND_SCORE, GEO_ROUNDS, WORLD_REGION } from "@/lib/geo-types";
import { PLAY_FORMAT_INFO } from "@/lib/battle/play";
import { translator, type Translator } from "@/i18n/catalog";
import { formatNumber } from "@/i18n/format";
import sharePage from "@/messages/share-page";
import share from "@/messages/share";
import { battleOpponent, clock, connMistakes, connSizeOf, connectionsScore, connectionsTitle, guessrTitle, pikadokuSolved, pikadokuTitle, quizTitle, type ShareT } from "./text";
import type { ShareResult } from "./payload";

/** The "share-page" namespace's translator. */
export type SharePageT = Translator<typeof sharePage.en>;
let englishPage: SharePageT | undefined;
const englishPageT = (): SharePageT => (englishPage ??= translator(sharePage, "en", undefined));
let englishShare: ShareT | undefined;
const englishShareT = (): ShareT => (englishShare ??= translator(share, "en", undefined));

export interface DescribeOptions {
  /** The share text's words ("share"), in the page's language. Default English. */
  t?: ShareT;
  /** The landing page's ("share-page"), likewise. */
  tp?: SharePageT;
  /** A region's name in the page's language (the server reads them from src/data/i18n); default the English one. */
  region?: (id: string) => string | undefined;
}

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
export type ConnShareTile = "conn-yellow" | "conn-green" | "conn-blue" | "conn-purple" | "conn-red";
export const CONN_SHARE_TILES: readonly ConnShareTile[] = ["conn-yellow", "conn-green", "conn-blue", "conn-purple", "conn-red"];

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

const DLE_TILE: Record<string, ShareTile> = { g: "hit", c: "hit", y: "near", p: "near", b: "miss", x: "miss", u: "up", d: "down", m: "mask" };

/** "kanto" -> "Kanto". */
export const regionName = (id: string) => (id === WORLD_REGION ? "World" : id.charAt(0).toUpperCase() + id.slice(1));

export function guessrTile(points: number): ShareTile {
  if (points >= 4000) return "hit";
  if (points >= 2000) return "near";
  if (points > 0) return "far";
  return "wrong";
}

/** A shared result's page and card. `opts`: the page's language (translators and region names); English without. */
export function describeShare(r: ShareResult, opts: DescribeOptions = {}): ShareView {
  const t = opts.t ?? englishShareT();
  const tp = opts.tp ?? englishPageT();
  const fmt = (n: number) => formatNumber(n, tp.locale);
  const en = tp.locale === "en";
  const region = (id: string) => (id === WORLD_REGION ? t("guessr.world") : ((!en && opts.region?.(id)) || regionName(id)));
  const streak = (n: number) => tp("streak", { n });
  switch (r.game) {
    case "pokedle": {
      const label = r.daily !== undefined ? t(r.archive ? "pokedle.archive" : "pokedle.daily", { n: r.daily }) : t("pokedle.practice");
      const score = `${r.solved ? r.rows.length : "X"}/${r.max}`;
      const chips = [
        r.hard && tp("pokedle.hard"),
        r.assist && tp("pokedle.assist", { level: en ? DLE_ASSIST_INFO[r.assist].label : tp(`pokedle.assists.${r.assist}`) }),
        r.hints?.length && tp("pokedle.hints", { n: r.hints.length }),
        r.streak && streak(r.streak),
        r.top !== undefined && r.players !== undefined && tp("pokedle.top", { top: r.top, players: fmt(r.players) }),
      ].filter((c): c is string => Boolean(c));
      const detail = r.solved ? tp("pokedle.solved", { n: r.rows.length, max: r.max }) : tp("pokedle.notSolved", { max: r.max });
      return {
        game: "Pokédle",
        label: `${label} · ${en ? DLE_FORMAT_LABEL[r.format] : tp(`pokedle.formats.${r.format}`)}`,
        headline: score,
        detail,
        chips,
        tiles: r.rows.map((row) => [...row].map((c) => DLE_TILE[c] ?? "miss")),
        accent: "violet",
        playHref: "/pokedle",
        playLabel: tp("pokedle.play"),
        title: tp("titled", { label, score: `${score}${r.hard ? "*" : ""}` }),
        description: tp("pokedle.description", { detail }),
      };
    }
    case "guessr": {
      const title = guessrTitle(r, region(r.region), t);
      if (r.streak !== undefined) {
        const headline = tp("guessr.inARow", { n: r.streak });
        return {
          game: "PokéGuessr",
          label: title,
          headline,
          detail: tp("guessr.named", { n: r.streak }),
          chips: [region(r.region), tp("guessr.streakChip")],
          tiles: [[...Array.from({ length: Math.min(r.streak, 9) }, () => "hit" as const), "wrong"]],
          accent: "green",
          playHref: "/pokeguessr",
          playLabel: tp("guessr.play"),
          title: tp("titled", { label: title, score: headline }),
          description: tp("guessr.streakDescription"),
        };
      }
      const rounds = r.rounds ?? [];
      const total = rounds.reduce((s, p) => s + p, 0);
      const max = (rounds.length || GEO_ROUNDS) * GEO_MAX_ROUND_SCORE;
      return {
        game: "PokéGuessr",
        label: title,
        headline: fmt(total),
        detail: tp("guessr.outOf", { max: fmt(max), n: rounds.length || GEO_ROUNDS }),
        chips: [region(r.region), r.daily !== undefined ? tp("guessr.dailyChip") : tp("guessr.rounds", { n: rounds.length || GEO_ROUNDS })],
        tiles: [rounds.map(guessrTile)],
        numbers: rounds.map(fmt),
        accent: "green",
        playHref: "/pokeguessr",
        playLabel: r.daily !== undefined ? tp("guessr.playDaily") : tp("guessr.play"),
        title: tp("titled", { label: title, score: `${fmt(total)}/${fmt(max)}` }),
        description: tp("guessr.description", { max: fmt(GEO_ROUNDS * GEO_MAX_ROUND_SCORE) }),
      };
    }
    case "quiz": {
      const daily = r.daily !== undefined;
      const test = r.format === "adaptive" && !daily;
      const game = daily ? tp("quiz.dailyGame") : test ? tp("quiz.testGame") : en ? MODULE_INFO[r.module].title : t(`quiz.modules.${r.module}`);
      const label = daily ? tp("quiz.dailyLabel", { n: r.daily! }) : test ? tp("quiz.testLabel") : quizTitle(r, t);
      const grid = [...r.grid].map((c): ShareTile => (c === "1" ? "hit" : "wrong"));
      const tiles: ShareTile[][] = [];
      for (let i = 0; i < grid.length; i += 10) tiles.push(grid.slice(i, i + 10));
      const headline = test ? tp("quiz.iq", { iq: r.pokeiq }) : `${r.correct}/${r.total}`;
      return {
        game,
        label,
        headline,
        detail: test ? tp("quiz.right", { correct: r.correct, total: r.total, points: fmt(r.score) }) : tp("quiz.iqPoints", { iq: r.pokeiq, points: fmt(r.score) }),
        chips: [r.seconds !== undefined && tp("time", { time: clock(r.seconds) }), r.streak && streak(r.streak)].filter((c): c is string => Boolean(c)),
        tiles,
        accent: daily ? "pink" : test ? "violet" : "yellow",
        playHref: daily ? "/daily" : test ? "/iq-test" : "/quiz",
        playLabel: daily ? tp("quiz.playDaily") : test ? tp("quiz.playTest") : tp("quiz.play"),
        title: tp("titled", { label, score: headline }),
        description: daily ? tp("quiz.dailyDescription") : tp("quiz.description"),
      };
    }
    case "cognitive": {
      const headline = tp("cognitive.headline", { score: r.score });
      const detail = tp("cognitive.detail", { p: Math.round(r.percentile) });
      const chips = [
        tp("cognitive.reasoning", { n: r.fluid }),
        tp("cognitive.memory", { n: r.memory }),
        tp("cognitive.speed", { n: r.speed }),
        tp("cognitive.spatial", { n: r.spatial }),
        ...(r.knowledge !== undefined ? [tp("cognitive.knowledge", { n: r.knowledge })] : []),
      ];
      return {
        game: tp("cognitive.game"),
        label: tp("cognitive.label"),
        headline,
        detail,
        chips,
        tiles: [],
        accent: "violet",
        playHref: "/iq-test",
        playLabel: tp("quiz.playTest"),
        title: tp("cognitive.title", { headline, detail }),
        description: tp("cognitive.description"),
      };
    }
    case "connections": {
      const label = connectionsTitle(r, t);
      const size = connSizeOf(r.rows);
      const word = size === 5 ? "five" : "four";
      const found = r.rows.filter((row) => /^([0-4])\1{3,4}$/.test(row)).length;
      const mistakes = connMistakes(r.rows);
      const detail = r.solved
        ? r.seconds !== undefined
          ? tp("connections.solvedIn", { size: word, mistakes, time: clock(r.seconds) })
          : tp("connections.solved", { size: word, mistakes })
        : tp("connections.notSolved", { found, size });
      const headline = r.solved ? (mistakes === 0 ? tp("connections.perfect") : tp("connections.solvedHeadline")) : `${found}/${size}`;
      return {
        game: "PokéConnections",
        label,
        headline,
        detail,
        chips: [r.seconds !== undefined && tp("time", { time: clock(r.seconds) }), r.streak && streak(r.streak), r.hinted && tp("connections.hint")].filter((c): c is string => Boolean(c)),
        tiles: r.rows.map((row) => [...row].map((d) => CONN_SHARE_TILES[Number(d)])),
        accent: "violet",
        playHref: "/pokeconnections",
        playLabel: r.daily !== undefined ? tp("connections.playDaily") : tp("connections.play"),
        title: tp("titled", { label, score: connectionsScore(r, t) }),
        description: tp("connections.description", { size: word }),
      };
    }
    case "pikadoku": {
      const label = pikadokuTitle(r, t);
      const solved = pikadokuSolved(r.grid);
      const rare = [...r.grid].filter((c) => c === "p" || c === "b").length;
      const detail = solved === 9 ? tp("pikadoku.full") : tp("pikadoku.filled", { n: solved });
      return {
        game: "Pikadoku",
        label,
        headline: `${solved}/9`,
        detail: r.score !== undefined ? tp("pikadoku.withScore", { detail, score: r.score }) : detail,
        chips: [r.score !== undefined && tp("pikadoku.score", { score: r.score }), rare > 0 && tp("pikadoku.rare", { n: rare }), r.streak && streak(r.streak)].filter((c): c is string => Boolean(c)),
        tiles: [0, 1, 2].map((row) => [...r.grid.slice(row * 3, row * 3 + 3)].map((c) => PDK_TILE[c] ?? "pdk-empty")),
        accent: "yellow",
        playHref: "/pikadoku",
        playLabel: r.weekly !== undefined ? tp("pikadoku.playWeekly") : tp("pikadoku.play"),
        title: r.score !== undefined ? tp("pikadoku.titleScore", { label, solved, score: r.score }) : tp("titled", { label, score: `${solved}/9` }),
        description: tp("pikadoku.description"),
      };
    }
    case "battle": {
      const format = PLAY_FORMAT_INFO[r.format].name;
      const headline = tp(`battle.${r.outcome}`);
      const turns = t("battle.turns", { n: r.turns });
      const opponent = battleOpponent(r, t);
      return {
        game: tp("battle.game"),
        label: tp("battle.label", { format }),
        headline,
        detail: tp("battle.detail", { outcome: r.outcome, turns, opponent }),
        chips: [opponent, turns],
        tiles: [],
        accent: "pink",
        playHref: "/battle/play",
        playLabel: tp("battle.play"),
        title: tp("battle.title", { headline, format }),
        description: tp("battle.description"),
      };
    }
  }
}
