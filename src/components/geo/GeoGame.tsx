"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Copy,
  Compass,
  Flame,
  Globe2,
  Link2,
  Loader2,
  Shapes,
  MapPin as MapPinIcon,
  RotateCcw,
  Swords,
  Timer,
  Trophy,
  X,
  Map as MapIcon,
} from "lucide-react";
import {
  GEO_FILTER_MIN_PLACES,
  GEO_MAX_ROUND_SCORE,
  GEO_ROUNDS,
  WORLD_REGION,
  isGeoRounds,
  type GeoRounds,
  geoBoardKey,
  geoDailyRegion,
  geoMapRank,
  type GeoChallenge,
  type GeoGuessResponse,
  type GeoKind,
  type GeoRegionInfo,
  type GeoRoundPublic,
  type GeoStartResponse,
} from "@/lib/geo-types";
import { dailyNumber } from "@/lib/daily";
import { useToday } from "@/lib/use-today";
import { recordGeoGame, useProgress, type BadgeDef } from "@/lib/progress";
import { play, unlockAudio } from "@/lib/sound";
import { copyText, guessrShareText, guessrSquare, shareOrCopy, shareUrl, type GuessrShareResult } from "@/lib/share";
import { GEO_DIFFICULTY_NAMES, type GeoDifficulty } from "@/lib/geo-difficulty";
import { COMPARE_MAX, COMPARE_MIN_PLAYERS, bucketOf, percentBeaten, type GeoDailyStats } from "@/lib/geo-compare";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BadgeMedal } from "@/components/game/BadgeMedal";
import { CopyFallback } from "@/components/quiz/CopyFallback";
import { ShareButton } from "@/components/share/ShareButton";
import { GeoMap, type MapPin } from "./GeoMap";
import { DuelCard } from "./DuelCard";
import { GlobePreview } from "@/components/globe/GlobePreview";
import { ReportShot } from "./ReportShot";
import { GeoHowTo, HowToHelpButton } from "./GeoHowTo";
import { ShotCarousel, shotFit } from "./ShotCarousel";
import { GameShell, dockClass } from "./GameShell";
import { roundViewsOf } from "@/lib/geo-look";
import { DifficultyPicker, GeoSettingsButton, RoundsPicker } from "./GeoSettings";
import {
  DEFAULT_GEO_SETTINGS,
  GEO_ZOOM,
  readGeoSettings,
  rememberGeoSettings,
  secondsLeft,
  visibleViews,
  zoomOrigin,
  type GeoPlaySettings,
} from "@/lib/geo-settings";
import { GameFilter, GameGuessPicker, type FilterChoice, filterPlaces, gameGuessOptions } from "./GameFilter";
import { GEO_ERA_NAMES, GEO_GAME_BONUS, geoFamily, type GeoEra, type GeoFamilyId } from "@/lib/geo-families";
import { cn } from "@/lib/utils";
import { preloadImage } from "@/lib/preload";
import { isWorldwide, themeOf } from "@/lib/geo-themes";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";

type Phase = "setup" | "loading" | "guessing" | "submitting" | "revealed" | "results" | "error";

interface Game {
  /** The map being played (a daily or a challenge picks its own). */
  region: GeoRegionInfo;
  kind: GeoKind;
  /** Rounds in a game (5 for the Daily). */
  rounds: number;
  daily?: string;
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

interface Played {
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

interface Reward {
  xp: number;
  best: boolean;
  newBadges: BadgeDef[];
}

const fmt = (n: number) => n.toLocaleString("en-US");
const maxTotal = (rounds: number) => rounds * GEO_MAX_ROUND_SCORE;

const emoji = guessrSquare;

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
function placeName(answer: { name: string; parent?: string; region?: string }, map?: GeoRegionInfo): string {
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

/** The answer on the world atlas (Kanto's own map predates the world data, so its places carry no region). */
const atlasHref = (answer: { name: string; parent?: string; region?: string }) =>
  `/atlas?q=${encodeURIComponent(`${clean(answer.parent ?? answer.name)} · ${answer.region ?? "Kanto"}`)}`;

function distanceText(squares: number): string {
  if (squares === 0) return "Right on it!";
  return `${squares.toFixed(1)} map square${squares === 1 ? "" : "s"} away`;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Counts up to `value` (eased) whenever it changes. */
function useCountUp(value: number, ms = 700): number {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const v = Math.round(origin + (value - origin) * (1 - (1 - t) ** 3));
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

export interface GeoGameProps {
  /** Every map: the world and each region. */
  regions: GeoRegionInfo[];
  /** Set on /guessr/c/<token>: a friend's game to replay. */
  challenge?: GeoChallenge & { token: string; region: string; era?: GeoEra; families?: GeoFamilyId[]; difficulty?: "easy" | "hard" };
}

export function GeoGame(props: GeoGameProps) {
  return (
    <>
      <GeoGameInner {...props} />
      {!props.challenge && <GeoHowTo />}
    </>
  );
}

function GeoGameInner({ regions: allRegions, challenge }: GeoGameProps) {
  const today = useToday();
  const progress = useProgress();
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

  async function start(opts: { kind: GeoKind; daily?: string; challenge?: string }) {
    unlockAudio();
    setPhase("loading");
    setError(null);
    try {
      const bonus: { guessGame?: boolean } = {};
      const picked = { era: filter.era, families: filter.families.length ? filter.families : undefined };
      // Free play takes the picked difficulty; a challenge plays its own, the Daily always Normal.
      const mode = opts.challenge ? challenge?.difficulty : opts.daily ? undefined : chosenMode;
      const body = opts.challenge
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
              ...bonus,
            };
      const res = await post<GeoStartResponse>("/api/geo", body);
      const map = byId(res.region) ?? allRegions.find((r) => r.id === res.region);
      if (!map) throw new Error("That map isn't available right now.");
      // A friend's challenge plays on their filter, the daily on every game.
      const played: FilterChoice = opts.challenge
        ? { era: challenge?.era, families: challenge?.families ?? [] }
        : opts.daily
          ? { era: undefined, families: [] }
          : filter;
      setGame({
        region: map,
        kind: opts.kind,
        rounds: opts.challenge && challenge && isGeoRounds(challenge.rounds.length) ? challenge.rounds.length : opts.kind === "game" && !opts.daily ? playRounds : GEO_ROUNDS,
        daily: opts.daily,
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
    try {
      const at = pick ?? { x: 0, y: 0, timeout: true };
      const graded = await post<GeoGuessResponse>("/api/geo/guess", { token: game.token, ...at, ...(game.guessGame && gamePick ? { family: gamePick } : {}) });
      const nextPlayed = [...played, { guess: pick, graded, shot: game.round.shot }];
      setPlayed(nextPlayed);
      setGame({ ...game, token: graded.token });
      rememberArea(graded.answer);
      const good = game.kind === "streak" ? graded.hit : graded.score >= 2500;
      play(good ? (game.kind === "streak" && graded.hit && nextPlayed.length % 5 === 0 ? "streak" : "correct") : "wrong");
      if (graded.next) new window.Image().src = graded.next.shot;
      if (graded.done && graded.result) {
        setReward(
          recordGeoGame(boardOf(game), {
            kind: game.kind,
            score: graded.result.score,
            rounds: nextPlayed.map((p) => p.graded.score),
            daily: game.daily,
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
  useEffect(() => {
    if (!roundShot) return;
    let off = false;
    setShotReady(false);
    void preloadImage(roundShot).then(() => {
      if (off) return;
      setRoundStartedAt(Date.now());
      setShotReady(true);
    });
    return () => {
      off = true;
    };
  }, [roundShot]);
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

  // ---- setup -----------------------------------------------------------------
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
    return (
      <div className="mx-auto max-w-4xl space-y-8">
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
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Swords className="h-4 w-4" aria-hidden />}
                  Accept challenge
                </Button>
              </div>
            </div>
          </Card>
        )}

        <Card className="overflow-hidden">
          <div className="grid md:grid-cols-[1fr_auto]">
            <CardContent className="space-y-2 p-6">
              <p className="hud-label text-warning">
                Daily game {today ? `#${dailyNumber(today)}` : ""}
                {dailyMap ? ` · ${dailyMap.name}` : ""}
              </p>
              <p className="font-display text-2xl font-bold uppercase">5 places · same for everyone</p>
              <p className="text-sm text-muted-foreground">
                {dailyDone !== undefined
                  ? `You scored ${fmt(dailyDone)} today. Replays don't count for the leaderboard.`
                  : `Five places in ${dailyMap ? where(dailyMap) : "the Pokémon world"}, from any game. Your first game today goes on the daily leaderboard.`}
              </p>
            </CardContent>
            <div className="flex items-center p-6 pt-0 md:pt-6">
              <Button
                size="lg"
                className="w-full md:w-auto"
                disabled={!today || loading}
                onClick={() => today && void start({ kind: "game", daily: today })}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Compass className="h-4 w-4" aria-hidden />}
                {dailyDone !== undefined ? "Play again" : "Play today's"}
              </Button>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-bold uppercase">Free play</h2>
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
            />
          </div>
        </div>

        {/* Duels play an era when the map has enough of it (hand-picked games are practice), else every game. */}
        <DuelCard region={region} places={places} era={filter.era && filterPlaces(region, { era: filter.era, families: [] }) >= GEO_FILTER_MIN_PLACES ? filter.era : undefined} />

        <Card className="overflow-hidden border-primary/40" data-testid="globe-card">
          <CardContent className="flex flex-col items-center gap-4 p-6 md:flex-row">
            <GlobePreview />
            <div className="min-w-0 flex-1 space-y-2 text-center md:text-left">
              <p className="hud-label text-primary">3D · Explore</p>
              <p className="font-display text-2xl font-bold uppercase">World Globe</p>
              <p className="text-sm text-muted-foreground">Spin the whole Pokémon world in 3D and zoom from regions down to every route.</p>
            </div>
            <Link href="/guessr/globe" className={cn(buttonVariants(), "w-full md:w-auto")}>
              Open the globe
            </Link>
          </CardContent>
        </Card>

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
    return (
      <GeoSummary
        game={game}
        played={played}
        resultToken={last?.resultToken}
        challengeToken={last?.challengeToken}
        challenge={isChallenge ? challenge : undefined}
        reward={reward}
        onRestart={() => setPhase("setup")}
      />
    );
  }

  const isStreak = game.kind === "streak";
  const roundNumber = played.length + (phase === "revealed" ? 0 : 1);
  const hud = (
    <div className="flex items-stretch justify-between gap-3 rounded-md border bg-card/90 px-4 py-2 backdrop-blur">
      <div className="min-w-0">
        <div className="hud-label">Map</div>
        <div className="truncate font-display font-bold uppercase">
          {game.region.name}
          {game.filter.families.length ? " · Picked games" : game.filter.era ? ` · ${GEO_ERA_NAMES[game.filter.era]}` : ""}
          {game.daily ? ` · Daily #${dailyNumber(game.daily)}` : isStreak ? " · Streak" : ""}
          {game.difficulty ? ` · ${GEO_DIFFICULTY_NAMES[game.difficulty]}` : ""}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-6 text-right">
        <HowToHelpButton />
        {timeLeft !== null && (
          <div>
            <div className="hud-label">Time</div>
            <div
              className={cn("flex items-center justify-end gap-1 font-pixel tabular-nums", timeLeft <= 10 ? "text-destructive" : "text-foreground")}
              data-testid="geo-time-left"
              aria-live={timeLeft <= 10 ? "polite" : "off"}
            >
              <Timer className="h-3.5 w-3.5" aria-hidden />
              {timeLeft}
            </div>
          </div>
        )}
        {isStreak ? (
          <div>
            <div className="hud-label">Streak</div>
            <div className="flex items-center justify-end gap-1 font-pixel tabular-nums text-warning">
              <Flame className="h-3.5 w-3.5" aria-hidden />
              {streak}
            </div>
          </div>
        ) : (
          <>
            <div>
              <div className="hud-label">Round</div>
              <div className="font-pixel tabular-nums">
                {Math.min(roundNumber, game.rounds)}/{game.rounds}
              </div>
            </div>
            <div>
              <div className="hud-label">Score</div>
              <div className="font-pixel tabular-nums text-screen">{fmt(total)}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  // ---- round result ------------------------------------------------------------
  if (phase === "revealed" && current) {
    return (
      <GameShell>
        {({ fs }) => (
          <div className={fs ? "mx-auto max-w-6xl p-4" : undefined}>
            <RoundReveal game={game} current={current} streak={streak} hud={hud} onNext={next} />
          </div>
        )}
      </GameShell>
    );
  }

  // ---- guessing ------------------------------------------------------------------
  const views = visibleViews(roundViewsOf(game.round), game.settings);
  const zoom = game.settings.zoomed ? (src: string) => ({ scale: GEO_ZOOM, origin: zoomOrigin(src) }) : undefined;
  const zoomedView = zoom?.(views[viewIndex] ?? game.round.shot);
  return (
    <GameShell>
      {({ fs, toggle }) => (
    <div className={fs ? "relative h-full" : "mx-auto max-w-6xl space-y-3"}>
      {fs ? <div className="absolute left-14 right-14 top-3 z-20">{hud}</div> : hud}
      <div className={fs ? "absolute inset-0" : "relative"}>
        <ShotCarousel views={views} index={viewIndex} onIndex={setViewIndex} onZoom={() => setZoomed(true)} zoom={zoom} fs={fs} onFullscreen={toggle} />

        {/* GeoGuessr-style mini-map (the atlas): docked bottom-right on desktop, grows on hover. */}
        <div className={dockClass(fs)}>
          <div className="rounded-md lg:opacity-80 lg:shadow-2xl lg:transition-opacity lg:group-hover:opacity-100">
            <GeoMap
              region={game.region}
              pick={pick}
              onPick={(p) => {
                setPick(p);
                play("click");
              }}
            />
          </div>
          {game.guessGame && pick && (
            <GameGuessPicker options={gameGuessOptions(game.region, game.filter)} value={gamePick} onChange={setGamePick} />
          )}
          <Button className="w-full" size="lg" disabled={!pick || phase === "submitting"} onClick={() => void guess()}>
            {phase === "submitting" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MapPinIcon className="h-4 w-4" aria-hidden />}
            {pick ? "Guess" : "Place your pin on the map"}
          </Button>
        </div>
      </div>

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

function ModeCard({
  preview,
  icon,
  title,
  blurb,
  stat,
  disabled,
  onClick,
}: {
  preview: string;
  icon: React.ReactNode;
  title: string;
  blurb: string;
  stat: string | null;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
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

function RoundReveal({
  game,
  current,
  streak,
  hud,
  onNext,
}: {
  game: Game;
  current: Played;
  streak: number;
  hud: React.ReactNode;
  onNext: () => void;
}) {
  const { graded, guess: g } = current;
  const shown = useCountUp(graded.score);
  const isStreak = game.kind === "streak";
  const isWorld = isWorldwide(game.region.id);
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {hud}
      <GeoMap region={game.region} revealed={[{ guess: g, answer: graded.answer }]} />
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 text-center">
        {isStreak ? (
          <div>
            <p className={cn("hud-label", graded.hit ? "text-success" : "text-destructive")}>
              {graded.hit ? (isWorld ? "Right region!" : "Correct!") : isWorld ? "Wrong region. Streak over" : "Streak over"}
            </p>
            <p className="flex items-center justify-center gap-2 font-display text-4xl font-bold">
              {graded.hit ? <Check className="h-8 w-8 text-success" aria-hidden /> : <X className="h-8 w-8 text-destructive" aria-hidden />}
              {graded.hit ? `${streak} in a row` : `Final streak: ${streak}`}
            </p>
          </div>
        ) : (
          <>
            <div>
              <p className="hud-label text-screen">{verdict(graded.score)}</p>
              <p className="font-display text-4xl font-bold tabular-nums">{fmt(shown)} points</p>
            </div>
            <div className="meter mx-auto max-w-xl">
              <motion.div
                className="h-full bg-success"
                initial={{ width: 0 }}
                animate={{ width: `${(graded.score / GEO_MAX_ROUND_SCORE) * 100}%` }}
                transition={{ duration: 0.7 }}
              />
            </div>
          </>
        )}
        {graded.gameGuess && (
          <p className={cn("text-sm font-semibold", graded.gameGuess.correct ? "text-success" : "text-muted-foreground")} data-testid="geo-game-bonus">
            {graded.gameGuess.correct
              ? `Right game! +${fmt(graded.gameGuess.bonus)} bonus`
              : graded.gameGuess.guessed
                ? `Not ${geoFamily(graded.gameGuess.guessed).name}: no bonus`
                : `No game named: no bonus (worth ${fmt(GEO_GAME_BONUS)})`}
          </p>
        )}
        <div className="space-y-2 text-muted-foreground">
          <p>
            It was <span className="font-semibold text-foreground" data-testid="geo-answer-place">{placeName(graded.answer, game.region)}</span>
          </p>
          <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-sm">
            <span className="rounded-sm border px-2 py-0.5 text-xs text-foreground" data-testid="geo-answer-game">
              Pokémon {graded.answer.game}
            </span>
            <span data-testid="geo-distance">{graded.timedOut ? "Time's up: no pin down" : distanceText(graded.answer.squares)}</span>
            <Link
              href={atlasHref(graded.answer)}
              target="_blank"
              className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
              data-testid="geo-atlas-link"
            >
              <MapIcon className="h-3.5 w-3.5" aria-hidden /> See it on the World Atlas
            </Link>
          </p>
        </div>
        <Button size="lg" className="w-full max-w-xs" onClick={onNext}>
          {graded.done ? (isStreak ? "See results" : "View summary") : "Next round"} ▶
        </Button>
        <div>
          <ReportShot key={current.shot} shot={current.shot} mode={game.daily ? "daily" : "solo"} />
        </div>
      </motion.div>
    </div>
  );
}

function GeoSummary({
  game,
  played,
  resultToken,
  challengeToken,
  challenge,
  reward,
  onRestart,
}: {
  game: Game;
  played: Played[];
  resultToken?: string;
  challengeToken?: string;
  challenge?: GeoChallenge;
  reward: Reward | null;
  onRestart: () => void;
}) {
  const progress = useProgress();
  const { region } = game;
  const isStreak = game.kind === "streak";
  const total = played.reduce((s, p) => s + p.graded.score, 0);
  const bonus = game.guessGame ? (played.at(-1)?.graded.bonusTotal ?? 0) : null;
  const streak = played.filter((p) => p.graded.hit).length;
  const headline = useCountUp(isStreak ? streak : total, 1100);
  const [name, setName] = useState("");
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [shared, setShared] = useState<"done" | "failed" | null>(null);

  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareResult: GuessrShareResult = {
    game: "guessr",
    ...(game.daily ? { daily: dailyNumber(game.daily) } : {}),
    region: region.id,
    ...(isStreak ? { streak } : { rounds: played.map((p) => p.graded.score) }),
  };
  const challengeUrl = challengeToken ? `${origin}/guessr/c/${encodeURIComponent(challengeToken)}` : null;
  const canRank = !game.practice && !!resultToken;
  const modeName = game.difficulty ? GEO_DIFFICULTY_NAMES[game.difficulty] : undefined;
  const shareTextFull = guessrShareText(shareResult, region.name, shareUrl(shareResult), { mode: modeName });
  // The card to copy: the result, then the challenge link (same places) when there is one, else the result page.
  const shareBody = guessrShareText(shareResult, region.name, undefined, { mode: modeName });
  const shareLink = challengeUrl ?? shareUrl(shareResult);

  async function shareChallenge() {
    if (!challengeUrl) return;
    const outcome = await shareOrCopy(`I scored ${fmt(total)} in PokéGuessr. Same ${played.length || 5} places, can you beat me?`, challengeUrl);
    if (outcome === "failed") setShared("failed");
    else if (outcome !== "cancelled") setShared("done");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isCleanName(name)) {
      setSaveError(NAME_REJECTED);
      setSave("error");
      return;
    }
    setSave("saving");
    setSaveError(null);
    try {
      await post("/api/geo/leaderboard", { resultToken, playerName: name });
      setSave("saved");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save.");
      setSave("error");
    }
  }

  const theirs = challenge?.score ?? 0;
  const outcome = challenge ? (total > theirs ? "win" : total < theirs ? "lose" : "tie") : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2 text-center">
        <p className="hud-label text-screen">{isStreak ? "Streak over" : "Survey complete"}</p>
        <div className="font-display text-6xl font-bold tabular-nums text-screen [text-shadow:0_0_18px_hsl(var(--screen)/0.5)]">
          {isStreak ? `${headline} in a row` : fmt(headline)}
        </div>
        {!isStreak && (
          <>
            <div className="text-sm text-muted-foreground">out of {fmt(maxTotal(game.rounds))}</div>
            {bonus !== null && (
              <div className="text-sm font-semibold text-success" data-testid="geo-bonus-total">
                +{fmt(bonus)} game bonus · {fmt(total + bonus)} with the bonus (the leaderboard counts the map score)
              </div>
            )}
            <div className="meter mx-auto max-w-xl">
              <motion.div className="h-full bg-primary" initial={{ width: 0 }} animate={{ width: `${(total / maxTotal(game.rounds)) * 100}%` }} transition={{ duration: 1.1 }} />
            </div>
          </>
        )}
        {reward && (
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            {reward.best && <span className="rounded-sm border border-warning/50 px-2 py-1 font-pixel text-[10px] text-warning">New best</span>}
          </div>
        )}
      </div>

      {game.daily && !isStreak && <DailyCompare date={game.daily} score={total} />}

      {outcome && challenge && (
        <Card className={cn(outcome === "win" ? "border-success/50" : outcome === "lose" ? "border-destructive/40" : "")}>
          <CardContent className="space-y-3 p-5">
            <p className="text-center font-display text-2xl font-bold uppercase">
              {outcome === "win" ? `You beat ${challenge.name || "them"}!` : outcome === "lose" ? `${challenge.name || "They"} wins this one` : "Dead heat!"}
            </p>
            <div className="grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-1 text-sm">
              <span />
              <span className="hud-label text-right">You</span>
              <span className="hud-label text-right">{challenge.name || "Them"}</span>
              {played.map((p, i) => (
                <div key={i} className="contents">
                  <span className="font-pixel text-xs text-muted-foreground">R{i + 1}</span>
                  <span className={cn("text-right tabular-nums", p.graded.score >= (challenge.rounds[i] ?? 0) && "font-bold text-success")}>
                    {fmt(p.graded.score)}
                  </span>
                  <span className={cn("text-right tabular-nums", (challenge.rounds[i] ?? 0) > p.graded.score && "font-bold text-success")}>
                    {fmt(challenge.rounds[i] ?? 0)}
                  </span>
                </div>
              ))}
              <span className="font-pixel text-xs">Total</span>
              <span className="text-right font-bold tabular-nums">{fmt(total)}</span>
              <span className="text-right font-bold tabular-nums">{fmt(theirs)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {!isStreak && (
        <GeoMap region={region} revealed={played.map((p, i) => ({ guess: p.guess, answer: p.graded.answer, label: String(i + 1) }))} />
      )}

      <Card>
        <CardContent className="space-y-5 p-5">
          {reward && reward.newBadges.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-3 rounded-md border border-warning/40 bg-warning/[0.06] p-3">
              {reward.newBadges.map((b) => (
                <span key={b.id} className="flex items-center gap-2 text-sm">
                  <BadgeMedal id={b.id} size="md" />
                  <span>
                    <span className="block font-semibold">Badge unlocked: {b.name}</span>
                    <span className="text-xs text-muted-foreground">{b.description}</span>
                  </span>
                </span>
              ))}
            </div>
          )}

          <ol className="space-y-2">
            {played.map((p, i) => (
              <li key={i} className="flex items-center gap-3 rounded-md border bg-shade/20 px-3 py-2">
                <span className="font-pixel text-xs text-muted-foreground">{i + 1}</span>
                <span aria-hidden>{isStreak ? (p.graded.hit ? "✅" : "❌") : emoji(p.graded.score)}</span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="font-semibold">{placeName(p.graded.answer, region)}</span>
                  <span className="text-muted-foreground"> · {p.graded.answer.game}</span>
                  {p.graded.gameGuess?.correct && <span className="text-success"> · +{fmt(p.graded.gameGuess.bonus)}</span>}
                </span>
                {!isStreak && <span className="font-pixel text-xs tabular-nums">{fmt(p.graded.score)}</span>}
              </li>
            ))}
          </ol>

          <ShareCard body={shareBody} link={shareLink} challenge={!!challengeUrl} />

          <div className="grid gap-2 sm:grid-cols-2">
            {challengeUrl && (
              <Button className="sm:col-span-2" size="lg" variant="success" onClick={() => void shareChallenge()}>
                <Link2 className="h-4 w-4" aria-hidden />
                {shared === "done" ? "Challenge link copied!" : "Challenge a friend"}
              </Button>
            )}
            <ShareButton size="lg" variant="outline" kind="guessr" label="Share…" getText={() => shareTextFull} />
            <Button size="lg" variant="secondary" onClick={onRestart}>
              <RotateCcw className="h-4 w-4" aria-hidden /> Play again
            </Button>
          </div>
          {shared === "failed" && challengeUrl && <CopyFallback text={challengeUrl} />}

          {canRank ? (
            <form className="space-y-2" onSubmit={submit}>
              <label htmlFor="geo-name" className="hud-label">
                Save to the leaderboard
              </label>
              <div className="flex gap-2">
                <input
                  id="geo-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setSaveError(null);
                  }}
                  maxLength={24}
                  required
                  placeholder="Trainer name"
                  disabled={save === "saved"}
                  className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                />
                <Button type="submit" disabled={save === "saving" || save === "saved" || !name.trim()}>
                  {save === "saved" ? "Saved" : "Submit"}
                </Button>
              </div>
              {saveError && (
                <p role="alert" className="text-sm text-destructive">
                  {saveError}
                </p>
              )}
            </form>
          ) : game.practice === "repeat-daily" ? (
            <p className="text-xs text-muted-foreground">Only your first daily game of the day goes on the leaderboard.</p>
          ) : game.practice === "challenge" ? (
            <p className="text-xs text-muted-foreground">Challenge games aren&apos;t ranked, since the places were shared.</p>
          ) : game.practice === "filtered" ? (
            <p className="text-xs text-muted-foreground">Games on hand-picked games are practice: play All games, Classic 2D or Modern 3D to rank.</p>
          ) : game.practice === "difficulty" ? (
            <p className="text-xs text-muted-foreground">Easy and Hard games are practice: play Normal to get on the leaderboard.</p>
          ) : null}

          <Link
            href={
              game.daily
                ? `/leaderboard?board=geo&date=${game.daily}`
                : `/leaderboard?board=geo&format=${geoBoardKey({ region: region.id, kind: game.kind, era: game.filter.era, rounds: game.rounds })}`
            }
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full")}
          >
            <Trophy className="h-4 w-4" aria-hidden /> Leaderboard
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The Wordle-style result card: the share text as it'll paste (a square per
 * round by how close the pin landed, each round's points, the total), with a
 * Copy button. The link copied under it is the challenge link when there is
 * one (the same places for a friend), else the result page.
 */
function ShareCard({ body, link, challenge }: { body: string; link: string; challenge: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const full = `${body}\n${link}`;
  async function copy() {
    const ok = await copyText(full);
    setState(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    if (ok) timer.current = window.setTimeout(() => setState("idle"), 2200);
  }
  return (
    <div className="space-y-2 rounded-md border bg-shade/20 p-3" data-testid="geo-share-card">
      <div className="flex items-center justify-between gap-3">
        <p className="hud-label">Your result card</p>
        <Button size="sm" variant={state === "copied" ? "success" : "secondary"} onClick={() => void copy()} data-testid="geo-copy-result">
          {state === "copied" ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          {state === "copied" ? "Copied!" : "Copy"}
        </Button>
      </div>
      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed" data-testid="geo-share-preview">
        {body}
      </pre>
      <p className="truncate text-xs text-muted-foreground">
        {challenge ? "+ your challenge link: friends play the same places" : "+ a link to your result"}
      </p>
      {state === "failed" && <CopyFallback text={full} />}
    </div>
  );
}

/**
 * The Daily's "how you compared": the day's ranked scores in ten bars, yours
 * lit, and the share of players you beat. Shown only with enough players
 * (geo_runs: games saved to the daily leaderboard); otherwise nothing.
 */
function DailyCompare({ date, score }: { date: string; score: number }) {
  const [stats, setStats] = useState<GeoDailyStats | null>(null);
  useEffect(() => {
    let off = false;
    fetch(`/api/geo/daily-stats?date=${encodeURIComponent(date)}&score=${score}`)
      .then((r) => (r.ok ? (r.json() as Promise<GeoDailyStats>) : null))
      .then((s) => !off && setStats(s))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [date, score]);
  if (!stats || stats.players < COMPARE_MIN_PLAYERS) return null;
  const beaten = percentBeaten(stats);
  const mine = bucketOf(score);
  const tallest = Math.max(1, ...stats.buckets);
  return (
    <Card data-testid="geo-daily-compare">
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="hud-label text-warning">How you compared</p>
          <p className="text-sm text-muted-foreground">
            {fmt(stats.players)} ranked players today{stats.median !== undefined ? ` · median ${fmt(stats.median)}` : ""}
          </p>
        </div>
        {beaten !== null && (
          <p className="font-display text-2xl font-bold uppercase" data-testid="geo-daily-percent">
            Better than {beaten}% of players
          </p>
        )}
        <div className="flex h-28 items-end gap-1" role="img" aria-label={`Score spread for the day, your score in bar ${mine + 1} of ${stats.buckets.length}`}>
          {stats.buckets.map((n, i) => (
            <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-stretch justify-end">
              {i === mine && <span className="mb-1 text-center font-pixel text-[9px] uppercase text-primary">You</span>}
              <motion.div
                className={cn("rounded-t-sm", i === mine ? "bg-primary" : "bg-muted-foreground/30")}
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(n ? 6 : 2, (n / tallest) * 82)}%` }}
                transition={{ duration: 0.6, delay: i * 0.03 }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between font-pixel text-[10px] text-muted-foreground">
          <span>0</span>
          <span>{fmt(COMPARE_MAX / 2)}</span>
          <span>{fmt(COMPARE_MAX)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
