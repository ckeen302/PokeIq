"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CalendarRange, Check, Compass, Flame, Globe2, Loader2, Shapes, SlidersHorizontal, MapPin as MapPinIcon, Swords, Trophy, Users, X, Map as MapIcon } from "lucide-react";
import { GEO_FILTER_MIN_PLACES, GEO_MAX_ROUND_SCORE, GEO_ROUNDS, WORLD_REGION, isGeoRounds, type GeoRounds, geoBoardKey, geoDailyRegion, geoMapRank, type GeoChallenge, type GeoGuessResponse, type GeoKind, type GeoRegionInfo, type GeoRoundPublic, type GeoStartResponse } from "@/lib/geo-types";
import { dailyNumber } from "@/lib/daily";
import { useToday } from "@/lib/use-today";
import { recordGeoGame, useProgress, type BadgeDef } from "@/lib/progress";
import { play, unlockAudio } from "@/lib/sound";
import { stopPressure } from "@/lib/guessr-pressure";
import { useGuessrPressure } from "@/lib/use-guessr-pressure";
import { guessrSquare } from "@/lib/share";
import { GEO_DIFFICULTY_NAMES, type GeoDifficulty } from "@/lib/geo-difficulty";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GeoMap, LINE_DRAW_MS, WORLD_MAP as WORLD_MAP_SRC, mapAspect, type MapPin } from "./GeoMap";
import { RegionStreakCard } from "./RegionStreakCard";
import { useAccount } from "@/lib/account";
import { avatarSrc } from "@/lib/avatar";
import { GlobePreview } from "@/components/globe/GlobePreview";
import { GeoHowToLoader, HowToHelpButton } from "./GeoHowToButton";
import { HubSection, HubTile, TileFlag } from "./HubParts";
import { GeoYou } from "./GeoYou";
import { AchievementToasts, useGeoProgress, type MyGeoProgress } from "./GeoAchievements";
import type { DuelQueue } from "./DuelCard";
import { geoWeekOf, geoWeeklyBoard, geoWeeklyLeft, geoWeeklyMap, geoWeeklyNumber } from "@/lib/geo-weekly";

/**
 * What a solo round doesn't need is split off the first load: the duel card,
 * and the reveal's extras, the results and the summary, fetched once a game is on its way.
 */
// The duel and ranked card sits below the fold: rendered on the server as before, its code loads alongside.
const PartyCard = dynamic(() => import("./PartyCard").then((m) => m.PartyCard), { loading: () => null });
const DuelCard = dynamic(() => import("./DuelCard").then((m) => m.DuelCard), { loading: () => null });
const loadResults = () => import("./GeoResults");
const loadSummary = () => import("./GeoSummary");
const loadLearn = () => import("./LearnCard");
const loadReport = () => import("./ReportShot");
const LazyResults = dynamic(() => loadResults().then((m) => m.GeoResults), { ssr: false });
const LazySummary = dynamic(() => loadSummary().then((m) => m.GeoSummary), { ssr: false });
const LazyLearn = dynamic(() => loadLearn().then((m) => m.LearnCard), { ssr: false });
const LazyReport = dynamic(() => loadReport().then((m) => m.ReportShot), { ssr: false });
/** The parts once fetched: rendered directly, so they show in the same frame as before (no lazy hand-off). */
let loaded: Partial<{
  GeoResults: typeof import("./GeoResults").GeoResults;
  GeoSummary: typeof import("./GeoSummary").GeoSummary;
  LearnCard: typeof import("./LearnCard").LearnCard;
  ReportShot: typeof import("./ReportShot").ReportShot;
}> = {};
/** Fetches the after-the-round code ahead, so the reveal and the results show at once. */
const preloadAfterRound = () =>
  void Promise.all([loadResults(), loadSummary(), loadLearn(), loadReport()])
    .then(([r, s, l, rep]) => {
      loaded = { GeoResults: r.GeoResults, GeoSummary: s.GeoSummary, LearnCard: l.LearnCard, ReportShot: rep.ReportShot };
    })
    .catch(() => undefined);
/** A game got ready on hover is used for a click this soon after. */
const PREFETCH_TTL_MS = 60_000;
import { ShotCarousel, shotFit } from "./ShotCarousel";
import { CountdownPill, ExitButton, FullscreenButton, GameShell, GuessButton, MapDock, Notch } from "./GameShell";
import { roundViewsOf } from "@/lib/geo-look";
import { DifficultyPicker, GeoSettingsButton, RoundsPicker } from "./GeoSettings";
import { DEFAULT_GEO_SETTINGS, GEO_ZOOM, readGeoSettings, rememberGeoSettings, secondsLeft, visibleViews, zoomOrigin, type GeoPlaySettings } from "@/lib/geo-settings";
import { GameFilter, GameGuessPicker, type FilterChoice, filterPlaces, gameGuessOptions } from "./GameFilter";
import { GEO_ERA_NAMES, GEO_GAME_BONUS, geoFamily, type GeoEra, type GeoFamilyId } from "@/lib/geo-families";
import { cn } from "@/lib/utils";
import { preloadImage } from "@/lib/preload";
import { readSeenShots, rememberSeenShot } from "@/lib/geo-seen";
import { isWorldwide, themeOf } from "@/lib/geo-themes";

type Phase = "setup" | "loading" | "guessing" | "submitting" | "revealed" | "results" | "error";

export interface Game {
  /** The map being played (a daily or a challenge picks its own). */
  region: GeoRegionInfo;
  kind: GeoKind;
  /** Rounds in a game (5 for the Daily). */
  rounds: number;
  daily?: string;
  /** The Weekly Challenge's week (its Monday). */
  weekly?: string;
  practice?: string;
  /** The game filter it was started with (the daily: every game). */
  filter: FilterChoice;
  guessGame: boolean;
  /** Easy or Hard (practice); Normal when unset. */
  difficulty?: "easy" | "hard";
  /** No move, Zoomed and the round timer, as set when the game started. */
  settings: GeoPlaySettings;
  token: string;
  round: GeoRoundPublic;
}

export interface Played {
  /** Null when the round's clock ran out with no pin down. */
  guess: MapPin | null;
  graded: GeoGuessResponse;
  /** The screenshot's URL, for reporting it. */
  shot: string;
}

/** The personal-best and leaderboard board of a game: its map, kind and era (hand-picked games keep a best of their own). */
const boardOf = (game: Pick<Game, "region" | "kind" | "filter" | "difficulty"> & { rounds?: number }) =>
  `${geoBoardKey({ region: game.region.id, kind: game.kind, era: game.filter.era, rounds: game.rounds })}${game.filter.families.length ? ":custom" : ""}${
    game.difficulty ? `:${game.difficulty}` : ""
  }`;

export interface Reward {
  xp: number;
  best: boolean;
  newBadges: BadgeDef[];
}

export const fmt = (n: number) => n.toLocaleString("en-US");
export const maxTotal = (rounds: number) => rounds * GEO_MAX_ROUND_SCORE;

export const emoji = guessrSquare;

function verdict(score: number): string {
  if (score >= GEO_MAX_ROUND_SCORE) return "Spot on!";
  if (score >= 4000) return "So close!";
  if (score >= 2500) return "Not bad!";
  if (score >= 1000) return "In the neighbourhood.";
  return "Way off…";
}

const playable = (region: GeoRegionInfo | undefined) => (region?.locations ?? 0) >= GEO_ROUNDS;
const where = (region: GeoRegionInfo) => (region.id === WORLD_REGION ? "the Pokémon world" : region.theme ? `the ${region.name} map` : region.name);

/**
 * "Saffron City" or "Silph Co. · Saffron City", without the "Kanto " prefix
 * routes carry, plus the region when the map doesn't make it obvious.
 */
const clean = (s: string) => s.replace(/^(Kanto|Johto|Hoenn|Sinnoh|Unova|Kalos|Alola|Galar|Paldea) (?=Route)/, "");
/** The in-game name, without the wiki's disambiguation ("Iron Ruins (Sinnoh)", "Battle Tower (Generation III)", "Victory Road (BW)"). */
const shown = (s: string) => clean(s).replace(/ \((Kanto|Johto|Hoenn|Sinnoh|Unova|Kalos|Alola|Galar|Paldea|Generation [IVX]+|BW|B2W2|Jagged Pass)\)$/, "");
export function placeName(answer: { name: string; parent?: string; region?: string }, map?: GeoRegionInfo): string {
  const name = answer.parent ? `${shown(answer.name)} · ${shown(answer.parent)}` : shown(answer.name);
  return answer.region && map && answer.region !== map.name ? `${name}, ${answer.region}` : name;
}

/** Areas the player saw lately, most recent first, so a new game doesn't bring them straight back. */
const RECENT_KEY = "pokeiq:geo-recent";
const RECENT_MAX = 200;
function readRecent(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((k): k is string => typeof k === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}
function rememberArea(answer: { name: string; parent?: string; region?: string }) {
  const key = `${answer.region}|${answer.parent ?? answer.name}`;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([key, ...readRecent().filter((k) => k !== key)].slice(0, RECENT_MAX)));
  } catch {
    // Private mode: games just aren't steered away from recent places.
  }
}


function distanceText(squares: number): string {
  if (squares === 0) return "Right on it!";
  return `${squares.toFixed(1)} map square${squares === 1 ? "" : "s"} away`;
}

export async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Counts up to `value` (eased) whenever it changes, after `delay` ms; instant under reduced motion. A tally tick sounds as it counts. */
export function useCountUp(value: number, ms = 700, delay = 0, tally = false): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced) {
      setShown(value);
      from.current = value;
      return;
    }
    const origin = from.current;
    let raf = 0;
    let start = 0;
    let lastTick = 0;
    const tick = (now: number) => {
      start ||= now;
      const t = Math.min(1, (now - start) / ms);
      const v = Math.round(origin + (value - origin) * (1 - (1 - t) ** 3));
      setShown(v);
      if (tally && v !== origin && now - lastTick > 90 && t < 1) {
        lastTick = now;
        play("tally");
      }
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    const id = window.setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, delay);
    return () => {
      window.clearTimeout(id);
      cancelAnimationFrame(raf);
    };
  }, [value, ms, delay, tally, reduced]);
  return shown;
}

export interface GeoGameProps {
  /** Every map: the world and each region. */
  regions: GeoRegionInfo[];
  /** Set on /guessr/c/<token>: a friend's game to replay. */
  challenge?: GeoChallenge & { token: string; region: string; era?: GeoEra; families?: GeoFamilyId[]; difficulty?: "easy" | "hard" };
}

export function GeoGame(props: GeoGameProps) {
  // The player's achievements and mastery (the hub's You section), read again after each game for the toasts.
  const { progress, fresh, refresh, dismiss } = useGeoProgress();
  return (
    <>
      <GeoGameInner {...props} mine={progress} onGameOver={refresh} />
      {!props.challenge && <GeoHowToLoader />}
      <AchievementToasts ids={fresh} onDismiss={dismiss} />
    </>
  );
}

function GeoGameInner({ regions: allRegions, challenge, mine, onGameOver }: GeoGameProps & { mine: MyGeoProgress | null; onGameOver: () => void }) {
  const today = useToday();
  const progress = useProgress();
  const account = useAccount();
  const pinImage = account.user?.avatar ? avatarSrc(account.user.avatar) : undefined;
  const regions = [...allRegions].filter((r) => playable(r)).sort((a, b) => geoMapRank(a.id) - geoMapRank(b.id));
  const byId = (id: string) => regions.find((r) => r.id === id);
  const [phase, setPhase] = useState<Phase>("setup");
  const [error, setError] = useState<string | null>(null);
  const [regionId, setRegionId] = useState(challenge?.region ?? regions[0]?.id ?? WORLD_REGION);
  const [game, setGame] = useState<Game | null>(null);
  const [pick, setPick] = useState<MapPin | null>(null);
  const [played, setPlayed] = useState<Played[]>([]);
  const [viewIndex, setViewIndex] = useState(0);
  const [zoomPixelated, setZoomPixelated] = useState(false);
  const [settings, setSettings] = useState<GeoPlaySettings>(DEFAULT_GEO_SETTINGS);
  const [roundStartedAt, setRoundStartedAt] = useState(0);
  /** The round's screenshot is loaded and decoded: only then does the Timer run. */
  const [shotReady, setShotReady] = useState(false);
  const [now, setNow] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [reward, setReward] = useState<Reward | null>(null);
  const [isChallenge, setIsChallenge] = useState(false);
  const [filter, setFilter] = useState<FilterChoice>({ era: undefined, families: [] });
  const [gamePick, setGamePick] = useState<string | null>(null);
  const [rounds, setRounds] = useState<GeoRounds>(5);
  const [difficulty, setDifficulty] = useState<GeoDifficulty>("normal");
  const [duelQueue, setDuelQueue] = useState<DuelQueue>("casual");
  const chosenMode = difficulty === "normal" ? undefined : difficulty;

  const region = byId(regionId) ?? regions[0];
  const places = filterPlaces(region, filter);
  // A map too small for the picked length plays the default.
  const playRounds: GeoRounds = rounds <= places ? rounds : GEO_ROUNDS;
  const filterOk = !filter.era && !filter.families.length ? playable(region) : places >= GEO_FILTER_MIN_PLACES;

  useEffect(() => setSettings(readGeoSettings()), []);

  function chooseSettings(next: GeoPlaySettings) {
    setSettings(next);
    rememberGeoSettings(next);
  }

  // /guessr?region=johto opens on that map (the atlas links here).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("region");
    if (id && !challenge && regions.some((r) => r.id === id)) setRegionId(id);
    const era = params.get("era");
    if (era === "2d" || era === "3d") setFilter({ era, families: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read the URL once
  }, []);

  function chooseRegion(id: string) {
    setRegionId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("region", id);
    window.history.replaceState(null, "", url);
  }

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  /** The hub's Solo tile: down to the solo game's setup. */
  const toSolo = () => scrollTo("solo");
  /** A map tile: that map, then the solo setup. */
  function pickMap(id: string) {
    chooseRegion(id);
    toSolo();
  }
  /** The Party tile (or /guessr#party): opens the party form, so the hub's other forms are the only ones on the page until then. */
  const [partyOpen, setPartyOpen] = useState(false);
  useEffect(() => {
    if (window.location.hash !== "#party") return;
    setPartyOpen(true);
    window.setTimeout(() => document.getElementById("party")?.scrollIntoView({ block: "start" }), 300);
  }, []);
  function openParty() {
    setPartyOpen(true);
    window.setTimeout(() => scrollTo("party"), 50);
  }
  /** The Duels and Ranked tiles: the duel panel, on that queue. */
  function openDuels(queue: DuelQueue) {
    setDuelQueue(queue);
    scrollTo("duels");
  }

  // A finished game: the rounds are logged a moment after the last guess, then the achievements are read again.
  useEffect(() => {
    if (phase !== "results") return;
    const t = window.setTimeout(onGameOver, 1500);
    return () => window.clearTimeout(t);
  }, [phase, onGameOver]);

  function chooseFilter(next: FilterChoice) {
    setFilter(next);
    const url = new URL(window.location.href);
    if (next.era) url.searchParams.set("era", next.era);
    else url.searchParams.delete("era");
    window.history.replaceState(null, "", url);
  }

  const current = phase === "revealed" ? played[played.length - 1] : null;
  const total = played.reduce((s, p) => s + p.graded.score, 0);
  const streak = played.filter((p) => p.graded.hit).length;

  type StartOpts = { kind: GeoKind; daily?: string; challenge?: string; weekly?: boolean };
  function startBody(opts: StartOpts) {
    const bonus: { guessGame?: boolean } = {};
    const picked = { era: filter.era, families: filter.families.length ? filter.families : undefined };
    // Free play takes the picked difficulty; a challenge plays its own, the Daily always Normal.
    const mode = opts.challenge ? challenge?.difficulty : opts.daily || opts.weekly ? undefined : chosenMode;
    const body = opts.weekly
      ? { weekly: true, name: progress?.name || undefined }
      : opts.challenge
      ? { challenge: opts.challenge, name: progress?.name || undefined, ...bonus }
      : opts.daily
        ? { daily: opts.daily, name: progress?.name || undefined, ...bonus }
        : {
            region: region.id,
            kind: opts.kind,
            ...(opts.kind === "game" ? { rounds: playRounds } : {}),
            ...picked,
            ...(mode ? { difficulty: mode } : {}),
            name: progress?.name || undefined,
            recent: readRecent(),
            seen: readSeenShots(),
            ...bonus,
          };
    // The Timer setting goes to the server too, so a late pin scores nothing there as well.
    return { mode, bonus, body: { ...body, ...(settings.timer ? { timer: settings.timer } : {}) } };
  }

  /**
   * Hovering or focusing a Play button gets the game ready: the code and the
   * world map the round needs, and (for free play and challenges) the game
   * itself and round 1's picture, so the click shows the round at once. The
   * Daily isn't started ahead (starting it is what counts it as played), nor a
   * timed game (its clock is the server's). A ready game is used only if the
   * click asks for exactly the same game, within a minute.
   */
  const ahead = useRef<{ key: string; at: number; res: Promise<GeoStartResponse> } | null>(null);
  function prefetch(opts: StartOpts) {
    if (phase !== "setup") return;
    preloadAfterRound();
    void preloadImage(WORLD_MAP_SRC);
    if (opts.daily || opts.weekly || settings.timer) return;
    const { body } = startBody(opts);
    const key = JSON.stringify(body);
    if (ahead.current?.key === key && Date.now() - ahead.current.at < PREFETCH_TTL_MS) return;
    const res = post<GeoStartResponse>("/api/geo", body);
    res.then((r) => preloadImage(r.round.shot, { priority: "high" })).catch(() => undefined);
    ahead.current = { key, at: Date.now(), res };
  }
  const warmProps = (opts: StartOpts) => ({ onPointerEnter: () => prefetch(opts), onFocus: () => prefetch(opts) });

  /**
   * And once per page view, when the page goes idle: the game the player is
   * most likely to start (a friend's challenge, else the solo game on the map,
   * filter and length the page opened with, after the saved settings are read),
   * so a click within the minute shows round 1 with its picture already in.
   * Starting a free game or a challenge records nothing (only a guess does),
   * so a game that's never played costs nothing but the request.
   */
  const warmOnLoad = useRef<() => void>(() => undefined);
  warmOnLoad.current = () => {
    if (challenge) prefetch({ kind: "game", challenge: challenge.token });
    else if (filterOk) prefetch({ kind: "game" });
  };
  useEffect(() => {
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      warmOnLoad.current();
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(run, { timeout: 600 });
      return () => {
        done = true;
        window.cancelIdleCallback(id);
      };
    }
    const id = window.setTimeout(run, 200);
    return () => {
      done = true;
      window.clearTimeout(id);
    };
  }, []);

  async function start(opts: StartOpts) {
    unlockAudio();
    setPhase("loading");
    setError(null);
    preloadAfterRound();
    try {
      const { mode, bonus, body } = startBody(opts);
      const key = JSON.stringify(body);
      const ready = ahead.current?.key === key && Date.now() - ahead.current.at < PREFETCH_TTL_MS ? ahead.current.res : null;
      ahead.current = null;
      const res = (ready ? await ready.catch(() => null) : null) ?? (await post<GeoStartResponse>("/api/geo", body));
      const map = byId(res.region) ?? allRegions.find((r) => r.id === res.region);
      if (!map) throw new Error("That map isn't available right now.");
      // A friend's challenge plays on their filter, the daily on every game.
      const played: FilterChoice = opts.challenge
        ? { era: challenge?.era, families: challenge?.families ?? [] }
        : opts.daily || opts.weekly
          ? { era: undefined, families: [] }
          : filter;
      setGame({
        region: map,
        kind: opts.kind,
        rounds: opts.challenge && challenge && isGeoRounds(challenge.rounds.length) ? challenge.rounds.length : opts.kind === "game" && !opts.daily && !opts.weekly ? playRounds : GEO_ROUNDS,
        daily: opts.daily,
        ...(res.weekly ? { weekly: res.weekly } : {}),
        practice: res.practice,
        filter: played,
        guessGame: !!bonus.guessGame,
        ...(mode ? { difficulty: mode } : {}),
        settings,
        token: res.token,
        round: res.round,
      });
      setGamePick(null);
      setIsChallenge(!!opts.challenge);
      setPick(null);
      setPlayed([]);
      setReward(null);
      setViewIndex(0);
      setRoundStartedAt(Date.now());
      setPhase("guessing");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start a game.");
      setPhase("error");
    }
  }

  /** `timeUp`: the round's clock ran out, so the pin (if any) is guessed where it is. */
  async function guess(timeUp = false) {
    if (!game || (!pick && !timeUp) || phase !== "guessing") return;
    setPhase("submitting");
    stopPressure();
    try {
      const at = pick ?? { x: 0, y: 0, timeout: true };
      if (!timeUp) play("guess");
      const graded = await post<GeoGuessResponse>("/api/geo/guess", { token: game.token, ...at, ...(game.guessGame && gamePick ? { family: gamePick } : {}) });
      const nextPlayed = [...played, { guess: pick, graded, shot: game.round.shot }];
      setPlayed(nextPlayed);
      setGame({ ...game, token: graded.token });
      rememberArea(graded.answer);
      rememberSeenShot(game.round.shot);
      const good = game.kind === "streak" ? graded.hit : graded.score >= 2500;
      play(good ? (game.kind === "streak" && graded.hit && nextPlayed.length % 5 === 0 ? "streak" : "correct") : "wrong");
      // The next round's picture is fetched and decoded now, so Next shows it at once.
      if (graded.next) void preloadImage(graded.next.shot);
      if (graded.done && graded.result) {
        setReward(
          recordGeoGame(boardOf(game), {
            kind: game.kind,
            score: graded.result.score,
            rounds: nextPlayed.map((p) => p.graded.score),
            daily: game.daily,
            weekly: game.weekly,
          })
        );
      }
      setPhase("revealed");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't grade that guess.");
      setPhase("error");
    }
  }

  function next() {
    if (!game || !current) return;
    const { graded } = current;
    if (graded.done || !graded.next) {
      play("fanfare");
      setPhase("results");
      return;
    }
    setGame({ ...game, round: graded.next });
    setPick(null);
    setGamePick(null);
    setViewIndex(0);
    setRoundStartedAt(Date.now());
    setPhase("guessing");
  }

  // The Timer setting: a clock per round; at zero the pin is guessed where it is (no pin: no points).
  const timer = game?.settings.timer ?? 0;
  const roundShot = game?.round.shot;
  const nextShot = game?.round.preload;
  useEffect(() => {
    if (!roundShot) return;
    let off = false;
    setShotReady(false);
    void preloadImage(roundShot).then(() => {
      if (off) return;
      setRoundStartedAt(Date.now());
      setShotReady(true);
      // Then the next round's picture, fetched and decoded while this one is being looked at.
      if (nextShot) void preloadImage(nextShot);
    });
    return () => {
      off = true;
    };
  }, [roundShot, nextShot]);
  const timeLeft = timer && shotReady && (phase === "guessing" || phase === "submitting") ? secondsLeft(roundStartedAt, now || roundStartedAt, timer) : null;
  useEffect(() => {
    if (!timer || !shotReady || phase !== "guessing") return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [timer, shotReady, phase, roundStartedAt]);
  useEffect(() => {
    if (timeLeft === 0 && phase === "guessing") void guess(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once, when the clock hits zero
  }, [timeLeft, phase]);
  // The last ten seconds: the duels' countdown pressure, softer.
  const soloWindowMs = Math.min(10_000, timer * 1000);
  const soloLeftMs = timer ? roundStartedAt + timer * 1000 - (now || roundStartedAt) : 0;
  useGuessrPressure({
    active: !!timer && shotReady && phase === "guessing" && soloLeftMs > 0 && soloLeftMs <= soloWindowMs,
    leftMs: soloLeftMs,
    totalMs: soloWindowMs,
    flashMs: 5_000,
    level: 0.55,
    cue: true,
    round: played.length,
  });

  // GeoGuessr's shortcuts: Space / Enter to guess, then for the next round. Esc closes the zoomed view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setZoomed(false);
        return;
      }
      if (e.key !== "Enter" && e.key !== " ") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, button, a")) return;
      if (phase === "guessing" && pick) {
        e.preventDefault();
        void guess();
      } else if (phase === "revealed") {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- setup: the hub -----------------------------------------------------------
  if (phase === "setup" || phase === "loading" || (phase === "error" && !game)) {
    const dailyDone = today ? progress?.best[`geo-daily:${today}`] : undefined;
    const dailyMap = today ? byId(geoDailyRegion(today, playable(byId(WORLD_REGION)))) : undefined;
    const bestGame = progress?.best[`geo:${boardOf({ region, kind: "game", filter, rounds: playRounds, difficulty: chosenMode })}`];
    const bestStreak = progress?.best[`geo:${boardOf({ region, kind: "streak", filter, difficulty: chosenMode })}`];
    const challengeMap = challenge ? byId(challenge.region) : undefined;
    const loading = phase === "loading";
    const isWorld = isWorldwide(region.id);
    const theme = themeOf(region.id);
    const maps = regions.filter((r) => !r.theme);
    const themed = regions.filter((r) => r.theme);
    // The Weekly Challenge, worked out once the page is in the browser (the week turns on the player's clock, at Monday 00:00 UTC).
    const week = today ? geoWeekOf(Date.now()) : null;
    const weeklyMap = week ? byId(geoWeeklyMap(week, (id) => playable(byId(id))) ?? "") : undefined;
    const weeklyDone = week ? progress?.best[`geo-weekly:${week}`] : undefined;
    return (
      <div className="mx-auto max-w-6xl space-y-12">
        <div className="relative space-y-3 text-center">
          <HowToHelpButton className="absolute right-0 top-0" />
          <p className="hud-label text-screen">Field survey · {region.name}</p>
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-6xl">
            Poké<span className="text-primary">Guessr</span>
          </h1>
          <p className="mx-auto max-w-xl text-muted-foreground">
            GeoGuessr for Pokémon. You&apos;re dropped somewhere in {where(region)}: look around, then drop a pin on the map.
            Scored like GeoGuessr: up to {fmt(GEO_MAX_ROUND_SCORE)} points a round, falling off the further your pin lands.
          </p>
          <nav aria-label="PokéGuessr sections" className="flex flex-wrap justify-center gap-1.5 pt-1">
            {[
              ["play", "Play"],
              ["multiplayer", "Multiplayer"],
              ["maps", "Maps"],
              ["you", "You"],
            ].map(([id, name]) => (
              <a
                key={id}
                href={`#${id}`}
                className="rounded-md border bg-card px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-screen/50 hover:text-foreground"
              >
                {name}
              </a>
            ))}
          </nav>
        </div>

        {error && (
          <p role="alert" className="text-center text-sm text-destructive">
            {error}
          </p>
        )}

        {challenge && (
          <Card className="overflow-hidden border-success/40">
            <div className="grid md:grid-cols-[1fr_auto]">
              <CardContent className="space-y-2 p-6">
                <p className="hud-label flex items-center gap-1.5 text-success">
                  <Swords className="h-3.5 w-3.5" aria-hidden /> Challenge
                </p>
                <p className="font-display text-2xl font-bold uppercase">
                  {challenge.name || "A trainer"} scored {fmt(challenge.score)}
                </p>
                <p className="text-sm text-muted-foreground">
                  Same {challenge.rounds.length || 5} places{challengeMap ? ` in ${where(challengeMap)}` : ""}, same screenshots.{" "}
                  {challenge.rounds.map(emoji).join("")}
                </p>
              </CardContent>
              <div className="flex items-center p-6 pt-0 md:pt-6">
                <Button
                  size="lg"
                  variant="success"
                  className="w-full md:w-auto"
                  disabled={loading}
                  onClick={() => void start({ kind: "game", challenge: challenge.token })}
                  {...warmProps({ kind: "game", challenge: challenge.token })}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Swords className="h-4 w-4" aria-hidden />}
                  Accept challenge
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* ---- Play ---- */}
        <HubSection id="play" eyebrow="Single player" title="Play">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <HubTile
              testId="geo-solo-card"
              tone="screen"
              image={region.preview ?? region.map.src}
              icon={<MapPinIcon className="h-5 w-5" />}
              label={`Solo · ${region.name}`}
              title="Classic game"
              blurb="Your map, 3 to 10 rounds, any difficulty, a timer if you like. Then challenge a friend to beat you."
              stat={bestGame ? `Best ${fmt(bestGame)}` : null}
              action={
                <Button variant="outline" className="w-full" onClick={toSolo} data-testid="geo-solo-setup">
                  <SlidersHorizontal className="h-4 w-4" aria-hidden /> Set up a game
                </Button>
              }
            />
            <HubTile
              testId="geo-daily-card"
              tone="warning"
              image={dailyMap?.map.src ?? WORLD_MAP_SRC}
              icon={<Compass className="h-5 w-5" />}
              label={`Daily ${today ? `#${dailyNumber(today)}` : ""}${dailyMap ? ` · ${dailyMap.name}` : ""}`}
              title="Daily game"
              badge={dailyDone !== undefined ? <TileFlag tone="success">Played</TileFlag> : undefined}
              blurb={
                dailyDone !== undefined
                  ? `You scored ${fmt(dailyDone)} today. Replays don't count for the leaderboard.`
                  : `5 places in ${dailyMap ? where(dailyMap) : "the Pokémon world"}, the same for everyone. Your first game today goes on the daily leaderboard.`
              }
              action={
                <Button
                  className="w-full"
                  disabled={!today || loading}
                  onClick={() => today && void start({ kind: "game", daily: today })}
                  {...warmProps({ kind: "game", daily: today || "today" })}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Compass className="h-4 w-4" aria-hidden />}
                  {dailyDone !== undefined ? "Play again" : "Play today's"}
                </Button>
              }
            />
            <HubTile
              testId="geo-weekly-card"
              tone="success"
              image={weeklyMap ? (weeklyMap.preview ?? weeklyMap.map.src) : null}
              icon={<CalendarRange className="h-5 w-5" />}
              label={week ? `Weekly #${geoWeeklyNumber(week)}${weeklyMap ? ` · ${weeklyMap.name}` : ""}` : "Weekly"}
              title="Weekly Challenge"
              badge={weeklyDone !== undefined ? <TileFlag tone="success">Played</TileFlag> : week ? <TileFlag>Ends in {geoWeeklyLeft(week, Date.now())}</TileFlag> : undefined}
              blurb={
                weeklyDone !== undefined
                  ? `You scored ${fmt(weeklyDone)} this week. Replays are practice; a new map on Monday.`
                  : `5 places on ${weeklyMap ? where(weeklyMap) : "this week's map"}, the same for everyone all week. Your first try goes on the weekly board.`
              }
              action={
                <div className="flex flex-col gap-2">
                  <Button
                    variant="success"
                    className="w-full"
                    disabled={!week || !weeklyMap || loading}
                    onClick={() => void start({ kind: "game", weekly: true })}
                    onPointerEnter={() => prefetch({ kind: "game", weekly: true })}
                    data-testid="geo-weekly-play"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarRange className="h-4 w-4" aria-hidden />}
                    {weeklyDone !== undefined ? "Replay for practice" : "Play this week's"}
                  </Button>
                  {week && (
                    <Link href={`/leaderboard?board=geo&format=${geoWeeklyBoard(week)}`} className="hud-label text-center hover:text-foreground" data-testid="geo-weekly-board">
                      Weekly leaderboard →
                    </Link>
                  )}
                </div>
              }
            />
            <RegionStreakCard />
          </div>

          <Card id="solo" className="scroll-mt-24" data-testid="geo-solo">
            <CardContent className="space-y-4 p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-display text-xl font-bold uppercase">Solo game</h3>
                <Link href="/atlas" className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground">
                  <MapIcon className="h-4 w-4" aria-hidden /> World Atlas
                </Link>
              </div>

              {maps.length > 1 && (
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Map">
                  {maps.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      role="radio"
                      aria-checked={r.id === region.id}
                      onClick={() => chooseRegion(r.id)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors",
                        r.id === region.id ? "border-screen bg-screen/15 text-foreground" : "bg-card text-muted-foreground hover:border-screen/50 hover:text-foreground"
                      )}
                    >
                      {r.id === WORLD_REGION && <Globe2 className="h-3.5 w-3.5" aria-hidden />}
                      {r.name}
                    </button>
                  ))}
                </div>
              )}

              {themed.length > 0 && (
                <div className="space-y-1.5">
                  <p className="hud-label">Themed maps</p>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Themed map">
                    {themed.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        role="radio"
                        aria-checked={r.id === region.id}
                        onClick={() => chooseRegion(r.id)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors",
                          r.id === region.id ? "border-screen bg-screen/15 text-foreground" : "bg-card text-muted-foreground hover:border-screen/50 hover:text-foreground"
                        )}
                      >
                        <Shapes className="h-3.5 w-3.5" aria-hidden />
                        {r.name}
                      </button>
                    ))}
                  </div>
                  {theme && (
                    <p className="text-sm text-muted-foreground" data-testid="geo-theme-blurb">
                      {theme.blurb} {fmt(region.locations)} places across the world, with leaderboards of their own.
                    </p>
                  )}
                </div>
              )}

              <GameFilter region={region} filter={filter} onChange={chooseFilter} />

              <GeoSettingsButton value={settings} onChange={chooseSettings} />

              {(filter.families.length > 0 || filter.era) && (
                <p className="text-sm text-muted-foreground">
                  {filter.families.length ? "Hand-picked games are practice: no leaderboard." : `${GEO_ERA_NAMES[filter.era!]} has leaderboards of its own.`}
                </p>
              )}

              <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:gap-8">
                <RoundsPicker value={playRounds} onChange={setRounds} max={places} label="Rounds in a game" />
                <DifficultyPicker value={difficulty} onChange={setDifficulty} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <ModeCard
                  preview={region.preview ?? region.map.src}
                  icon={<MapPinIcon className="h-5 w-5" aria-hidden />}
                  title={`${playRounds}-round game`}
                  blurb={
                    isWorld
                      ? `${playRounds} places in ${playRounds} different regions, up to ${fmt(maxTotal(playRounds))} points. Then challenge a friend to beat you.`
                      : `${playRounds} places, up to ${fmt(maxTotal(playRounds))} points. Then challenge a friend to beat you.`
                  }
                  stat={bestGame ? `Best ${fmt(bestGame)}` : null}
                  disabled={loading || !filterOk}
                  onClick={() => void start({ kind: "game" })}
                  warm={warmProps({ kind: "game" })}
                />
                <ModeCard
                  preview={region.map.src}
                  icon={<Flame className="h-5 w-5" aria-hidden />}
                  title="Streak"
                  blurb={
                    isWorld
                      ? "Pin the right region, again and again. One miss and it's over."
                      : "Pin the exact place, again and again. One miss and it's over."
                  }
                  stat={bestStreak ? `Best ${bestStreak} in a row` : null}
                  disabled={loading || !filterOk}
                  onClick={() => void start({ kind: "streak" })}
                  warm={warmProps({ kind: "streak" })}
                />
              </div>
            </CardContent>
          </Card>
        </HubSection>

        {/* ---- Multiplayer ---- */}
        <HubSection id="multiplayer" eyebrow="Head to head" title="Multiplayer">
          <div className="grid gap-4 sm:grid-cols-3">
            <HubTile
              testId="geo-duels-card"
              tone="screen"
              icon={<Swords className="h-5 w-5" />}
              label={`Casual · ${region.name}`}
              title="Duels"
              blurb="HP battle or points race on any map: send a friend the link, or find an opponent."
              action={
                <Button variant="outline" className="w-full" onClick={() => openDuels("casual")} data-testid="geo-open-duels">
                  <Swords className="h-4 w-4" aria-hidden /> Open duels
                </Button>
              }
            />
            <HubTile
              testId="geo-ranked-tile"
              tone="warning"
              icon={<Trophy className="h-5 w-5" />}
              label="Rated · World map"
              title="Ranked"
              blurb="Rated duels on the world map: climb from Poké Ball to Beast Ball."
              action={
                <Button variant="outline" className="w-full" onClick={() => openDuels("ranked")} data-testid="geo-open-ranked">
                  <Trophy className="h-4 w-4" aria-hidden /> Open ranked
                </Button>
              }
            />
            <HubTile
              testId="geo-party-card"
              tone="primary"
              icon={<Users className="h-5 w-5" />}
              label="Friends · up to 16"
              title="Party"
              badge={<TileFlag tone="success">New</TileFlag>}
              blurb="A private room for your group: Battle Royale on lives, or 2v2 team duels."
              action={
                <Button variant="outline" className="w-full" onClick={openParty} data-testid="geo-open-party">
                  <Users className="h-4 w-4" aria-hidden /> Open party
                </Button>
              }
            />
          </div>
          <div id="duels" className="scroll-mt-24">
            {/* Duels play an era when the map has enough of it (hand-picked games are practice), else every game. */}
            <DuelCard
              region={region}
              places={places}
              era={filter.era && filterPlaces(region, { era: filter.era, families: [] }) >= GEO_FILTER_MIN_PLACES ? filter.era : undefined}
              queue={duelQueue}
              onQueue={setDuelQueue}
            />
          </div>
          {partyOpen && (
            <div id="party" className="scroll-mt-24 space-y-3">
              <h3 className="font-display text-xl font-bold uppercase">Party</h3>
              <PartyCard region={region} />
            </div>
          )}
        </HubSection>

        {/* ---- Maps ---- */}
        <HubSection id="maps" eyebrow="Official maps" title="Maps" aside={<p className="text-sm text-muted-foreground">Pick a map to set up a solo game on it.</p>}>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="geo-map-gallery">
            {maps.map((r) => (
              <MapTile key={r.id} map={r} selected={r.id === region.id} onPick={() => pickMap(r.id)} />
            ))}
          </ul>
          {themed.length > 0 && (
            <>
              <p className="hud-label pt-2">Themed maps · the whole world, one kind of place</p>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {themed.map((r) => (
                  <MapTile key={r.id} map={r} selected={r.id === region.id} onPick={() => pickMap(r.id)} />
                ))}
              </ul>
            </>
          )}
          <div className="grid gap-4 pt-2 lg:grid-cols-2">
            <Card className="overflow-hidden border-primary/40" data-testid="globe-card">
              <CardContent className="flex flex-col items-center gap-4 p-5 sm:flex-row">
                <GlobePreview />
                <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
                  <p className="hud-label text-primary">3D · Explore</p>
                  <p className="font-display text-2xl font-bold uppercase">World Globe</p>
                  <p className="text-sm text-muted-foreground">Spin the whole Pokémon world in 3D and zoom from regions down to every route.</p>
                  <Link href="/guessr/globe" className={cn(buttonVariants(), "w-full sm:w-auto")}>
                    Open the globe
                  </Link>
                </div>
              </CardContent>
            </Card>
            <Card className="overflow-hidden">
              <CardContent className="flex h-full flex-col justify-center gap-2 p-5 text-center sm:text-left">
                <p className="hud-label text-screen">Study · Every place</p>
                <p className="font-display text-2xl font-bold uppercase">World Atlas</p>
                <p className="text-sm text-muted-foreground">Every town, route and landmark on the maps, with the games each one is in.</p>
                <Link href="/atlas" className={cn(buttonVariants({ variant: "outline" }), "w-full sm:w-auto sm:self-start")}>
                  <MapIcon className="h-4 w-4" aria-hidden /> Open the atlas
                </Link>
              </CardContent>
            </Card>
          </div>
        </HubSection>

        {/* ---- You ---- */}
        <GeoYou progress={mine} />

        <p className="text-center text-xs text-muted-foreground">
          Screenshots from{" "}
          <a href="https://bulbapedia.bulbagarden.net" className="underline underline-offset-2" target="_blank" rel="noreferrer">
            Bulbapedia
          </a>
          , the{" "}
          <a href="https://pokemon.fandom.com" className="underline underline-offset-2" target="_blank" rel="noreferrer">
            Pokémon Wiki
          </a>
          ,{" "}
          <a href="https://www.pokepedia.fr" className="underline underline-offset-2" target="_blank" rel="noreferrer">
            Poképédia
          </a>{" "}
          and{" "}
          <a href="https://www.pokewiki.de" className="underline underline-offset-2" target="_blank" rel="noreferrer">
            PokéWiki
          </a>
          . Pokémon game imagery © Nintendo / Game Freak / The Pokémon Company.{" "}
          <Link href="/atlas" className="underline underline-offset-2">
            Explore the world atlas
          </Link>
          .
        </p>
      </div>
    );
  }

  if (phase === "error" || !game) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="space-y-4 p-6 text-center">
          <p className="font-display text-xl font-bold uppercase">Something went wrong</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={() => setPhase("setup")}>Back to PokéGuessr</Button>
        </CardContent>
      </Card>
    );
  }

  if (phase === "results") {
    const last = played[played.length - 1]?.graded;
    const GeoResults = loaded.GeoResults ?? LazyResults;
    const GeoSummary = loaded.GeoSummary ?? LazySummary;
    return (
      <GeoResults game={game} played={played} pinImage={pinImage} shareToken={last?.resultToken} onRestart={() => setPhase("setup")}>
        <GeoSummary
          game={game}
          played={played}
          resultToken={last?.resultToken}
          challengeToken={last?.challengeToken}
          challenge={isChallenge ? challenge : undefined}
          reward={reward}
          onRestart={() => setPhase("setup")}
          compact
        />
      </GeoResults>
    );
  }

  const isStreak = game.kind === "streak";
  const roundNumber = played.length + (phase === "revealed" ? 0 : 1);
  const modeLine = [
    game.region.name,
    game.filter.families.length ? "Picked games" : game.filter.era ? GEO_ERA_NAMES[game.filter.era] : null,
    game.daily ? `Daily #${dailyNumber(game.daily)}` : null,
    game.weekly ? `Weekly #${geoWeeklyNumber(game.weekly)}` : null,
    game.difficulty ? GEO_DIFFICULTY_NAMES[game.difficulty] : null,
  ]
    .filter(Boolean)
    .join(" · ");
  /** The top-centre notch: the round (or the streak), the map and mode; the countdown pill hangs under it. */
  const notch = (
    <Notch
      below={timeLeft !== null ? <CountdownPill ms={timeLeft * 1000} totalMs={timer * 1000} urgentMs={10_000} testId="geo-time-left" /> : undefined}
    >
      <div className="min-w-0 text-center">
        <div className="font-display text-xl font-bold uppercase italic leading-none tracking-wide sm:text-2xl" data-testid="geo-round">
          {isStreak ? (
            <span className="inline-flex items-center gap-1.5">
              <Flame className="h-5 w-5 text-warning" aria-hidden /> Streak {streak}
            </span>
          ) : (
            <>
              Round {Math.min(roundNumber, game.rounds)}
              <span className="text-white/50">/{game.rounds}</span>
            </>
          )}
        </div>
        <div className="mt-0.5 truncate font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c8bfff]">{modeLine}</div>
      </div>
    </Notch>
  );
  /** Top-right: the score so far (or the streak), and the help button. */
  const chips = (
    <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
      {!isStreak && (
        <div className="flex h-9 items-center gap-2 rounded-md bg-black/55 px-3 backdrop-blur" data-testid="geo-score-chip">
          <span className="hud-label hidden !text-white/60 sm:inline">Score</span>
          <span className="font-display text-base font-bold tabular-nums text-[#9be15d]">{fmt(total)}</span>
        </div>
      )}
      <HowToHelpButton className="hud-btn !hidden !p-0 !text-white hover:!bg-black/75 hover:!text-white sm:!flex" />
    </div>
  );

  // ---- round result ------------------------------------------------------------
  if (phase === "revealed" && current) {
    return (
      <GameShell onExit={() => setPhase("setup")}>
        {() => <RoundReveal game={game} current={current} round={roundNumber} streak={streak} pinImage={pinImage} onNext={next} onExit={() => setPhase("setup")} />}
      </GameShell>
    );
  }

  // ---- guessing ------------------------------------------------------------------
  const views = visibleViews(roundViewsOf(game.round), game.settings);
  const zoom = game.settings.zoomed ? (src: string) => ({ scale: GEO_ZOOM, origin: zoomOrigin(src) }) : undefined;
  const zoomedView = zoom?.(views[viewIndex] ?? game.round.shot);
  return (
    <GameShell onExit={() => setPhase("setup")}>
      {({ fs, toggle }) => (
    <div className="relative h-full">
      <div className="absolute inset-0">
        <ShotCarousel views={views} index={viewIndex} onIndex={setViewIndex} onZoom={() => setZoomed(true)} zoom={zoom} fs blur={game.round.blur} priority={game.round.index === 0} />
      </div>
      <div className="absolute left-3 top-3 z-20 flex items-center gap-2">
        <ExitButton onClick={() => setPhase("setup")} />
        <FullscreenButton fs={fs} onClick={toggle} />
      </div>
      {notch}
      {chips}

      {/* GeoGuessr-style mini-map (the atlas): docked bottom-right, grows on hover; a bottom sheet on phones. */}
      <MapDock aspect={mapAspect(game.region)}
        hasPin={!!pick}
        map={({ fill }) => (
          <GeoMap
            region={game.region}
            pick={pick}
            pinImage={pinImage}
            fill={fill}
            onPick={(p) => {
              setPick(p);
              play("pin");
            }}
          />
        )}
        extra={game.guessGame && pick ? <GameGuessPicker options={gameGuessOptions(game.region, game.filter)} value={gamePick} onChange={setGamePick} /> : undefined}
        button={<GuessButton hasPin={!!pick} busy={phase === "submitting"} disabled={phase === "submitting"} onClick={() => void guess()} />}
      />

      <AnimatePresence>
        {zoomed && (
          <motion.div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setZoomed(false)}
            role="dialog"
            aria-label="Screenshot, full screen"
          >
            <div className="max-h-full max-w-full overflow-hidden rounded-md">
              {/* eslint-disable-next-line @next/next/no-img-element -- same cached screenshot, full size */}
              <img
                src={views[viewIndex] ?? game.round.shot}
                alt="Where is this?"
                onLoad={(e) => setZoomPixelated(shotFit(e.currentTarget).pixelated)}
                className="max-h-[calc(100vh-2rem)] max-w-full object-contain"
                style={{
                  imageRendering: zoomPixelated ? "pixelated" : "auto",
                  ...(zoomedView ? { transform: `scale(${zoomedView.scale})`, transformOrigin: `${zoomedView.origin[0]}% ${zoomedView.origin[1]}%` } : {}),
                }}
              />
            </div>
            <button
              type="button"
              className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
      )}
    </GameShell>
  );
}

/** A map in the hub's Maps section: its preview, name and places; picking it sets up a solo game there. */
function MapTile({ map, selected, onPick }: { map: GeoRegionInfo; selected: boolean; onPick: () => void }) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onPick}
        aria-pressed={selected}
        aria-label={`${map.name}: set up a solo game on this map`}
        data-testid={`geo-map-tile-${map.id}`}
        className={cn(
          "group relative block aspect-[4/3] w-full overflow-hidden rounded-lg border bg-shade/30 text-left transition-colors",
          selected ? "border-screen ring-2 ring-screen/40" : "hover:border-screen/60"
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- CDN-cached preview */}
        <img
          src={map.preview ?? map.map.src}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover opacity-75 transition-[opacity,transform] duration-300 group-hover:scale-[1.04] group-hover:opacity-100"
        />
        <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" aria-hidden />
        <span className="absolute inset-x-0 bottom-0 space-y-0.5 p-2.5">
          <span className="flex items-center gap-1.5 font-display text-base font-bold uppercase leading-tight text-white sm:text-lg">
            {map.id === WORLD_REGION ? <Globe2 className="h-4 w-4 shrink-0" aria-hidden /> : map.theme ? <Shapes className="h-4 w-4 shrink-0" aria-hidden /> : null}
            <span className="min-w-0 break-words">{map.name}</span>
          </span>
          <span className="block font-pixel text-[9px] uppercase tracking-wider text-white/75">{fmt(map.locations)} places</span>
        </span>
        {selected && (
          <span className="absolute right-2 top-2 rounded-sm bg-screen px-1.5 py-1 font-pixel text-[9px] uppercase leading-none text-background" aria-hidden>
            Selected
          </span>
        )}
      </button>
    </li>
  );
}

function ModeCard({
  preview,
  icon,
  title,
  blurb,
  stat,
  disabled,
  onClick,
  warm,
}: {
  preview: string;
  icon: React.ReactNode;
  title: string;
  blurb: string;
  stat: string | null;
  disabled: boolean;
  onClick: () => void;
  /** Hover / focus handlers that get the game ready ahead of the click. */
  warm?: { onPointerEnter: () => void; onFocus: () => void };
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      {...warm}
      className="menu-item group flex flex-col gap-3 overflow-hidden rounded-lg border bg-card p-4 text-left transition-colors hover:border-screen/60"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- CDN-cached preview */}
      <img
        src={preview}
        alt=""
        className="aspect-[16/10] w-full rounded-sm bg-shade/30 object-cover opacity-85 transition-opacity group-hover:opacity-100"
      />
      <span className="flex items-center gap-2 text-screen">
        {icon}
        <span className="font-display text-2xl font-bold uppercase text-foreground">{title}</span>
      </span>
      <span className="text-sm text-muted-foreground">{blurb}</span>
      {stat && <span className="hud-label text-warning">{stat}</span>}
    </button>
  );
}

/** The camera fits the guess and the answer this long (ms), after the line has drawn. */
const FIT_MS = 800;
/** The score counts up over this long once the camera has settled. */
const SCORE_COUNT_MS = 1000;

/**
 * The round result, GeoGuessr's October 2026 classic layout: a full-bleed
 * result map (the line draws, then the camera fits both points), with a
 * bottom bar holding the score counting up over its 0–5,000 bar, the
 * distance pill, the place (name, region and game with the round's own
 * screenshot as its artwork) and Next.
 */
function RoundReveal({
  game,
  current,
  round,
  streak,
  pinImage,
  onNext,
  onExit,
}: {
  game: Game;
  current: Played;
  round: number;
  streak: number;
  pinImage?: string;
  onNext: () => void;
  onExit: () => void;
}) {
  const { graded, guess: g } = current;
  const reduced = useReducedMotion();
  const LearnCard = loaded.LearnCard ?? LazyLearn;
  const ReportShot = loaded.ReportShot ?? LazyReport;
  const countDelay = reduced ? 0 : LINE_DRAW_MS + FIT_MS * 0.6;
  const shown = useCountUp(graded.score, SCORE_COUNT_MS, countDelay, true);
  const isStreak = game.kind === "streak";
  const isWorld = isWorldwide(game.region.id);
  const roundNumber = Math.min(game.rounds, round);
  const bar = { initial: { width: 0 }, animate: { width: `${(graded.score / GEO_MAX_ROUND_SCORE) * 100}%` }, transition: { duration: reduced ? 0 : SCORE_COUNT_MS / 1000, delay: reduced ? 0 : countDelay / 1000, ease: "easeOut" as const } };
  const rise = (delay: number) => ({ initial: reduced ? false : { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, delay: reduced ? 0 : delay, ease: [0.2, 0.8, 0.2, 1] as const } });
  return (
    <div className="relative h-full" data-testid="geo-reveal">
      <div className="absolute inset-x-0 top-0 bottom-[8.5rem] md:bottom-[6.75rem]">
        <GeoMap region={game.region} revealed={[{ guess: g, answer: graded.answer, image: pinImage }]} fit={{ delay: LINE_DRAW_MS, duration: FIT_MS }} fill controls={false} />
      </div>
      <div className="absolute left-3 top-3 z-20">
        <ExitButton onClick={onExit} />
      </div>
      <Notch>
        <div className="text-center">
          <div className="font-display text-xl font-bold uppercase italic leading-none tracking-wide sm:text-2xl">{isStreak ? `Streak ${streak}` : `Round ${roundNumber}`}</div>
          <div className="mt-0.5 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c8bfff]">{game.region.name}</div>
        </div>
      </Notch>

      {/* The bottom bar. */}
      <motion.div {...rise(0.15)} className="absolute inset-x-0 bottom-0 z-20 border-t-4 border-[#a99cff] bg-[#1e1a3f]/95 text-white shadow-[0_-12px_40px_rgba(0,0,0,0.5)] backdrop-blur">
        <div className="mx-auto grid max-w-6xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6 md:grid-cols-[1fr_auto_1fr]">
          {/* The score (or the streak) and its bar. */}
          <div className="min-w-0 text-center md:text-left">
            {isStreak ? (
              <>
                <p className={cn("hud-label", graded.hit ? "!text-[#9be15d]" : "!text-[#ff5a5a]")}>
                  {graded.hit ? (isWorld ? "Right region!" : "Correct!") : isWorld ? "Wrong region. Streak over" : "Streak over"}
                </p>
                <p className="flex items-center justify-center gap-2 font-display text-4xl font-bold italic md:justify-start">
                  {graded.hit ? <Check className="h-8 w-8 text-[#9be15d]" aria-hidden /> : <X className="h-8 w-8 text-[#ff5a5a]" aria-hidden />}
                  {graded.hit ? `${streak} in a row` : `Final streak: ${streak}`}
                </p>
              </>
            ) : (
              <>
                <p className="hud-label !text-[#c8bfff]">{verdict(graded.score)}</p>
                <p className="geo-glow font-display text-4xl font-bold italic tabular-nums sm:text-5xl" data-testid="geo-round-score">
                  {fmt(shown)} <span className="text-lg not-italic text-white/60">pts</span>
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="meter h-2 flex-1 !bg-black/40">
                    <motion.div className="h-full bg-[#9be15d]" {...bar} />
                  </div>
                  <span className="font-pixel text-[9px] text-white/50">{fmt(GEO_MAX_ROUND_SCORE)}</span>
                </div>
              </>
            )}
            {graded.gameGuess && (
              <p className={cn("mt-1 text-sm font-semibold", graded.gameGuess.correct ? "text-[#9be15d]" : "text-white/60")} data-testid="geo-game-bonus">
                {graded.gameGuess.correct
                  ? `Right game! +${fmt(graded.gameGuess.bonus)} bonus`
                  : graded.gameGuess.guessed
                    ? `Not ${geoFamily(graded.gameGuess.guessed).name}: no bonus`
                    : `No game named: no bonus (worth ${fmt(GEO_GAME_BONUS)})`}
              </p>
            )}
          </div>

          {/* The distance pill and the place. */}
          <motion.div {...rise(reduced ? 0 : (LINE_DRAW_MS + FIT_MS) / 1000)} className="flex min-w-0 flex-col items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border-2 border-[#a99cff] bg-[#4cbb17] px-4 py-1.5 font-display text-sm font-bold uppercase italic tracking-wide text-white shadow-lg" data-testid="geo-distance">
              <MapPinIcon className="h-4 w-4" aria-hidden />
              {graded.timedOut ? "Time's up: no pin down" : distanceText(graded.answer.squares)}
            </span>
            {/* The learn card: the place, its game, one fact from the Pokédex's place data, and where to read more. */}
            <LearnCard answer={graded.answer} shot={current.shot} map={game.region} />
          </motion.div>

          {/* Next, with its hotkey, and the report link. */}
          <div className="flex flex-col items-center gap-1.5 md:items-end">
            <button
              type="button"
              onClick={onNext}
              data-testid="geo-next"
              className="flex h-12 w-full max-w-xs items-center justify-center gap-2 rounded-md bg-[#4cbb17] px-6 font-display text-base font-bold uppercase tracking-wider text-white shadow-lg transition-[background-color,transform] hover:bg-[#58d01c] active:scale-[0.98]"
            >
              {graded.done ? (isStreak ? "See results" : "View summary") : "Next round"} ▶
              <kbd aria-hidden className="ml-1 hidden rounded border border-white/40 px-1.5 text-[10px] font-normal normal-case sm:inline">Space</kbd>
            </button>
            <div className="text-white/60 [&_button]:text-white/60 [&_button:hover]:text-white">
              <ReportShot key={current.shot} shot={current.shot} mode={game.daily ? "daily" : "solo"} />
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
