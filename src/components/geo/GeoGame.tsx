"use client";

import { useEffect, useRef, useState } from "react";
import Link from "@/components/ui/Link";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CalendarRange, Check, ChevronDown, Compass, Flame, Globe2, Loader2, Shapes, SlidersHorizontal, MapPin as MapPinIcon, Swords, Trophy, Users, X, Map as MapIcon } from "lucide-react";
import { GEO_FILTER_MIN_PLACES, GEO_MAX_ROUND_SCORE, GEO_ROUNDS, WORLD_REGION, isGeoRounds, type GeoRounds, geoBoardKey, geoDailyRegion, geoMapRank, type GeoChallenge, type GeoGuessResponse, type GeoKind, type GeoRegionInfo, type GeoRoundPublic, type GeoStartResponse } from "@/lib/geo-types";
import { dailyNumber } from "@/lib/daily";
import { useToday } from "@/lib/use-today";
import { recordGeoGame, useProgress, type BadgeDef } from "@/lib/progress";
import { play, unlockAudio } from "@/lib/sound";
import { guessrSquare } from "@/lib/share";
import type { GeoDifficulty } from "@/lib/geo-difficulty";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GeoMap, LINE_DRAW_MS, WORLD_MAP as WORLD_MAP_SRC, WORLD_THUMB, mapAspect, type MapPin } from "./GeoMap";
import { RegionStreakCard } from "./RegionStreakCard";
import { useAccount } from "@/lib/account";
import { avatarSrc } from "@/lib/avatar";
import { GlobePreview } from "@/components/globe/GlobePreview";
import { GeoHowToLoader, HowToHelpButton } from "./GeoHowToButton";
import { HubSection, HubTile, TileFlag } from "./HubParts";
import { GeoYou } from "./GeoYou";
import { AchievementToasts, useGeoProgress, type MyGeoProgress } from "./GeoAchievements";
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
/** A game got ready on hover is used for a click this soon after. */
const PREFETCH_TTL_MS = 60_000;
/** The likeliest game is started ahead this long after the page has loaded, clear of its first paints. */
const WARM_AFTER_LOAD_MS = 2000;
import { ShotCarousel, shotFit } from "./ShotCarousel";
import { BAR_BTN, CountdownPill, ExitButton, FullscreenButton, GameShell, GuessButton, HudDials, MapDock, Notch, RoundBadge, TimerDial, ValueDial, usePhone } from "./GameShell";
import { roundViewsOf } from "@/lib/geo-look";
import { DifficultyPicker, GeoSettingsButton, RoundsPicker } from "./GeoSettings";
import { DEFAULT_GEO_SETTINGS, GEO_ZOOM, readGeoSettings, rememberGeoSettings, secondsLeft, visibleViews, zoomOrigin, type GeoPlaySettings } from "@/lib/geo-settings";
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
  /** Set on /pokeguessr/c/<token>: a friend's game to replay. */
  challenge?: GeoChallenge & { token: string; region: string; era?: GeoEra; families?: GeoFamilyId[]; difficulty?: "easy" | "hard" };
}

/** A tile or card picture is a few hundred pixels across: the world map's small copy stands in for the 5,850 px original. */
const tileImage = (src: string) => (src === WORLD_MAP_SRC ? WORLD_THUMB : src);

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
  const [roundStartedAt, setRoundStartedAt] = useState(0);
  /** The round's screenshot is loaded and decoded: only then does the Timer run. */
  const [shotReady, setShotReady] = useState(false);
  const [now, setNow] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const phone = usePhone();
  const [reward, setReward] = useState<Reward | null>(null);
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

  // /pokeguessr?play=daily (the home page's Play) starts today's Daily straight away; ?play=game a game on the map.
  // It waits for the local date, by which time the saved settings have been read too.
  const autoPlay = useRef(false);
  useEffect(() => {
    if (autoPlay.current || !today || challenge || phase !== "setup") return;
    autoPlay.current = true;
    const url = new URL(window.location.href);
    const play = url.searchParams.get("play");
    if (play !== "daily" && play !== "game") return;
    url.searchParams.delete("play");
    window.history.replaceState(null, "", url);
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
  function prefetch(opts: StartOpts, withMap = true) {
    if (phase !== "setup") return;
    preloadAfterRound();
    if (withMap) void preloadImage(WORLD_MAP_SRC);
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
  };
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
      if (!map) throw new Error(t("errors.noMap"));
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
      setError(err instanceof Error ? err.message : t("errors.start"));
      setPhase("error");
    }
  }

  /** `timeUp`: the round's clock ran out, so the pin (if any) is guessed where it is. */
  async function guess(timeUp = false) {
    if (!game || (!pick && !timeUp) || phase !== "guessing") return;
    setPhase("submitting");
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
      setError(err instanceof Error ? err.message : t("errors.grade"));
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
    else if (timeLeft !== null && timeLeft <= 5 && phase === "guessing") play("countdown");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once, when the clock hits zero
  }, [timeLeft, phase]);

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
    const weeklyLeft = week ? geoWeeklyLeftParts(week, Date.now()) : null;
    // The duel and party cards name the map as it stands: in the page's language.
    const shownRegion = t.locale === "en" ? region : { ...region, name: names.map(region) };
    return (
      <div className="mx-auto max-w-6xl space-y-12">
        <div className="relative space-y-3 text-center">
          <HowToHelpButton className="absolute right-0 top-0" />
          <p className="hud-label max-md:hidden text-screen">{t("hub.fieldSurvey", { map: names.map(region) })}</p>
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-6xl">
            Poké<span className="text-primary">Guessr</span>
          </h1>
          <p className="mx-auto max-w-xl text-muted-foreground">{t("hub.tagline")}</p>
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

        {/* ---- Play ---- */}
        <HubSection id="play" eyebrow={t("hub.play.eyebrow")} title={t("hub.play.title")}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <HubTile
              testId="geo-solo-card"
              tone="screen"
              image={region.preview ?? tileImage(region.map.src)}
              icon={<MapPinIcon className="h-5 w-5" />}
              label={t("hub.solo.label", { map: names.map(region) })}
              title={t("hub.solo.title")}
              blurb={t("hub.solo.blurb")}
              stat={bestGame ? t("hub.best", { score: fmt(bestGame) }) : null}
              action={
                <Button variant="outline" className="w-full" onClick={toSolo} aria-expanded={soloOpen} aria-controls="solo" data-testid="geo-solo-setup">
                  <SlidersHorizontal className="h-4 w-4" aria-hidden />{` ${t("hub.solo.setup")}`}
                  <ChevronDown className={cn("h-4 w-4 transition-transform", soloOpen && "rotate-180")} aria-hidden />
                </Button>
              }
            />
            <HubTile
              testId="geo-daily-card"
              className="max-sm:order-first"
              priority
              tone="warning"
              image={tileImage(dailyMap?.map.src ?? WORLD_MAP_SRC)}
              icon={<Compass className="h-5 w-5" />}
              label={`${t("hub.daily.label", { num: today ? `#${dailyNumber(today)}` : "" })}${dailyMap ? ` · ${names.map(dailyMap)}` : ""}`}
              title={t("hub.daily.title")}
              badge={dailyDone !== undefined ? <TileFlag tone="success">{t("hub.played")}</TileFlag> : undefined}
              blurb={dailyDone !== undefined ? t("hub.daily.scored", { score: fmt(dailyDone) }) : t("hub.daily.blurb")}
              action={
                <Button
                  className="w-full"
                  disabled={!today || loading}
                  onClick={() => today && void start({ kind: "game", daily: today })}
                  {...warmProps({ kind: "game", daily: today || "today" })}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Compass className="h-4 w-4" aria-hidden />}
                  {dailyDone !== undefined ? t("hub.daily.again") : t("hub.daily.play")}
                </Button>
              }
            />
            <HubTile
              testId="geo-weekly-card"
              tone="success"
              // A region's week shows that region's map (Classic shows a screenshot, Daily the world map);
              // a themed week (Gyms, Towns, Routes) is played on the world map, so it keeps its own screenshot.
              image={weeklyMap ? (weeklyMap.theme ? (weeklyMap.preview ?? tileImage(weeklyMap.map.src)) : tileImage(weeklyMap.map.src)) : null}
              icon={<CalendarRange className="h-5 w-5" />}
              label={week ? `${t("hub.weekly.numbered", { n: geoWeeklyNumber(week) })}${weeklyMap ? ` · ${names.map(weeklyMap)}` : ""}` : t("hub.weekly.word")}
              title={t("hub.weekly.title")}
              badge={
                weeklyDone !== undefined ? (
                  <TileFlag tone="success">{t("hub.played")}</TileFlag>
                ) : weeklyLeft ? (
                  <TileFlag>{t("hub.weekly.endsIn", { left: t(`hub.weekly.${weeklyLeft.unit}`, { d: weeklyLeft.d, h: weeklyLeft.h, m: weeklyLeft.m }) })}</TileFlag>
                ) : undefined
              }
              blurb={weeklyDone !== undefined ? t("hub.weekly.scored", { score: fmt(weeklyDone) }) : t("hub.weekly.blurb")}
              action={
                <Button
                  variant="success"
                  className="w-full"
                  disabled={!week || !weeklyMap || loading}
                  onClick={() => void start({ kind: "game", weekly: true })}
                  onPointerEnter={() => prefetch({ kind: "game", weekly: true })}
                  data-testid="geo-weekly-play"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarRange className="h-4 w-4" aria-hidden />}
                  {weeklyDone !== undefined ? t("hub.weekly.again") : t("hub.weekly.play")}
                </Button>
              }
            />
            <RegionStreakCard />
          </div>

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

                <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:gap-8">
                  <RoundsPicker value={playRounds} onChange={setRounds} max={places} label={t("hub.solo.rounds")} />
                  <DifficultyPicker value={difficulty} onChange={setDifficulty} />
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
        </HubSection>

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
            {/* Duels play an era when the map has enough of it (hand-picked games are practice), else every game. */}
            <DuelCard
              region={shownRegion}
              places={places}
              era={filter.era && filterPlaces(region, { era: filter.era, families: [] }) >= GEO_FILTER_MIN_PLACES ? filter.era : undefined}
              queue={duelQueue}
              onQueue={setDuelQueue}
            />
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
  }

  if (phase === "error" || !game) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="space-y-4 p-6 text-center">
          <p className="font-display text-xl font-bold uppercase">{t("errors.title")}</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={() => setPhase("setup")}>{g("shell.back")}</Button>
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
    names.map(game.region),
    game.filter.families.length ? t("hud.picked") : game.filter.era ? names.era(game.filter.era) : null,
    game.daily ? t("hud.daily", { n: dailyNumber(game.daily) }) : null,
    game.weekly ? t("hub.weekly.numbered", { n: geoWeeklyNumber(game.weekly) }) : null,
    game.difficulty ? names.difficulty(game.difficulty) : null,
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
  /** Top-right: the score so far (or the streak), and the help button. */
  const chips = (
    <div className="geo-safe-tr absolute right-3 top-3 z-20 flex items-center gap-2">
      {!isStreak && (
        <div className="flex h-9 items-center gap-2 rounded-md bg-black/55 px-3 backdrop-blur" data-testid="geo-score-chip">
          <span className="hud-label hidden !text-white/60 sm:inline">{t("hud.score")}</span>
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
        {() => <RoundReveal game={game} current={current} round={roundNumber} streak={streak} pinImage={pinImage} onNext={next} onExit={() => setPhase("setup")} t={t} names={names} />}
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
      <div className="absolute inset-0" style={{ bottom: "var(--geo-bar)" }}>
        <ShotCarousel views={views} index={viewIndex} onIndex={setViewIndex} onZoom={() => setZoomed(true)} zoom={zoom} fs dock blur={game.round.blur} priority={game.round.index === 0} />
      </div>
      {phone ? (
        <>
          {/* Phone, GeoGuessr's layout: the dials top-left, the round badge top-right, the tools in the bottom bar. */}
          {(timeLeft !== null || !isStreak) && (
            <HudDials>
              {timeLeft !== null && <TimerDial ms={timeLeft * 1000} totalMs={timer * 1000} urgentMs={10_000} testId="geo-time-left" />}
              {!isStreak && <ValueDial value={fmt(total)} unit={t("hud.pts")} testId="geo-score-chip" />}
            </HudDials>
          )}
          <RoundBadge testId="geo-round" label={isStreak ? t("hud.streakWord") : g("round")} value={isStreak ? streak : Math.min(roundNumber, game.rounds)} of={isStreak ? undefined : game.rounds} mode={modeLine} />
        </>
      ) : (
        <>
          <div className="geo-safe-tl absolute left-3 top-3 z-20 flex items-center gap-2">
            <ExitButton onClick={() => setPhase("setup")} />
            <FullscreenButton fs={fs} onClick={toggle} />
          </div>
          {notch}
          {chips}
        </>
      )}

      {/* GeoGuessr-style mini-map (the atlas): docked bottom-right, grows on hover; a bottom sheet on phones. */}
      <MapDock aspect={mapAspect(game.region)}
        hasPin={!!pick}
        map={({ fill }) => (
          <GeoMap
            land={fill}
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
            <button type="button" onClick={() => setPhase("setup")} className={BAR_BTN} aria-label={g("shell.back")} title={g("shell.back")} data-testid="geo-exit" data-keep>
              <X className="h-5 w-5" />
            </button>
            <HowToHelpButton className={cn(BAR_BTN, "!p-0 !text-white")} />
            <FullscreenButton fs={fs} onClick={toggle} className={cn(BAR_BTN, "!h-11 !w-11 !rounded-full !bg-[#4a3f9e] !backdrop-blur-none")} />
          </>
        }
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
      )}
    </GameShell>
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
      <Notch>
        <div className="text-center">
          <div className="font-display text-xl font-bold uppercase italic leading-none tracking-wide sm:text-2xl">{isStreak ? t("hud.streak", { n: streak }) : t("hud.round", { n: roundNumber })}</div>
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
                <p className="flex items-center justify-center gap-2 font-display text-4xl font-bold italic md:justify-start">
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
