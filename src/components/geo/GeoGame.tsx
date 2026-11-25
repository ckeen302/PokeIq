"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "@/components/ui/Link";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Clock, Flame, Globe2, Loader2, Shapes, MapPin as MapPinIcon, Swords, Trophy, Users, X, Map as MapIcon } from "lucide-react";
import { GEO_FILTER_MIN_PLACES, GEO_MAX_ROUND_SCORE, GEO_ROUNDS, WORLD_REGION, isGeoRounds, type GeoRounds, geoBoardKey, geoDailyRegion, geoMapRank, type GeoChallenge, type GeoGuessResponse, type GeoKind, type GeoRegionInfo, type GeoRoundPublic, type GeoStartResponse } from "@/lib/geo-types";
import { dailyNumber } from "@/lib/daily";
import { useToday } from "@/lib/use-today";
import { recordGeoGame, useProgress, type BadgeDef } from "@/lib/progress";
import { play, unlockAudio } from "@/lib/sound";
import { useGuessrMusic } from "@/lib/use-guessr-music";
import { guessrSquare } from "@/lib/share";
import type { GeoDifficulty } from "@/lib/geo-difficulty";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { mapReady } from "@/components/atlas/atlas-engine";
import { GeoMap, LINE_DRAW_MS, WORLD_MAP as WORLD_MAP_SRC, WORLD_THUMB, mapAspect, type MapPin } from "./GeoMap";
import { useAccount } from "@/lib/account";
import { avatarSrc } from "@/lib/avatar";
import { GlobePreview } from "@/components/globe/GlobePreview";
import { GeoHowToLoader, HowToHelpButton } from "./GeoHowToButton";
import { HubSection, HubTile, TileFlag } from "./HubParts";
import { GeoYou } from "./GeoYou";
import { HubTop } from "./HubTop";
import { geoDailyStreak } from "@/lib/progress";
import { previousDate } from "@/lib/daily";
import { GEO_REGION_STREAK_KEY } from "@/lib/geo-streak-types";
import { AchievementToasts, useGeoProgress, type MyGeoProgress } from "./GeoAchievements";
import { achievementCloser } from "@/lib/geo-achievements";
import type { DuelQueue } from "./DuelCard";
import { geoWeekOf, geoWeeklyLeftParts, geoWeeklyMap, geoWeeklyNumber } from "@/lib/geo-weekly";

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
/** A round's picture that fails to load is asked for again this long after each failure (ms), then the round offers a retry. */
const SHOT_RETRIES = [1000, 2000, 4000];
/** A game got ready on hover is used for a click this soon after. */
const PREFETCH_TTL_MS = 60_000;
/** The likeliest game is started ahead this long after the page has loaded, clear of its first paints. */
const WARM_AFTER_LOAD_MS = 2000;
import { ShotCarousel, shotFit } from "./ShotCarousel";
import { BAR_BTN, ConfirmExit, CountdownPill, ExitButton, FullscreenButton, GameShell, GuessButton, HudDials, MapDock, Notch, RoundBadge, RoundReadout, ScoreTracker, TimerDial, usePhone } from "./GameShell";
import { roundViewsOf } from "@/lib/geo-look";
import { DifficultyPicker, GeoSettingsButton, RoundsPicker, TimerPicker } from "./GeoSettings";
import { DEFAULT_GEO_SETTINGS, GEO_DEFAULT_TIMER, GEO_ZOOM, readGeoSettings, rememberGeoSettings, visibleViews, zoomOrigin, type GeoPlaySettings, type GeoTimer } from "@/lib/geo-settings";
import { GameFilter, GameGuessPicker, type FilterChoice, filterPlaces, gameGuessOptions } from "./GameFilter";
import { GEO_GAME_BONUS, geoFamily, type GeoEra, type GeoFamilyId } from "@/lib/geo-families";
import { cn } from "@/lib/utils";
import { preloadImage } from "@/lib/preload";
import { readSeenShots, rememberSeenShot } from "@/lib/geo-seen";
import { isWorldwide, themeOf } from "@/lib/geo-themes";
import { useT } from "@/i18n/client";
import { type Translator } from "@/i18n/catalog";
import { formatNumber } from "@/i18n/format";
import geoNs from "@/messages/geo";
import geoSolo from "@/messages/geo-solo";
import geoNamesNs from "@/messages/geo-names";
import { useGeoNames, type GeoLocal } from "@/lib/geo-i18n-client";

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
  /** The personal best before this game (none before a first game). */
  previous?: number;
  newBadges: BadgeDef[];
}

export const fmt = (n: number) => n.toLocaleString("en-US");
export const maxTotal = (rounds: number) => rounds * GEO_MAX_ROUND_SCORE;

export const emoji = guessrSquare;

type SoloT = Translator<typeof geoSolo.en>;

function verdict(score: number, t: SoloT): string {
  if (score >= GEO_MAX_ROUND_SCORE) return t("verdict.spotOn");
  if (score >= 4000) return t("verdict.close");
  if (score >= 2500) return t("verdict.notBad");
  if (score >= 1000) return t("verdict.near");
  return t("verdict.wayOff");
}

const playable = (region: GeoRegionInfo | undefined) => (region?.locations ?? 0) >= GEO_ROUNDS;
/** "Same 5 places in the Pokémon world / on the Gyms map / in Kanto, same screenshots." */
const sameText = (t: SoloT, names: GeoLocal, n: number, map?: GeoRegionInfo) =>
  !map ? t("hub.challenge.same", { n }) : map.id === WORLD_REGION ? t("hub.challenge.sameWorld", { n }) : map.theme ? t("hub.challenge.sameTheme", { n, map: names.map(map) }) : t("hub.challenge.sameRegion", { n, map: names.map(map) });

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


function distanceText(squares: number, t: SoloT): string {
  if (squares === 0) return t("reveal.rightOn");
  return t("reveal.squares", { n: squares, d: formatNumber(squares, t.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
}

/** A request the server turned down, with its reason's code when it gives one ("daily-started"). */
class ApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

export async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const { error, code } = data as { error?: string; code?: unknown };
    throw new ApiError(error ?? `Request failed (${res.status})`, typeof code === "string" ? code : undefined);
  }
  return data as T;
}

/** A request that failed on the way (no answer, or the server's own trouble): worth sending again. */
class Blip extends Error {}
/**
 * POSTs, sending the same request again after a network blip or a server
 * error (0.5 s, 1 s, 2 s apart). A guess is safe to send twice: the server
 * answers an identical one with the same result.
 */
async function postRetrying<T>(url: string, body: unknown, waits = [500, 1000, 2000]): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch((e: unknown) => {
        throw new Blip(e instanceof Error ? e.message : "network");
      });
      const data = await res.json().catch(() => ({}));
      if (res.status >= 500) throw new Blip(`Request failed (${res.status})`);
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
      return data as T;
    } catch (err) {
      if (!(err instanceof Blip) || i >= waits.length) throw err;
      await new Promise((r) => setTimeout(r, waits[i]));
    }
  }
}

// ---- a game in progress, kept through a reload --------------------------------

/**
 * A game in progress, saved after every step: this tab's (sessionStorage), and
 * the Daily's and the Weekly's for the rest of their day or week
 * (localStorage). Those are played once: a finished one stays saved, to show
 * its result again.
 */
interface SavedGame {
  v: 1;
  savedAt: number;
  game: Omit<Game, "region"> & { region: string };
  played: Played[];
  /** "done": a Daily or a Weekly played to the end. */
  phase: "guessing" | "revealed" | "done";
  pick: MapPin | null;
  /**
   * When the round's clock started (its picture first showed), so a reload never gives a fresh clock.
   * `left`: the clock stopped with this much time on it (ms), as a Daily or a Weekly was left; it goes on from there.
   */
  clock: RoundClock | null;
  challenge: boolean;
  /** A guess sent but not yet answered: sent again (the server replays it) on resume. */
  pending?: Record<string, unknown>;
}
type RoundClock = { shot: string; at: number; left?: number };
const SAVE_KEY = "pokeiq:geo-game";
/** The Daily's and the Weekly's own copies. */
const KEPT_KEYS = { daily: "pokeiq:geo-daily-game", weekly: "pokeiq:geo-weekly-game" } as const;
type Kept = keyof typeof KEPT_KEYS;
/** A game kept on the device for its day or week (the Daily, the Weekly), or null. */
const keptOf = (game: { daily?: string; weekly?: string } | null | undefined): Kept | null => (game?.daily ? "daily" : game?.weekly ? "weekly" : null);
/** A game's signed state lasts three hours on the server; a save is kept a little less (the Daily's and the Weekly's, their day or week). */
const SAVE_TTL_MS = 2.5 * 60 * 60 * 1000;

function readSaved(store: "session" | Kept): SavedGame | null {
  try {
    const raw = store === "session" ? sessionStorage.getItem(SAVE_KEY) : localStorage.getItem(KEPT_KEYS[store]);
    const saved = raw ? (JSON.parse(raw) as SavedGame) : null;
    // A Daily's or a Weekly's date is checked where it's picked up.
    return saved?.v === 1 && (keptOf(saved.game) || Date.now() - saved.savedAt < SAVE_TTL_MS) ? saved : null;
  } catch {
    return null;
  }
}
function writeSaved(saved: SavedGame | null, kept?: Kept | null) {
  try {
    if (saved) {
      const raw = JSON.stringify(saved);
      sessionStorage.setItem(SAVE_KEY, raw);
      if (kept) localStorage.setItem(KEPT_KEYS[kept], raw);
    } else {
      sessionStorage.removeItem(SAVE_KEY);
      if (kept) localStorage.removeItem(KEPT_KEYS[kept]);
    }
  } catch {
    // Private mode or full: the game just isn't kept through a reload.
  }
}
/** A Daily or a Weekly played to the end: kept on the device (its card shows the result again), out of the tab's copy. */
function keepFinished(saved: SavedGame, kept: Kept) {
  try {
    sessionStorage.removeItem(SAVE_KEY);
    localStorage.setItem(KEPT_KEYS[kept], JSON.stringify({ ...saved, phase: "done", pick: null, clock: null, pending: undefined, savedAt: Date.now() } satisfies SavedGame));
  } catch {
    // Private mode or full.
  }
}
/** A finished Daily's or Weekly's score as saved here (undefined while it's still being played). */
const savedScore = (saved: SavedGame | undefined) => (saved?.phase === "done" ? saved.played.reduce((sum, p) => sum + p.graded.score, 0) : undefined);
/** The ms a round's clock shows: stopped (`left`), else counted from its start. */
const clockLeft = (clock: RoundClock, timerMs: number, now = Date.now()) => (clock.left !== undefined ? clock.left : Math.max(0, clock.at + timerMs - now));

/**
 * The Daily's or the Weekly's round clock on the server, as the player leaves
 * (the request may outlive the page: the server keeps the pause in a cookie)
 * and comes back (the token going on from the pause, and its time left).
 */
function pauseOnServer(token: string, left: number | undefined): Promise<unknown> {
  return fetch("/api/geo/clock", {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, action: "pause", ...(left !== undefined ? { left: Math.round(left) } : {}) }),
  }).catch(() => undefined);
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
  /** Set on /pokeguessr/c/<token>: a friend's game to replay. */
  challenge?: GeoChallenge & { token: string; region: string; era?: GeoEra; families?: GeoFamilyId[]; difficulty?: "easy" | "hard" };
}

/** A tile or card picture is a few hundred pixels across: the world map's small copy stands in for the 5,850 px original. */
const tileImage = (src: string) => (src === WORLD_MAP_SRC ? WORLD_THUMB : src);

export function GeoGame(props: GeoGameProps) {
  // The player's achievements and mastery (the hub's You section), read again after each game: the end screen shows what it earned.
  const { progress, fresh, refresh, dismiss } = useGeoProgress();
  // On the end screen they're among its rows instead of toasts (which would sit on its buttons).
  const [ending, setEnding] = useState(false);
  return (
    <>
      <GeoGameInner {...props} mine={progress} onGameOver={refresh} fresh={fresh} onSeen={dismiss} onEnding={setEnding} />
      {!props.challenge && <GeoHowToLoader />}
      <AchievementToasts ids={ending ? [] : fresh} onDismiss={dismiss} />
    </>
  );
}

function GeoGameInner({
  regions: allRegions,
  challenge,
  mine,
  onGameOver,
  fresh,
  onSeen,
  onEnding,
}: GeoGameProps & { mine: MyGeoProgress | null; onGameOver: () => void; fresh: string[]; onSeen: (id: string) => void; onEnding: (on: boolean) => void }) {
  const t = useT(geoSolo);
  const g = useT(geoNs);
  const names = useGeoNames();
  const gn = useT(geoNamesNs);
  const fmt = (n: number) => formatNumber(n, t.locale);
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
  /** When the round's clock started: the moment its picture was first on screen (kept through a reload); or, stopped, its time left. */
  const [clock, setClock] = useState<RoundClock | null>(null);
  /**
   * The Daily's or the Weekly's round clock is stopped: the page is hidden or
   * going, the game was left, or a game picked up again waits for the server
   * to start the clock again. No guess goes until it has.
   */
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const setPausedBoth = (on: boolean) => {
    pausedRef.current = on;
    setPaused(on);
  };
  /** The picture that has loaded and decoded (the clock waits for it), and the tries at the round's picture so far. */
  const [readyShot, setReadyShot] = useState<string | null>(null);
  const [shotTry, setShotTry] = useState<{ shot: string; n: number; failed?: boolean }>({ shot: "", n: 0 });
  /** The hub as it was when the game started (kept as is under the game). */
  const hubUnderGame = useRef<React.ReactElement | null>(null);
  /** "Leave this game?" is up. */
  const [confirmExit, setConfirmExit] = useState(false);
  /** A guess on its way, kept so a reload can send it again. */
  const pendingGuess = useRef<Record<string, unknown> | null>(null);
  const [now, setNow] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const phone = usePhone();
  const [reward, setReward] = useState<Reward | null>(null);
  /** The achievements as read before the end screen (the end screen shows what changed once they're read again after it). */
  const endBase = useRef<{ fresh: string[]; mine: MyGeoProgress | null }>({ fresh: [], mine: null });
  function toResults() {
    endBase.current = { fresh, mine };
    setPhase("results");
  }
  const [isChallenge, setIsChallenge] = useState(false);
  const [filter, setFilter] = useState<FilterChoice>({ era: undefined, families: [] });
  const [gamePick, setGamePick] = useState<string | null>(null);
  const [rounds, setRounds] = useState<GeoRounds>(5);
  const [difficulty, setDifficulty] = useState<GeoDifficulty>("normal");
  const [duelQueue, setDuelQueue] = useState<DuelQueue>("casual");
  /** The solo game's setup (maps, games, rounds, difficulty): folded away under "Set up a game" until asked for. */
  const [soloOpen, setSoloOpen] = useState(false);
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

  // /pokeguessr?region=johto opens on that map (the atlas links here).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("region");
    if (id && !challenge && regions.some((r) => r.id === id)) setRegionId(id);
    const era = params.get("era");
    if (era === "2d" || era === "3d") setFilter({ era, families: [] });
    // A link to a map, a set of games or the setup itself opens the setup, so the pick shows.
    if ((id && !challenge && regions.some((r) => r.id === id)) || era === "2d" || era === "3d" || window.location.hash === "#solo") setSoloOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read the URL once
  }, []);


  // ---- kept through a reload, Back and Exit ------------------------------------------
  /** The game as last saved: each step patches it. */
  const snap = useRef<SavedGame | null>(null);
  function save(patch: Partial<Omit<SavedGame, "game">> & { game?: Game }) {
    if (!snap.current) return;
    const { game: g, ...rest } = patch;
    snap.current = { ...snap.current, ...rest, ...(g ? { game: { ...g, region: g.region.id } } : {}), savedAt: Date.now() };
    writeSaved(snap.current, keptOf(snap.current.game));
  }
  function startSaving(g: Game, isChallenge: boolean) {
    snap.current = { v: 1, savedAt: Date.now(), game: { ...g, region: g.region.id }, played: [], phase: "guessing", pick: null, clock: null, challenge: isChallenge };
    writeSaved(snap.current, keptOf(g));
  }
  useEffect(() => {
    if (game && phase === "guessing") save({ pick });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- saved as the pin moves
  }, [pick]);

  /**
   * Back stays in the game: starting one adds a history entry, and Back
   * (which takes it off) puts it back and asks "Leave this game?" instead.
   */
  const inHistory = useRef(false);
  /** Each start (and each exit) gets a new number: a start that comes back after its game was left is dropped. */
  const startRun = useRef(0);
  const ignorePop = useRef(false);
  function enterGameHistory() {
    if (inHistory.current) return;
    window.history.pushState({ ...(window.history.state ?? {}), geoGame: true }, "");
    inHistory.current = true;
  }
  function leaveGameHistory() {
    if (!inHistory.current) return;
    inHistory.current = false;
    ignorePop.current = true;
    window.history.back();
  }
  const inGame = phase === "loading" || phase === "guessing" || phase === "submitting" || phase === "revealed" || (phase === "error" && !!game);
  const inGameRef = useRef(inGame);
  inGameRef.current = inGame;
  // The music plays while a game is on (its rounds and the results between them), not on the hub or the final results.
  useGuessrMusic(inGame);
  useEffect(() => {
    const onPop = () => {
      if (ignorePop.current) {
        ignorePop.current = false;
        return;
      }
      inHistory.current = false;
      if (!inGameRef.current) return;
      enterGameHistory();
      setConfirmExit(true);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** Exit (the button, Escape, Back): asks first while a game is under way. */
  function requestExit() {
    if (phase === "guessing" || phase === "submitting" || phase === "revealed") setConfirmExit(true);
    else exitGame();
  }
  function exitGame() {
    // A game still starting is called off.
    startRun.current++;
    setConfirmExit(false);
    // The Daily and the Weekly stay saved, their round's clock stopped (the card offers to resume them); any other game is let go.
    const kept = keptOf(game);
    if (kept) stopClock();
    writeSaved(null, null);
    if (!kept) snap.current = null;
    leaveGameHistory();
    setPhase("setup");
    if (kept) readKeptSaves();
  }

  // ---- the Daily and the Weekly: played once, left and picked up with the round's clock where it was ----
  const stateRef = useRef({ game, phase, clock, timer: 0 });
  /** The player is away (the page hidden or going, the game left): the server has been asked to stop the clock. */
  const awayRef = useRef<{ left: number | undefined } | null>(null);
  /** A pause on its way to the server (a resume waits for it), and a resume on its way (a pause waits for it): they land in order. */
  const pausing = useRef<Promise<unknown> | null>(null);
  const resuming = useRef(false);
  /** Stops the round's clock as the player goes: here, in the saves, and on the server. */
  function stopClock() {
    const { game, phase, clock, timer } = stateRef.current;
    if (!game || !keptOf(game) || awayRef.current || !(phase === "guessing" || phase === "submitting" || phase === "revealed")) return;
    setPausedBoth(true);
    // The round's own clock, once its picture is up (a round result being read: the next round's hasn't started).
    const left = phase !== "revealed" && timer && clock?.shot === game.round.shot ? clockLeft(clock, timer * 1000) : undefined;
    awayRef.current = { left };
    if (left !== undefined && clock) {
      const stopped = { shot: clock.shot, at: clock.at, left };
      setClock(stopped);
      save({ clock: stopped });
    }
    // While a resume is on its way, its new token is the one to stop (startClock sends it).
    if (!resuming.current) pausing.current = pauseOnServer(game.token, left);
  }
  /** Starts it again from the server's pause: the token going on from it, and the time left (never more than this device's clock had). */
  async function startClock(token: string, shot: string, revealed: boolean) {
    awayRef.current = null;
    setPausedBoth(true);
    resuming.current = true;
    await pausing.current;
    // Sent again after a blip: the server answers the same resume the same way for a little while.
    const back = await postRetrying<{ token: string; left: number }>("/api/geo/clock", { token, action: "resume" }).catch(() => null);
    resuming.current = false;
    if (back) {
      setGame((g) => (g && g.token === token ? { ...g, token: back.token } : g));
      if (snap.current?.game.token === token) {
        snap.current = { ...snap.current, game: { ...snap.current.game, token: back.token }, savedAt: Date.now() };
        writeSaved(snap.current, keptOf(snap.current.game));
      }
    }
    // Gone again while it was being started: stopped again, from the new token.
    const away = awayRef.current as { left: number | undefined } | null;
    if (away) {
      pausing.current = pauseOnServer(back?.token ?? token, away.left);
      return;
    }
    const timerMs = (stateRef.current.game?.settings.timer ?? 0) * 1000;
    if (back && !revealed && timerMs) setClock((c) => ({ shot, at: 0, left: Math.min(back.left, c?.shot === shot ? clockLeft(c, timerMs) : timerMs) }));
    setPausedBoth(false);
  }
  /** The page hidden or going (a tab switched, closed or reloaded, a phone's app left): the clock stops; back in view, it goes on. */
  const stopRef = useRef(stopClock);
  stopRef.current = stopClock;
  const backRef = useRef(() => {});
  backRef.current = () => {
    const { game, phase } = stateRef.current;
    if (!awayRef.current || !game || !keptOf(game) || !(phase === "guessing" || phase === "submitting" || phase === "revealed")) return;
    void startClock(game.token, game.round.shot, phase === "revealed");
  };
  useEffect(() => {
    const onVisibility = () => (document.visibilityState === "hidden" ? stopRef.current() : backRef.current());
    const onHide = () => stopRef.current();
    const onShow = (e: PageTransitionEvent) => e.persisted && backRef.current();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("pageshow", onShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", onShow);
      // Off the page another way (a link): the same as leaving.
      stopRef.current();
    };
  }, []);
  // A guess answered while the page was hidden deals the next round on the server: its clock is stopped too.
  useEffect(() => {
    const away = awayRef.current;
    if (!away || !game || !keptOf(game) || resuming.current || document.visibilityState !== "hidden") return;
    pausing.current = pauseOnServer(game.token, phase === "revealed" ? undefined : away.left);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- each new token, while away
  }, [game?.token]);

  /** Picks a saved game up where it was left: the round, its pin, its clock (the Daily's and the Weekly's, from where it stopped), or its result. */
  const resendOnResume = useRef<Record<string, unknown> | null>(null);
  function resume(saved: SavedGame): boolean {
    const map = byId(saved.game.region) ?? allRegions.find((r) => r.id === saved.game.region);
    const kept = keptOf(saved.game);
    if (!map || (saved.game.daily && saved.game.daily !== today) || (saved.game.weekly && saved.game.weekly !== geoWeekOf(Date.now()))) {
      writeSaved(null, kept);
      return false;
    }
    unlockAudio();
    preloadAfterRound();
    startRun.current++;
    setGame({ ...saved.game, region: map });
    setPlayed(saved.played);
    setIsChallenge(saved.challenge);
    setReward(null);
    setViewIndex(0);
    setGamePick(null);
    setError(null);
    setConfirmExit(false);
    // Played to the end: its result, again.
    if (saved.phase === "done") {
      snap.current = null;
      setPausedBoth(false);
      leaveGameHistory();
      toResults();
      return true;
    }
    snap.current = saved;
    writeSaved(saved, kept);
    setPick(saved.pick);
    setClock(saved.clock);
    enterGameHistory();
    if (saved.pending) {
      resendOnResume.current = saved.pending;
      setPhase("submitting");
    } else setPhase(saved.phase === "revealed" && saved.played.length ? "revealed" : "guessing");
    // The Daily's or the Weekly's clock stays stopped until the server has started it again (a guess on its way is sent as it was).
    awayRef.current = null;
    if (kept && !saved.pending) void startClock(saved.game.token, saved.game.round.shot, saved.phase === "revealed");
    else setPausedBoth(false);
    return true;
  }
  // A guess that was on its way when the page went: sent again once the game is back (the server answers it the same way).
  useEffect(() => {
    const body = resendOnResume.current;
    if (!game || !body) return;
    resendOnResume.current = null;
    void guess(false, body);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, after a resume
  }, [game]);
  /** Today's Daily and this week's Weekly as saved here: part played (their card offers to resume them), or finished (their result). */
  const [keptSaves, setKeptSaves] = useState<Partial<Record<Kept, SavedGame>>>({});
  /** Today's Daily or this week's Weekly that the server won't start again, with nothing saved here to pick up (its day or week). */
  const [refused, setRefused] = useState<Partial<Record<Kept, string>>>({});
  function readKeptSaves() {
    const daily = readSaved("daily");
    const weekly = readSaved("weekly");
    setKeptSaves({
      ...(daily && daily.game.daily === today ? { daily } : {}),
      ...(weekly && weekly.game.weekly === geoWeekOf(Date.now()) ? { weekly } : {}),
    });
  }
  useEffect(() => {
    if (today) readKeptSaves();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once the local date is known
  }, [today]);

  // /pokeguessr?play=daily (the home page's Play) starts today's Daily straight away; ?play=game a game on the map.
  // It waits for the local date, by which time the saved settings have been read too.
  const autoPlay = useRef(false);
  useEffect(() => {
    if (autoPlay.current || !today || phase !== "setup") return;
    autoPlay.current = true;
    // A reload (or Back/Forward to the page) in the middle of a game picks it up again; a fresh visit starts afresh.
    const saved = readSaved("session");
    const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (saved && (nav?.type === "reload" || nav?.type === "back_forward") && resume(saved)) return;
    if (saved) writeSaved(null, null);
    if (challenge) return;
    const url = new URL(window.location.href);
    const play = url.searchParams.get("play");
    if (play !== "daily" && play !== "game") return;
    url.searchParams.delete("play");
    window.history.replaceState(null, "", url);
    // Today's Daily, already started here: picked up where it was left, or its result (it's played once).
    const daily = play === "daily" ? readSaved("daily") : null;
    if (daily?.game.daily === today && resume(daily)) return;
    void start(play === "daily" ? { kind: "game", daily: today } : { kind: "game" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the date is known
  }, [today]);

  function chooseRegion(id: string) {
    setRegionId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("region", id);
    window.history.replaceState(null, "", url);
  }

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  /** The hub's Solo tile: opens the solo game's setup in place (and goes down to it), or folds it away again. */
  function toSolo() {
    if (soloOpen) return setSoloOpen(false);
    setSoloOpen(true);
    window.setTimeout(() => scrollTo("solo"), 50);
  }
  /** The Party tile (or /pokeguessr#party): opens the party form, so the hub's other forms are the only ones on the page until then. */
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

  useEffect(() => onEnding(phase === "results"), [phase, onEnding]);
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
  /** A round's clock: GeoGuessr's 1:30 for the Daily and the Weekly, none for a streak, else the practice game's choice. */
  const roundTimer = (opts: StartOpts): GeoTimer => (opts.kind === "streak" ? 0 : opts.daily || opts.weekly ? GEO_DEFAULT_TIMER : settings.timer);
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
    // The Timer goes to the server too, so a late pin scores nothing there as well.
    const timer = roundTimer(opts);
    return { mode, bonus, timer, body: { ...body, ...(timer ? { timer } : {}) } };
  }

  /**
   * Hovering or focusing a Play button gets the game ready: the code and the
   * world map the round needs, and (for free play and challenges) the game
   * itself and round 1's picture, so the click shows the round at once. The
   * Daily and the Weekly aren't started ahead (starting them is what counts them
   * as played). A timed game can be: the server's clock allows for it. A ready
   * game is used only if the click asks for exactly the same game, within a minute.
   */
  const ahead = useRef<{ key: string; at: number; res: Promise<GeoStartResponse> } | null>(null);
  function prefetch(opts: StartOpts, withMap = true) {
    if (phase !== "setup") return;
    preloadAfterRound();
    // The world map's small copy, decoded off the main thread.
    if (withMap) void mapReady(WORLD_MAP_SRC);
    if (opts.daily) warmDaily("high");
    if (opts.daily || opts.weekly) return;
    const { body } = startBody(opts);
    const key = JSON.stringify(body);
    if (ahead.current?.key === key && Date.now() - ahead.current.at < PREFETCH_TTL_MS) return;
    const res = post<GeoStartResponse>("/api/geo", body);
    res.then((r) => preloadImage(r.round.shot, { priority: "high" })).catch(() => undefined);
    ahead.current = { key, at: Date.now(), res };
  }
  const warmProps = (opts: StartOpts) => ({ onPointerEnter: () => prefetch(opts), onFocus: () => prefetch(opts) });

  /**
   * And once per page view, a couple of seconds after the page has loaded and
   * gone idle: the game the player is most likely to start (a friend's
   * challenge, else the solo game on the map, filter and length the page opened
   * with, after the saved settings are read), so a click within the minute
   * shows round 1 with its picture already in. Starting a free game or a
   * challenge records nothing (only a guess does), so a game that's never
   * played costs nothing but the request. The big world map waits for a Play
   * button to be pointed at: on a phone's first load it would only hold up
   * the page's own pictures.
   */
  const warmOnLoad = useRef<() => void>(() => undefined);
  warmOnLoad.current = () => {
    if (challenge) prefetch({ kind: "game", challenge: challenge.token }, false);
    else if (filterOk) prefetch({ kind: "game" }, false);
    // Today's Daily, not yet played: its first picture (the same for everyone, so the CDN keeps it).
    if (!challenge) warmDaily();
  };
  const dailyWarm = useRef<string | null>(null);
  function warmDaily(priority?: "high") {
    if (!today || dailyWarm.current === today || progress?.best[`geo-daily:${today}`] !== undefined) return;
    dailyWarm.current = today;
    void fetch(`/api/geo/daily-shot?date=${today}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ shot?: string }>) : null))
      .then((d) => (d?.shot ? preloadImage(d.shot, priority ? { priority } : {}) : false))
      .catch(() => {
        dailyWarm.current = null;
      });
  }
  useEffect(() => {
    let done = false;
    let timer = 0;
    let idle = 0;
    const run = () => {
      if (done) return;
      done = true;
      warmOnLoad.current();
    };
    const afterLoad = () => {
      timer = window.setTimeout(() => {
        if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(run, { timeout: 1000 });
        else run();
      }, WARM_AFTER_LOAD_MS);
    };
    if (document.readyState === "complete") afterLoad();
    else window.addEventListener("load", afterLoad, { once: true });
    return () => {
      done = true;
      window.removeEventListener("load", afterLoad);
      window.clearTimeout(timer);
      if (idle && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle);
    };
  }, []);

  async function start(opts: StartOpts) {
    unlockAudio();
    // A new game's clock runs (a Daily or a Weekly left before keeps its own stopped, in its save).
    awayRef.current = null;
    setPausedBoth(false);
    // The game's frame is up at once (it covers the hub, which stays where it is underneath).
    setGame(null);
    setPhase("loading");
    setError(null);
    setConfirmExit(false);
    enterGameHistory();
    preloadAfterRound();
    const run = ++startRun.current;
    try {
      const { mode, bonus, body, timer } = startBody(opts);
      const key = JSON.stringify(body);
      const ready = ahead.current?.key === key && Date.now() - ahead.current.at < PREFETCH_TTL_MS ? ahead.current.res : null;
      ahead.current = null;
      const res = (ready ? await ready.catch(() => null) : null) ?? (await post<GeoStartResponse>("/api/geo", body));
      if (run !== startRun.current) return;
      const map = byId(res.region) ?? allRegions.find((r) => r.id === res.region);
      if (!map) throw new Error(t("errors.noMap"));
      // A friend's challenge plays on their filter, the daily on every game.
      const played: FilterChoice = opts.challenge
        ? { era: challenge?.era, families: challenge?.families ?? [] }
        : opts.daily || opts.weekly
          ? { era: undefined, families: [] }
          : filter;
      const started: Game = {
        region: map,
        kind: opts.kind,
        rounds: opts.challenge && challenge && isGeoRounds(challenge.rounds.length) ? challenge.rounds.length : opts.kind === "game" && !opts.daily && !opts.weekly ? playRounds : GEO_ROUNDS,
        daily: opts.daily,
        ...(res.weekly ? { weekly: res.weekly } : {}),
        practice: res.practice,
        filter: played,
        guessGame: !!bonus.guessGame,
        ...(mode ? { difficulty: mode } : {}),
        settings: { ...settings, timer },
        token: res.token,
        round: res.round,
      };
      setGame(started);
      setGamePick(null);
      setIsChallenge(!!opts.challenge);
      startSaving(started, !!opts.challenge);
      setPick(null);
      setPlayed([]);
      setReward(null);
      setViewIndex(0);
      setClock(null);
      setPhase("guessing");
    } catch (err) {
      if (run !== startRun.current) return;
      // The Daily or the Weekly, already started here or on the account: picked up if it's saved here after all (another tab), else its card says so.
      const kept: Kept | null = opts.daily ? "daily" : opts.weekly ? "weekly" : null;
      if (kept && err instanceof ApiError && err.code === `${kept}-started`) {
        const saved = readSaved(kept);
        if (saved && resume(saved)) return;
        setRefused((r) => ({ ...r, [kept]: kept === "daily" ? opts.daily : geoWeekOf(Date.now()) }));
        setGame(null);
        leaveGameHistory();
        setPhase("setup");
        readKeptSaves();
        return;
      }
      setError(err instanceof Error ? err.message : t("errors.start"));
      setGame(null);
      leaveGameHistory();
      setPhase("error");
    }
  }

  /** `timeUp`: the round's clock ran out, so the pin (if any) is guessed where it is. */
  async function guess(timeUp = false, resend?: Record<string, unknown>) {
    if (!game || (!pick && !timeUp && !resend) || (phase !== "guessing" && !resend) || (pausedRef.current && !resend)) return;
    setPhase("submitting");
    try {
      const at = pick ?? { x: 0, y: 0, timeout: true };
      if (!timeUp && !resend) play("guess");
      const body = resend ?? { token: game.token, ...at, ...(game.guessGame && gamePick ? { family: gamePick } : {}) };
      // Kept until it's answered: a reload sends the very same guess again, and the server answers it the same way.
      pendingGuess.current = body;
      save({ pending: body });
      const graded = await postRetrying<GeoGuessResponse>("/api/geo/guess", body);
      pendingGuess.current = null;
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
      save({ phase: "revealed", played: nextPlayed, game: { ...game, token: graded.token }, pending: undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.grade"));
      setPhase("error");
    }
  }

  function next() {
    if (!game || !current) return;
    const { graded } = current;
    if (graded.done || !graded.next) {
      play("fanfare");
      // The Daily and the Weekly stay saved, finished: their card shows this result again (they're played once).
      const kept = keptOf(game);
      if (kept && snap.current) keepFinished(snap.current, kept);
      else writeSaved(null, kept);
      snap.current = null;
      if (kept) readKeptSaves();
      leaveGameHistory();
      toResults();
      return;
    }
    const nextGame = { ...game, round: graded.next };
    setGame(nextGame);
    setPick(null);
    setGamePick(null);
    setViewIndex(0);
    setPhase("guessing");
    save({ game: nextGame, phase: "guessing", pick: null, clock: null });
  }

  // The Timer setting: a clock per round; at zero the pin is guessed where it is (no pin: no points).
  const timer = game?.settings.timer ?? 0;
  stateRef.current = { game, phase, clock, timer };
  const roundShot = game?.round.shot;
  const nextShot = game?.round.preload;
  /**
   * The round's picture: fetched and decoded before the clock starts. If it
   * fails, it's asked for again (1 s, 2 s, 4 s apart, past any cached
   * failure), and after that the round says so and offers to try again; the
   * clock waits all the while.
   */
  const tries = roundShot && shotTry.shot === roundShot ? shotTry : { shot: roundShot ?? "", n: 0 };
  const shotSrc = roundShot ? (tries.n ? `${roundShot}${roundShot.includes("?") ? "&" : "?"}r=${tries.n}` : roundShot) : "";
  const shotReady = !!shotSrc && readyShot === shotSrc;
  const shotFailed = !!tries.failed;
  useEffect(() => {
    if (!roundShot || !shotSrc || tries.failed) return;
    let off = false;
    let retry = 0;
    void preloadImage(shotSrc, { priority: "high" }).then((ok) => {
      if (off) return;
      if (!ok) {
        if (tries.n >= SHOT_RETRIES.length) setShotTry({ shot: roundShot, n: tries.n, failed: true });
        else retry = window.setTimeout(() => setShotTry({ shot: roundShot, n: tries.n + 1 }), SHOT_RETRIES[tries.n]);
        return;
      }
      // The <img> itself already failed on this address (the preload had it from before): ask again, afresh.
      if (imgFailed.current === shotSrc) {
        if (tries.n >= SHOT_RETRIES.length) setShotTry({ shot: roundShot, n: tries.n, failed: true });
        else retry = window.setTimeout(() => setShotTry({ shot: roundShot, n: tries.n + 1 }), SHOT_RETRIES[tries.n]);
        return;
      }
      setReadyShot(shotSrc);
      // The clock starts now, unless this round's had already started (a game picked up after a reload).
      setClock((c) => (c?.shot === roundShot ? c : { shot: roundShot, at: Date.now() }));
      // Then the next round's picture, fetched and decoded while this one is being looked at.
      if (nextShot) void preloadImage(nextShot);
    });
    return () => {
      off = true;
      window.clearTimeout(retry);
    };
  }, [roundShot, shotSrc, nextShot, tries.n, tries.failed]);
  /** The address the round's <img> last failed on. */
  const imgFailed = useRef<string | null>(null);
  /** The <img> itself failed: if the picture had loaded, ask again afresh (before that, the loop above sees it). */
  const onShotError = () => {
    if (!roundShot) return;
    imgFailed.current = shotSrc;
    if (!shotReady) return;
    setReadyShot(null);
    setShotTry((t) => (t.shot === roundShot && (t.failed || t.n > tries.n) ? t : { shot: roundShot, n: Math.min(SHOT_RETRIES.length, tries.n + 1) }));
  };
  const retryShot = () => roundShot && setShotTry({ shot: roundShot, n: tries.n + 1 });
  const roundClock = clock && clock.shot === roundShot ? clock : null;
  /** The Daily's or the Weekly's clock, stopped (left, or waiting for the server): its time left, held. */
  const stoppedLeft = roundClock?.left;
  const roundStartedAt = roundClock && stoppedLeft === undefined ? roundClock.at : 0;
  useEffect(() => {
    if (clock && game && phase === "guessing") save({ clock });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- saved when the clock starts or stops
  }, [clock]);
  // A stopped clock goes on from the time it had left, once the server has started it again and the round's picture is up.
  useEffect(() => {
    if (!roundShot || stoppedLeft === undefined || paused || !shotReady || !timer) return;
    const t = Date.now();
    setNow(t);
    setClock({ shot: roundShot, at: t - (timer * 1000 - stoppedLeft) });
  }, [roundShot, stoppedLeft, paused, shotReady, timer]);
  // The clock is worked out from timestamps (the round's start and now), never by counting ticks, so a
  // hidden tab's slowed timers can't make it drift: it's right the moment the tab is back (the Daily's
  // and the Weekly's stop while the page is hidden, and go on from where they were).
  const msLeft =
    timer && shotReady && roundClock && (phase === "guessing" || phase === "submitting")
      ? stoppedLeft !== undefined
        ? stoppedLeft
        : Math.max(0, roundStartedAt + timer * 1000 - Math.max(now, roundStartedAt))
      : null;
  const timeLeft = msLeft === null ? null : Math.ceil(msLeft / 1000);
  useEffect(() => {
    if (!timer || !shotReady || phase !== "guessing" || !roundStartedAt) return;
    // A tick as each second turns over (not four a second), so the round re-renders only when the clock's text changes.
    let id = 0;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const left = roundStartedAt + timer * 1000 - t;
      window.clearTimeout(id);
      id = window.setTimeout(tick, left > 0 ? (left % 1000 || 1000) + 15 : 1000);
    };
    tick();
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [timer, shotReady, phase, roundStartedAt]);
  useEffect(() => {
    if (paused) return;
    if (timeLeft === 0 && phase === "guessing") void guess(true);
    // The last ten seconds tick (the sound respects mute).
    else if (timeLeft !== null && timeLeft <= 10 && phase === "guessing") play("countdown");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once a second, once when the clock hits zero, and once it goes on after a stop
  }, [timeLeft, phase, paused]);

  // GeoGuessr's shortcuts: Space / Enter to guess, then for the next round. Esc closes the zoomed view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setZoomed(false);
        return;
      }
      if (confirmExit) return;
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

  // ---- setup: the hub (kept in place under a game, so starting one moves nothing) ----
  const renderHub = (covered: boolean) => {
    // The Daily and the Weekly are played once: part played, the card resumes it; played, it shows the result (when it's saved here) and when the next one comes.
    const dailySave = today ? keptSaves.daily : undefined;
    const dailyDone = today ? (progress?.best[`geo-daily:${today}`] ?? savedScore(dailySave)) : undefined;
    const dailyPlayed = dailyDone !== undefined || (!!today && refused.daily === today && !dailySave);
    const dailyResume = !dailyPlayed && dailySave ? dailySave : null;
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
    const weeklySave = week ? keptSaves.weekly : undefined;
    const weeklyDone = week ? (progress?.best[`geo-weekly:${week}`] ?? savedScore(weeklySave)) : undefined;
    const weeklyPlayed = weeklyDone !== undefined || (!!week && refused.weekly === week && !weeklySave);
    const weeklyResume = !weeklyPlayed && weeklySave ? weeklySave : null;
    const weeklyLeft = week ? geoWeeklyLeftParts(week, Date.now()) : null;
    const weeklyLeftText = weeklyLeft ? t(`hub.weekly.${weeklyLeft.unit}`, { d: weeklyLeft.d, h: weeklyLeft.h, m: weeklyLeft.m }) : null;
    // The duel and party cards name the map as it stands: in the page's language.
    const shownRegion = t.locale === "en" ? region : { ...region, name: names.map(region) };
    // The Daily's last seven days, oldest first, for the streak on its card.
    const dailyDays: { date: string; played: boolean; today: boolean }[] = [];
    for (let i = 0, d = today; d && i < 7; i++, d = previousDate(d)) dailyDays.unshift({ date: d, played: progress?.best[`geo-daily:${d}`] !== undefined, today: d === today });
    return (
      // Under a game the hub stays where it is (nothing moves when a game starts or ends), out of reach.
      <div className="mx-auto max-w-6xl space-y-12" aria-hidden={covered || undefined} inert={covered} data-testid="geo-hub">
        <HubTop
          d={{
            dailyNum: today ? `#${dailyNumber(today)}` : null,
            dailyMap: dailyMap ? names.map(dailyMap) : null,
            dailyArt: tileImage(dailyMap?.map.src ?? WORLD_MAP_SRC),
            dailyPlayed,
            dailyScore: dailyDone,
            dailyResume: !!dailyResume,
            // Today's Daily, part played: picked up where it was left, its clock where it stopped.
            onDaily: () => today && (dailyResume ? void resume(dailyResume) : void start({ kind: "game", daily: today })),
            onDailyResult: dailySave ? () => resume(dailySave) : undefined,
            dailyWarm: warmProps({ kind: "game", daily: today || "today" }),
            weeklyNum: week ? geoWeeklyNumber(week) : null,
            weeklyMap: weeklyMap ? names.map(weeklyMap) : null,
            // A region's week shows that region's map; a themed week (Gyms, Towns, Routes) keeps its own screenshot.
            weeklyArt: weeklyMap ? (weeklyMap.theme ? (weeklyMap.preview ?? tileImage(weeklyMap.map.src)) : tileImage(weeklyMap.map.src)) : null,
            weeklyPlayed,
            weeklyScore: weeklyDone,
            weeklyLeft: weeklyLeftText,
            weeklyResume: !!weeklyResume,
            weeklyReady: !!week && !!weeklyMap,
            // This week's, part played: picked up where it was left, its clock where it stopped.
            onWeekly: () => (weeklyResume ? void resume(weeklyResume) : void start({ kind: "game", weekly: true })),
            onWeeklyResult: weeklySave ? () => resume(weeklySave) : undefined,
            onWeeklyWarm: () => prefetch({ kind: "game", weekly: true }),
            classicMap: names.map(region),
            classicArt: region.preview ?? tileImage(region.map.src),
            classicBest: bestGame,
            soloOpen,
            onClassic: toSolo,
            regionStreakBest: progress?.best[`geo:${GEO_REGION_STREAK_KEY}`] ?? 0,
            onDuels: () => openDuels("casual"),
            onRanked: () => openDuels("ranked"),
            onParty: openParty,
            loading,
            streak: progress && today ? geoDailyStreak(progress, today) : 0,
            days: dailyDays,
          }}
        />

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
                  <Swords className="h-3.5 w-3.5" aria-hidden />{` ${t("hub.challenge.tag")}`}
                </p>
                <p className="font-display text-2xl font-bold uppercase">
                  {t("hub.challenge.scored", { name: challenge.name || t("hub.challenge.aTrainer"), score: fmt(challenge.score) })}
                </p>
                <p className="text-sm text-muted-foreground">
                  {sameText(t, names, challenge.rounds.length || 5, challengeMap)}{" "}
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
                  {t("hub.challenge.accept")}
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* ---- The solo game's setup (Classic, above, opens it) ---- */}
        {soloOpen && (
          <Card id="solo" className="scroll-mt-24" data-testid="geo-solo">
            <CardContent className="space-y-4 p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-display text-xl font-bold uppercase">{t("hub.solo.heading")}</h3>
                <Link href="/atlas" className="tap flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground">
                  <MapIcon className="h-4 w-4" aria-hidden />{` ${t("hub.atlas")}`}
                </Link>
              </div>

              {maps.length > 1 && (
                <div className="flex flex-wrap gap-1.5 max-md:-mx-5 max-md:flex-nowrap max-md:overflow-x-auto max-md:px-5 max-md:pb-1 max-md:[scrollbar-width:none] max-md:[&>*]:shrink-0" role="radiogroup" aria-label={t("hub.solo.map")}>
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
                      {names.map(r)}
                    </button>
                  ))}
                </div>
              )}

              {themed.length > 0 && (
                <div className="space-y-1.5">
                  <p className="hud-label">{t("hub.solo.themed")}</p>
                  <div className="flex flex-wrap gap-1.5 max-md:-mx-5 max-md:flex-nowrap max-md:overflow-x-auto max-md:px-5 max-md:pb-1 max-md:[scrollbar-width:none] max-md:[&>*]:shrink-0" role="radiogroup" aria-label={t("hub.solo.themedMap")}>
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
                        {names.map(r)}
                      </button>
                    ))}
                  </div>
                  {theme && (
                    <p className="text-sm text-muted-foreground" data-testid="geo-theme-blurb">
                      {t.locale === "en" ? theme.blurb : gn(`themes.${theme.id}.blurb`)} {t("hub.solo.themeMore")}
                    </p>
                  )}
                </div>
              )}

              <GameFilter region={region} filter={filter} onChange={chooseFilter} />

              <GeoSettingsButton value={settings} onChange={chooseSettings} />

              {(filter.families.length > 0 || filter.era) && (
                <p className="text-sm text-muted-foreground">
                  {filter.families.length ? t("hub.solo.picked") : t("hub.solo.eraBoards", { era: names.era(filter.era!) })}
                </p>
              )}

              <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:gap-x-8 lg:grid-cols-[auto_auto_1fr]">
                <RoundsPicker value={playRounds} onChange={setRounds} max={places} label={t("hub.solo.rounds")} />
                <TimerPicker value={settings.timer} onChange={(timer) => chooseSettings({ ...settings, timer })} />
                <div className="sm:col-span-2 lg:col-span-1">
                  <DifficultyPicker value={difficulty} onChange={setDifficulty} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <ModeCard
                  preview={region.preview ?? tileImage(region.map.src)}
                  icon={<MapPinIcon className="h-5 w-5" aria-hidden />}
                  title={t("hub.mode.game", { n: playRounds })}
                  blurb={isWorld ? t("hub.mode.gameWorld", { n: playRounds, max: fmt(maxTotal(playRounds)) }) : t("hub.mode.gameBlurb", { n: playRounds, max: fmt(maxTotal(playRounds)) })}
                  stat={bestGame ? t("hub.best", { score: fmt(bestGame) }) : null}
                  disabled={loading || !filterOk}
                  onClick={() => void start({ kind: "game" })}
                  warm={warmProps({ kind: "game" })}
                />
                <ModeCard
                  preview={tileImage(region.map.src)}
                  whole
                  icon={<Flame className="h-5 w-5" aria-hidden />}
                  title={t("hub.mode.streak")}
                  blurb={isWorld ? t("hub.mode.streakWorld") : t("hub.mode.streakBlurb")}
                  stat={bestStreak ? t("hub.bestRow", { n: bestStreak }) : null}
                  disabled={loading || !filterOk}
                  onClick={() => void start({ kind: "streak" })}
                  warm={warmProps({ kind: "streak" })}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* ---- Multiplayer ---- */}
        <HubSection id="multiplayer" eyebrow={t("hub.multi.eyebrow")} title={t("hub.multi.title")}>
          <div className="grid gap-4 sm:grid-cols-3">
            <HubTile
              testId="geo-duels-card"
              tone="screen"
              icon={<Swords className="h-5 w-5" />}
              label={t("hub.multi.duelsLabel", { map: names.map(region) })}
              title={t("hub.multi.duels")}
              blurb={t("hub.multi.duelsBlurb")}
              action={
                <Button variant="outline" className="w-full" onClick={() => openDuels("casual")} data-testid="geo-open-duels">
                  <Swords className="h-4 w-4" aria-hidden />{` ${t("hub.multi.openDuels")}`}
                </Button>
              }
            />
            <HubTile
              testId="geo-ranked-tile"
              tone="warning"
              icon={<Trophy className="h-5 w-5" />}
              label={t("hub.multi.rankedLabel")}
              title={t("hub.multi.ranked")}
              blurb={t("hub.multi.rankedBlurb")}
              action={
                <Button variant="outline" className="w-full" onClick={() => openDuels("ranked")} data-testid="geo-open-ranked">
                  <Trophy className="h-4 w-4" aria-hidden />{` ${t("hub.multi.openRanked")}`}
                </Button>
              }
            />
            <HubTile
              testId="geo-party-card"
              tone="primary"
              icon={<Users className="h-5 w-5" />}
              label={t("hub.multi.partyLabel")}
              title={t("hub.multi.party")}
              badge={<TileFlag tone="success">{t("hub.multi.new")}</TileFlag>}
              blurb={t("hub.multi.partyBlurb")}
              action={
                <Button variant="outline" className="w-full" onClick={openParty} data-testid="geo-open-party">
                  <Users className="h-4 w-4" aria-hidden />{` ${t("hub.multi.openParty")}`}
                </Button>
              }
            />
          </div>
          <div id="duels" className="scroll-mt-24">
            {/* Duels play an era when the map has enough of it (hand-picked games are practice), else every game. Its code loads as it nears the screen. */}
            <WhenNear minHeight={420} eager={duelQueue === "ranked"}>
            <DuelCard
              region={shownRegion}
              places={places}
              era={filter.era && filterPlaces(region, { era: filter.era, families: [] }) >= GEO_FILTER_MIN_PLACES ? filter.era : undefined}
              queue={duelQueue}
              onQueue={setDuelQueue}
            />
            </WhenNear>
          </div>
          {partyOpen && (
            <div id="party" className="scroll-mt-24 space-y-3">
              <h3 className="font-display text-xl font-bold uppercase">{t("hub.multi.party")}</h3>
              <PartyCard region={shownRegion} />
            </div>
          )}
        </HubSection>

        {/* ---- Explore: the globe and the atlas (maps are picked in the solo setup) ---- */}
        <HubSection id="maps" eyebrow={t("hub.explore.eyebrow")} title={t("hub.explore.title")}>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="overflow-hidden border-primary/40" data-testid="globe-card">
              <CardContent className="flex flex-col items-center gap-4 p-5 sm:flex-row">
                <GlobePreview />
                <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
                  <p className="hud-label text-primary">{t("hub.explore.globeTag")}</p>
                  <p className="font-display text-2xl font-bold uppercase">{t("hub.explore.globe")}</p>
                  <p className="text-sm text-muted-foreground">{t("hub.explore.globeBlurb")}</p>
                  <Link href="/pokeguessr/globe" className={cn(buttonVariants(), "w-full sm:w-auto")}>
                    {t("hub.explore.openGlobe")}
                  </Link>
                </div>
              </CardContent>
            </Card>
            <Card className="overflow-hidden">
              <CardContent className="flex h-full flex-col justify-center gap-2 p-5 text-center sm:text-left">
                <p className="hud-label text-screen">{t("hub.explore.atlasTag")}</p>
                <p className="font-display text-2xl font-bold uppercase">{t("hub.atlas")}</p>
                <p className="text-sm text-muted-foreground">{t("hub.explore.atlasBlurb")}</p>
                <Link href="/atlas" className={cn(buttonVariants({ variant: "outline" }), "w-full sm:w-auto sm:self-start")}>
                  <MapIcon className="h-4 w-4" aria-hidden />{` ${t("hub.explore.openAtlas")}`}
                </Link>
              </CardContent>
            </Card>
          </div>
        </HubSection>

        {/* ---- You ---- */}
        <GeoYou progress={mine} />
      </div>
    );
  };

  /** The map and the mode, for the round's header and the end screen: "World · Daily #12", "Kanto · Classic 2D · Hard". */
  const modeLineOf = (game: Game) =>
    [
      names.map(game.region),
      game.filter.families.length ? t("hud.picked") : game.filter.era ? names.era(game.filter.era) : null,
      game.daily ? t("hud.daily", { n: dailyNumber(game.daily) }) : null,
      game.weekly ? t("hub.weekly.numbered", { n: geoWeeklyNumber(game.weekly) }) : null,
      game.difficulty ? names.difficulty(game.difficulty) : null,
    ]
      .filter(Boolean)
      .join(" · ");

  if (phase === "results" && game) {
    const last = played[played.length - 1]?.graded;
    const GeoResults = loaded.GeoResults ?? LazyResults;
    const GeoSummary = loaded.GeoSummary ?? LazySummary;
    // The Weekly says when the next one comes, as the Daily does (in the hub card's words).
    const weeklyLeft = game.weekly ? geoWeeklyLeftParts(game.weekly, Date.now()) : null;
    const nextWeekly = weeklyLeft ? (
      <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="geo-results-next-weekly">
        <Clock className="h-4 w-4" aria-hidden />
        {t("hub.weekly.next", { left: t(`hub.weekly.${weeklyLeft.unit}`, { d: weeklyLeft.d, h: weeklyLeft.h, m: weeklyLeft.m }) })}
      </p>
    ) : undefined;
    // What the achievements read after the game show that it earned, or brought closer (a game just played here, not a result shown again).
    const base = endBase.current;
    const earned = reward ? fresh.filter((id) => !base.fresh.includes(id)) : [];
    const rival = isChallenge && challenge ? { name: challenge.name || t("summary.them"), score: challenge.score, rounds: challenge.rounds } : undefined;
    // NEXT: back to the hub (solo: where Play again is; the Daily and the Weekly are played once). Escape and the X: the same.
    const leave = () => setPhase("setup");
    return (
      <GeoResults game={game} played={played} pinImage={pinImage} mode={modeLineOf(game)} resultToken={last?.resultToken} rival={rival} onNext={leave} onExit={leave}>
        <GeoSummary
          game={game}
          played={played}
          resultToken={last?.resultToken}
          challengeToken={last?.challengeToken}
          challenge={isChallenge ? challenge : undefined}
          reward={reward}
          earned={earned}
          closer={reward && !earned.length ? achievementCloser(base.mine, mine) : null}
          next={nextWeekly}
          onSeen={onSeen}
        />
      </GeoResults>
    );
  }

  /** The round's view (built only while a game is on). */
  const guessViewOf = (game: Game) => {
  const isStreak = game.kind === "streak";
  const roundNumber = played.length + (phase === "revealed" ? 0 : 1);
  const modeLine = modeLineOf(game);
  /** The top-centre notch: the round (or the streak), the map and mode; the countdown pill hangs under it. */
  const notch = (
    <Notch
      below={msLeft !== null ? <CountdownPill ms={msLeft} totalMs={timer * 1000} urgentMs={10_000} testId="geo-time-left" clock /> : undefined}
    >
      <div className="min-w-0 text-center">
        <div className="font-display text-xl font-bold uppercase italic leading-none tracking-wide sm:text-2xl" data-testid="geo-round">
          {isStreak ? (
            <span className="inline-flex items-center gap-1.5">
              <Flame className="h-5 w-5 text-warning" aria-hidden />{` ${t("hud.streak", { n: streak })}`}
            </span>
          ) : (
            <>
              {t("hud.round", { n: Math.min(roundNumber, game.rounds) })}
              <span className="text-white/50">/{game.rounds}</span>
            </>
          )}
        </div>
        <div className="mt-0.5 truncate font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c8bfff]">{modeLine}</div>
      </div>
    </Notch>
  );
  /** Top-right: GeoGuessr's score tracker (a streak shows its count in the notch), and the help button. */
  const chips = (
    <div className="geo-safe-tr absolute right-3 top-3 z-20 flex items-start gap-2">
      {/* Beside the notch it needs a laptop's width; a narrower window gets the compact readout. */}
      {!isStreak && <ScoreTracker className="max-lg:hidden" rounds={game.rounds} scores={played.map((p) => p.graded.score)} current={Math.min(roundNumber, game.rounds) - 1} total={fmt(total)} />}
      {!isStreak && <RoundReadout className="!h-9 lg:hidden" testId="geo-score-compact" round={Math.min(roundNumber, game.rounds)} rounds={game.rounds} total={fmt(total)} />}
      <HowToHelpButton className="hud-btn !hidden !p-0 !text-white hover:!bg-black/75 hover:!text-white sm:!flex" />
    </div>
  );

  // ---- guessing ------------------------------------------------------------------
  // The round's picture as it's being asked for (a retry asks past a cached failure).
  const views = visibleViews(roundViewsOf(game.round), game.settings).map((v, i) => (i === 0 && shotSrc ? shotSrc : v));
  const zoom = game.settings.zoomed ? (src: string) => ({ scale: GEO_ZOOM, origin: zoomOrigin(src) }) : undefined;
  const zoomedView = zoom?.(views[viewIndex] ?? game.round.shot);
  const revealed = phase === "revealed";
  // eslint-disable-next-line react/display-name -- a render function, not a component
  return (fs: boolean, toggle: () => void) => (
    // One guess view for the whole game: the next round reuses it (its map and all), and the round result covers it.
    <div className={cn("relative h-full", revealed && "invisible")} aria-hidden={revealed || undefined} data-testid="geo-guess-view">
      <div className="absolute inset-0" style={{ bottom: "var(--geo-bar)" }}>
        <ShotCarousel views={views} onError={onShotError} index={viewIndex} onIndex={setViewIndex} onZoom={() => setZoomed(true)} zoom={zoom} fs dock blur={game.round.blur} priority={game.round.index === 0} />
      </div>
      {phone ? (
        <>
          {/* Phone, GeoGuessr's layout: the dials top-left, the round badge top-right, the tools in the bottom bar. */}
          {(msLeft !== null || !isStreak) && (
            <HudDials>
              {msLeft !== null && <TimerDial ms={msLeft} totalMs={timer * 1000} urgentMs={10_000} testId="geo-time-left" clock />}
              {!isStreak && <RoundReadout round={Math.min(roundNumber, game.rounds)} rounds={game.rounds} total={fmt(total)} />}
            </HudDials>
          )}
          <RoundBadge testId="geo-round" label={isStreak ? t("hud.streakWord") : g("round")} value={isStreak ? streak : Math.min(roundNumber, game.rounds)} of={isStreak ? undefined : game.rounds} mode={modeLine} />
        </>
      ) : (
        <>
          <div className="geo-safe-tl absolute left-3 top-3 z-20 flex items-center gap-2">
            <ExitButton onClick={requestExit} />
            <FullscreenButton fs={fs} onClick={toggle} />
          </div>
          {notch}
          {chips}
        </>
      )}

      {/* GeoGuessr-style mini-map (the atlas): docked bottom-right, grows on hover; a bottom sheet on phones. */}
      <MapDock aspect={mapAspect(game.region)}
        resetKey={game.round.index}
        hasPin={!!pick}
        map={({ fill, land }) => (
          <GeoMap
            land={land}
            round={game.round.index}
            defer={phone && game.round.index === 0 && !shotReady}
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
        tools={
          <>
            <button type="button" onClick={requestExit} className={BAR_BTN} aria-label={g("shell.back")} title={g("shell.back")} data-testid="geo-exit" data-keep>
              <X className="h-5 w-5" />
            </button>
            <HowToHelpButton className={cn(BAR_BTN, "!p-0 !text-white")} />
            <FullscreenButton fs={fs} onClick={toggle} className={cn(BAR_BTN, "!h-11 !w-11 !rounded-full !bg-[#4a3f9e] !backdrop-blur-none")} />
          </>
        }
        extra={game.guessGame && pick ? <GameGuessPicker options={gameGuessOptions(game.region, game.filter)} value={gamePick} onChange={setGamePick} /> : undefined}
        button={<GuessButton hasPin={!!pick} busy={phase === "submitting"} disabled={phase === "submitting" || paused} onClick={() => void guess()} />}
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
            aria-label={g("shot.fullscreen")}
          >
            <div className="max-h-full max-w-full overflow-hidden rounded-md">
              {/* eslint-disable-next-line @next/next/no-img-element -- same cached screenshot, full size */}
              <img
                src={views[viewIndex] ?? game.round.shot}
                alt={g("shot.where")}
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
              aria-label={g("shot.close")}
            >
              <X className="h-5 w-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
  };

  // Under a game the hub doesn't change: it's built once as the game starts, so the round's ticks never re-render it.
  const hubView = inGame && hubUnderGame.current ? hubUnderGame.current : renderHub(inGame);
  hubUnderGame.current = inGame ? hubView : null;
  if (!inGame) return hubView;
  const guessView = game ? guessViewOf(game) : null;
  const roundNow = played.length;
  return (
    <>
      {hubView}
      {/* On the page's body, clear of the page's own layout (the hub keeps its place and scroll underneath). */}
      {createPortal(
      <GameShell onExit={requestExit}>
        {({ fs, toggle }) => (
          <>
            {guessView?.(fs, toggle)}
            {phase === "revealed" && current && game && (
              <div className="absolute inset-0 z-[40] bg-[#0f0d1f]">
                <RoundReveal key={roundNow} game={game} current={current} scores={played.map((p) => p.graded.score)} round={roundNow} streak={streak} pinImage={pinImage} onNext={next} onExit={requestExit} t={t} names={names} />
              </div>
            )}
            {(phase === "loading" || (!shotReady && !shotFailed && phase === "guessing" && game?.round.index === 0 && !readyShot)) && (
              <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center" data-testid="geo-loading">
                <Loader2 className="h-8 w-8 animate-spin text-white/70" aria-label={g("shell.loading")} />
              </div>
            )}
            {phase === "loading" && (
              <div className="geo-safe-tl absolute left-3 top-3 z-20">
                <ExitButton onClick={exitGame} />
              </div>
            )}
            {shotFailed && phase === "guessing" && (
              <div className="absolute inset-x-4 top-1/2 z-[25] mx-auto max-w-sm -translate-y-1/2 rounded-xl bg-[#1e1a3f]/95 p-5 text-center shadow-2xl ring-1 ring-white/15" role="alert" data-testid="geo-shot-failed">
                <p className="text-sm text-white/85">{g("shot.failed")}</p>
                <button type="button" onClick={retryShot} className="mt-3 inline-flex h-10 items-center justify-center rounded-md bg-[#4cbb17] px-5 font-display text-sm font-bold uppercase tracking-wider text-white hover:bg-[#58d01c]" data-testid="geo-shot-retry">
                  {g("retry")}
                </button>
              </div>
            )}
            {phase === "error" && (
              <div className="absolute inset-0 z-[50] flex items-center justify-center bg-[#0f0d1f]/90 p-4">
                <Card className="w-full max-w-md">
                  <CardContent className="space-y-4 p-6 text-center">
                    <p className="font-display text-xl font-bold uppercase">{t("errors.title")}</p>
                    <p className="text-sm text-muted-foreground" role="alert">{error}</p>
                    <div className="flex justify-center gap-2">
                      {pendingGuess.current && (
                        <Button onClick={() => pendingGuess.current && void guess(false, pendingGuess.current)} data-testid="geo-guess-retry">
                          {g("retry")}
                        </Button>
                      )}
                      <Button variant={pendingGuess.current ? "outline" : "default"} onClick={exitGame}>{g("shell.back")}</Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
            {confirmExit && <ConfirmExit daily={!!game?.daily} weekly={!!game?.weekly} onLeave={exitGame} onStay={() => setConfirmExit(false)} />}
          </>
        )}
      </GameShell>,
      document.body
      )}
    </>
  );
}

/** A part below the fold mounts this long after the page has loaded, if nobody has scrolled to it first. */
const IDLE_MOUNT_MS = 3000;
/** Mounts its children once they're near the screen, or once the page is idle after loading (or straight away when `eager`), holding their room until then. */
function WhenNear({ children, minHeight, eager = false }: { children: React.ReactNode; minHeight: number; eager?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(eager);
  useEffect(() => {
    if (eager) setShow(true);
  }, [eager]);
  useEffect(() => {
    if (show) return;
    // A link to the duels (#duels, #ranked) wants them at once.
    if (/^#(duels|ranked)$/.test(window.location.hash) || typeof IntersectionObserver === "undefined") return setShow(true);
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setShow(true), { rootMargin: "800px 0px" });
    if (ref.current) io.observe(ref.current);
    // Or once the page has loaded and gone quiet, so it's ready before anyone scrolls down.
    let timer = 0;
    let idle = 0;
    const later = () => {
      timer = window.setTimeout(() => {
        if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(() => setShow(true), { timeout: 2000 });
        else setShow(true);
      }, IDLE_MOUNT_MS);
    };
    if (document.readyState === "complete") later();
    else window.addEventListener("load", later, { once: true });
    return () => {
      io.disconnect();
      window.removeEventListener("load", later);
      window.clearTimeout(timer);
      if (idle && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle);
    };
  }, [show]);
  return (
    <div ref={ref} style={show ? undefined : { minHeight }}>
      {show ? children : null}
    </div>
  );
}

function ModeCard({
  preview,
  whole,
  icon,
  title,
  blurb,
  stat,
  disabled,
  onClick,
  warm,
}: {
  preview: string;
  /** The picture is a map: show all of it instead of cropping it to the frame. */
  whole?: boolean;
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
      className="menu-item group flex flex-col gap-3 overflow-hidden rounded-lg border bg-card p-4 text-left transition-colors hover:border-screen/60 max-md:flex-row max-md:items-center max-md:p-3"
    >
      {whole ? (
        // A map: all of it, whatever its shape; the frame around it is the maps' own sea colour.
        <span className="relative block aspect-[16/10] w-full overflow-hidden rounded-sm bg-[#165c97] opacity-85 transition-opacity group-hover:opacity-100 max-md:w-28 max-md:shrink-0" data-testid="mode-card-map">
          {/* eslint-disable-next-line @next/next/no-img-element -- CDN-cached preview */}
          <img src={preview} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-contain" />
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- CDN-cached preview
        <img
          src={preview}
          alt=""
          loading="lazy"
          decoding="async"
          className="aspect-[16/10] w-full rounded-sm bg-shade/30 object-cover opacity-85 transition-opacity group-hover:opacity-100 max-md:w-28 max-md:shrink-0"
        />
      )}
      {/* A phone lists the modes as rows (picture, then the words), so both fit on screen. */}
      <span className="flex min-w-0 flex-col gap-1 md:contents">
        <span className="flex items-center gap-2 text-screen">
          {icon}
          <span className="font-display text-2xl font-bold uppercase text-foreground max-md:text-lg max-md:leading-tight">{title}</span>
        </span>
        <span className="text-sm text-muted-foreground max-md:line-clamp-2 max-md:text-xs">{blurb}</span>
        {stat && <span className="hud-label text-warning">{stat}</span>}
      </span>
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
  scores,
  round,
  streak,
  pinImage,
  onNext,
  onExit,
  t,
  names,
}: {
  game: Game;
  current: Played;
  /** Every round's score so far, this one last. */
  scores: number[];
  round: number;
  streak: number;
  pinImage?: string;
  onNext: () => void;
  onExit: () => void;
  t: SoloT;
  names: GeoLocal;
}) {
  const fmt = (n: number) => formatNumber(n, t.locale);
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
    <div className="relative flex h-full flex-col md:block" data-testid="geo-reveal">
      {/* Phone: the map takes what the bottom bar leaves, so the camera frames both pins in view. */}
      <div className="relative min-h-0 flex-1 md:absolute md:inset-x-0 md:top-0 md:bottom-[6.75rem]">
        <GeoMap region={game.region} revealed={[{ guess: g, answer: graded.answer, image: pinImage }]} fit={{ delay: LINE_DRAW_MS, duration: FIT_MS }} fill controls={false} />
      </div>
      <div className="geo-safe-tl absolute left-3 top-3 z-20">
        <ExitButton onClick={onExit} />
      </div>
      {/* The score tracker: this round's slot fills as its score counts up, and the total with it. */}
      {!isStreak && (
        <div className="geo-safe-tr absolute right-3 top-3 z-20 hidden lg:block">
          <ScoreTracker
            rounds={game.rounds}
            scores={[...scores.slice(0, -1), shown]}
            current={scores.length - 1}
            total={fmt(scores.slice(0, -1).reduce((a, b) => a + b, 0) + shown)}
          />
        </div>
      )}
      <Notch>
        <div className="text-center">
          <div className="font-display text-xl font-bold uppercase italic leading-none tracking-wide sm:text-2xl">{isStreak ? (
              t("hud.streak", { n: streak })
            ) : (
              <>
                {t("hud.round", { n: roundNumber })}
                <span className="text-white/50">/{game.rounds}</span>
              </>
            )}
          </div>
          <div className="mt-0.5 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c8bfff]">{names.map(game.region)}</div>
        </div>
      </Notch>

      {/* The bottom bar. */}
      <motion.div {...rise(0.15)} className="relative z-20 shrink-0 border-t-4 md:absolute md:inset-x-0 md:bottom-0 border-[#a99cff] bg-[#1e1a3f]/95 text-white shadow-[0_-12px_40px_rgba(0,0,0,0.5)] backdrop-blur">
        <div className="mx-auto grid max-w-6xl items-center gap-3 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:gap-6 sm:px-6 md:grid-cols-[1fr_auto_1fr]">
          {/* The score (or the streak) and its bar. */}
          <div className="min-w-0 text-center md:text-left">
            {isStreak ? (
              <>
                <p className={cn("hud-label", graded.hit ? "!text-[#9be15d]" : "!text-[#ff5a5a]")}>
                  {graded.hit ? (isWorld ? t("reveal.rightRegion") : t("reveal.correct")) : isWorld ? t("reveal.wrongRegion") : t("reveal.over")}
                </p>
                <p className="flex items-center justify-center gap-2 font-display text-4xl font-bold italic md:justify-start md:text-3xl lg:text-4xl">
                  {graded.hit ? <Check className="h-8 w-8 text-[#9be15d]" aria-hidden /> : <X className="h-8 w-8 text-[#ff5a5a]" aria-hidden />}
                  {graded.hit ? t("reveal.inARow", { n: streak }) : t("reveal.final", { n: streak })}
                </p>
              </>
            ) : (
              <>
                <p className="hud-label !text-[#c8bfff]">{verdict(graded.score, t)}</p>
                <p className="geo-glow font-display text-4xl font-bold italic tabular-nums sm:text-5xl" data-testid="geo-round-score">
                  {fmt(shown)} <span className="text-lg not-italic text-white/60">{t("hud.pts")}</span>
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
                  ? t("reveal.rightGame", { bonus: fmt(graded.gameGuess.bonus) })
                  : graded.gameGuess.guessed
                    ? t("reveal.wrongGame", { game: names.game(geoFamily(graded.gameGuess.guessed).name) })
                    : t("reveal.noGame", { bonus: fmt(GEO_GAME_BONUS) })}
              </p>
            )}
          </div>

          {/* The distance pill and the place. */}
          <motion.div {...rise(reduced ? 0 : (LINE_DRAW_MS + FIT_MS) / 1000)} className="flex min-w-0 flex-col items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border-2 border-[#a99cff] bg-[#4cbb17] px-4 py-1.5 font-display text-sm font-bold uppercase italic tracking-wide text-white shadow-lg" data-testid="geo-distance">
              <MapPinIcon className="h-4 w-4" aria-hidden />
              {graded.timedOut ? t("reveal.timeUp") : distanceText(graded.answer.squares, t)}
            </span>
            {/* The learn card: the place, its game, one fact from the Pokédex's place data, and where to read more. */}
            <LearnCard answer={graded.answer} shot={current.shot} map={game.region} learn={graded.learn} />
          </motion.div>

          {/* Next, with its hotkey, and the report link. */}
          <div className="flex flex-col items-center gap-1.5 md:items-end">
            <button
              type="button"
              onClick={onNext}
              data-testid="geo-next"
              className="flex min-h-12 w-full max-w-xs items-center justify-center gap-2 rounded-md bg-[#4cbb17] px-6 py-1.5 font-display text-base leading-tight font-bold uppercase tracking-wider text-white shadow-lg transition-[background-color,transform] hover:bg-[#58d01c] active:scale-[0.98]"
            >
              {graded.done ? (isStreak ? t("reveal.results") : t("reveal.summary")) : t("reveal.next")} ▶
              <kbd aria-hidden className="ml-1 hidden rounded border border-white/40 px-1.5 text-[10px] font-normal normal-case sm:inline [@media(pointer:coarse)]:!hidden">{t("reveal.space")}</kbd>
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
