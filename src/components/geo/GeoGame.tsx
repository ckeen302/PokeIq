"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Compass,
  Expand,
  Flame,
  Globe2,
  Link2,
  Loader2,
  MapPin as MapPinIcon,
  RotateCcw,
  Share2,
  Swords,
  Trophy,
  X,
} from "lucide-react";
import {
  GEO_MAX_ROUND_SCORE,
  GEO_ROUNDS,
  WORLD_REGION,
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
import { shareOrCopy } from "@/lib/share";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BadgeMedal } from "@/components/game/BadgeMedal";
import { CopyFallback } from "@/components/quiz/CopyFallback";
import { GeoMap, type MapPin } from "./GeoMap";
import { DuelCard } from "./DuelCard";
import { cn } from "@/lib/utils";

type Phase = "setup" | "loading" | "guessing" | "submitting" | "revealed" | "results" | "error";

interface Game {
  /** The map being played (a daily or a challenge picks its own). */
  region: GeoRegionInfo;
  kind: GeoKind;
  daily?: string;
  practice?: string;
  token: string;
  round: GeoRoundPublic;
}

interface Played {
  guess: MapPin;
  graded: GeoGuessResponse;
}

interface Reward {
  xp: number;
  best: boolean;
  newBadges: BadgeDef[];
}

const fmt = (n: number) => n.toLocaleString("en-US");
const MAX_TOTAL = GEO_ROUNDS * GEO_MAX_ROUND_SCORE;

function emoji(score: number): string {
  if (score >= 4000) return "🟩";
  if (score >= 2000) return "🟨";
  if (score > 0) return "🟧";
  return "🟥";
}

function verdict(score: number): string {
  if (score >= GEO_MAX_ROUND_SCORE) return "Spot on!";
  if (score >= 4000) return "So close!";
  if (score >= 2500) return "Not bad!";
  if (score >= 1000) return "In the neighbourhood.";
  return "Way off…";
}

const playable = (region: GeoRegionInfo | undefined) => (region?.locations ?? 0) >= GEO_ROUNDS;
const where = (region: GeoRegionInfo) => (region.id === WORLD_REGION ? "the Pokémon world" : region.name);

/**
 * "Saffron City" or "Silph Co. · Saffron City", without the "Kanto " prefix
 * routes carry, plus the region when the map doesn't make it obvious.
 */
const clean = (s: string) => s.replace(/^(Kanto|Johto|Hoenn|Sinnoh|Unova|Kalos|Alola|Galar|Paldea) (?=Route)/, "");
function placeName(answer: { name: string; parent?: string; region?: string }, map?: GeoRegionInfo): string {
  const name = answer.parent ? `${clean(answer.name)} · ${clean(answer.parent)}` : clean(answer.name);
  return answer.region && map && answer.region !== map.name ? `${name}, ${answer.region}` : name;
}

/** "Every game from Red / Blue / Yellow to Scarlet / Violet". */
function gamesText(games: string[]): string {
  if (games.length <= 1) return games[0] ? `Pokémon ${games[0]}` : "the games";
  return `${games.length} games, from ${games[0]} to ${games.at(-1)}`;
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

/**
 * How a screenshot fills the frame: wide 3D captures fill it (just past the
 * light frame on Let's Go's), anything else fits inside; small pixel art is
 * scaled up without blurring.
 */
function shotFit(img: HTMLImageElement): { className: string; pixelated: boolean } {
  const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
  return { className: ratio >= 1.6 && ratio <= 1.85 ? "scale-[1.07] object-cover" : "object-contain", pixelated: img.naturalWidth <= 512 };
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
  challenge?: GeoChallenge & { token: string; region: string };
}

export function GeoGame({ regions: allRegions, challenge }: GeoGameProps) {
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
  const [shotLoaded, setShotLoaded] = useState(false);
  const [fit, setFit] = useState<ReturnType<typeof shotFit> | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [reward, setReward] = useState<Reward | null>(null);
  const [isChallenge, setIsChallenge] = useState(false);

  const region = byId(regionId) ?? regions[0];

  // /guessr?region=johto opens on that map (the atlas links here).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("region");
    if (id && !challenge && regions.some((r) => r.id === id)) setRegionId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read the URL once
  }, []);

  function chooseRegion(id: string) {
    setRegionId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("region", id);
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
      const body = opts.challenge
        ? { challenge: opts.challenge, name: progress?.name || undefined }
        : opts.daily
          ? { daily: opts.daily, name: progress?.name || undefined }
          : { region: region.id, kind: opts.kind, name: progress?.name || undefined, recent: readRecent() };
      const res = await post<GeoStartResponse>("/api/geo", body);
      const map = byId(res.region) ?? allRegions.find((r) => r.id === res.region);
      if (!map) throw new Error("That map isn't available right now.");
      setGame({ region: map, kind: opts.kind, daily: opts.daily, practice: res.practice, token: res.token, round: res.round });
      setIsChallenge(!!opts.challenge);
      setPick(null);
      setPlayed([]);
      setReward(null);
      setShotLoaded(false);
      setFit(null);
      setPhase("guessing");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start a game.");
      setPhase("error");
    }
  }

  async function guess() {
    if (!game || !pick || phase !== "guessing") return;
    setPhase("submitting");
    try {
      const graded = await post<GeoGuessResponse>("/api/geo/guess", { token: game.token, ...pick });
      const nextPlayed = [...played, { guess: pick, graded }];
      setPlayed(nextPlayed);
      setGame({ ...game, token: graded.token });
      rememberArea(graded.answer);
      const good = game.kind === "streak" ? graded.hit : graded.score >= 2500;
      play(good ? (game.kind === "streak" && graded.hit && nextPlayed.length % 5 === 0 ? "streak" : "correct") : "wrong");
      if (graded.next) new window.Image().src = graded.next.shot;
      if (graded.done && graded.result) {
        setReward(
          recordGeoGame(geoBoardKey({ region: game.region.id, kind: game.kind }), {
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
    setShotLoaded(false);
    setFit(null);
    setPhase("guessing");
  }

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
    const bestGame = progress?.best[`geo:${geoBoardKey({ region: region.id, kind: "game" })}`];
    const bestStreak = progress?.best[`geo:${geoBoardKey({ region: region.id, kind: "streak" })}`];
    const challengeMap = challenge ? byId(challenge.region) : undefined;
    const loading = phase === "loading";
    const isWorld = region.id === WORLD_REGION;
    return (
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="space-y-3 text-center">
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
                  Same five places{challengeMap ? ` in ${where(challengeMap)}` : ""}, same screenshots.{" "}
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
          <h2 className="font-display text-xl font-bold uppercase">Free play</h2>

          {regions.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Map">
              {regions.map((r) => (
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

          <p className="text-sm text-muted-foreground">
            {fmt(region.locations)} places, each shown in every game it appears in: {gamesText(region.games)}.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <ModeCard
              preview={region.preview ?? region.map.src}
              icon={<MapPinIcon className="h-5 w-5" aria-hidden />}
              title="5-round game"
              blurb={
                isWorld
                  ? `Five places in five different regions, up to ${fmt(MAX_TOTAL)} points. Then challenge a friend to beat you.`
                  : `Five places, up to ${fmt(MAX_TOTAL)} points. Then challenge a friend to beat you.`
              }
              stat={bestGame ? `Best ${fmt(bestGame)}` : null}
              disabled={loading}
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
              disabled={loading}
              onClick={() => void start({ kind: "streak" })}
            />
          </div>
        </div>

        <DuelCard region={region} />

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
          {game.daily ? ` · Daily #${dailyNumber(game.daily)}` : isStreak ? " · Streak" : ""}
        </div>
      </div>
      <div className="flex shrink-0 gap-6 text-right">
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
                {Math.min(roundNumber, GEO_ROUNDS)}/{GEO_ROUNDS}
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
    return <RoundReveal game={game} current={current} streak={streak} hud={hud} onNext={next} />;
  }

  // ---- guessing ------------------------------------------------------------------
  return (
    <div className="mx-auto max-w-6xl space-y-3">
      {hud}
      <div className="relative">
        <div className="screen relative aspect-[16/9] w-full overflow-hidden rounded-lg">
          {!shotLoaded && <div className="absolute inset-0 animate-pulse bg-foreground/5" aria-hidden />}
          {/* eslint-disable-next-line @next/next/no-img-element -- server-proxied, CDN-cached screenshot */}
          <img
            key={game.round.shot}
            src={game.round.shot}
            alt="Where is this?"
            onLoad={(e) => {
              setFit(shotFit(e.currentTarget));
              setShotLoaded(true);
            }}
            className={cn(
              "absolute inset-0 h-full w-full transition-opacity duration-300",
              fit?.className ?? "object-contain",
              shotLoaded ? "opacity-100" : "opacity-0"
            )}
            style={{ imageRendering: fit?.pixelated ? "pixelated" : "auto" }}
          />
          <button
            type="button"
            onClick={() => setZoomed(true)}
            className="absolute left-3 top-3 z-[3] flex h-9 w-9 items-center justify-center rounded-md bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75"
            aria-label="View the screenshot full screen"
            title="Full screen"
          >
            <Expand className="h-4 w-4" />
          </button>
        </div>

        {/* GeoGuessr-style mini-map (the atlas): docked bottom-right on desktop, grows on hover. */}
        <div className="group mt-3 space-y-2 lg:absolute lg:bottom-4 lg:right-4 lg:z-10 lg:mt-0 lg:w-[24rem] lg:transition-[width] lg:duration-200 lg:focus-within:w-[46rem] lg:hover:w-[46rem]">
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
            {/* eslint-disable-next-line @next/next/no-img-element -- same cached screenshot, full size */}
            <img
              src={game.round.shot}
              alt="Where is this?"
              className="max-h-full max-w-full rounded-md object-contain"
              style={{ imageRendering: fit?.pixelated ? "pixelated" : "auto" }}
            />
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
  const isWorld = game.region.id === WORLD_REGION;
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
        <p className="text-muted-foreground">
          It was <span className="font-semibold text-foreground">{placeName(graded.answer, game.region)}</span>
          <span className="text-sm"> · Pokémon {graded.answer.game}</span>
          <br />
          <span className="text-sm">{distanceText(graded.answer.squares)}</span>
          <span className="text-sm">
            {" · "}
            <Link href={atlasHref(graded.answer)} target="_blank" className="underline underline-offset-2 hover:text-foreground">
              See it on the atlas
            </Link>
          </span>
        </p>
        <Button size="lg" className="w-full max-w-xs" onClick={onNext}>
          {graded.done ? (isStreak ? "See results" : "View summary") : "Next round"} ▶
        </Button>
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
  const streak = played.filter((p) => p.graded.hit).length;
  const headline = useCountUp(isStreak ? streak : total, 1100);
  const [name, setName] = useState("");
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [shared, setShared] = useState<{ kind: "result" | "challenge"; outcome: "done" | "failed" } | null>(null);

  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const title = game.daily
    ? `PokéGuessr Daily #${dailyNumber(game.daily)}`
    : `PokéGuessr ${region.name}${isStreak ? " Streak" : ""}`;
  const text = isStreak
    ? `${title}: ${streak} place${streak === 1 ? "" : "s"} in a row 🔥`
    : `${title}: ${fmt(total)} / ${fmt(MAX_TOTAL)}\n${played.map((p) => emoji(p.graded.score)).join("")}`;
  const challengeUrl = challengeToken ? `${origin}/guessr/c/${encodeURIComponent(challengeToken)}` : null;
  const canRank = !game.practice && !!resultToken;

  async function share(kind: "result" | "challenge") {
    const outcome =
      kind === "challenge" && challengeUrl
        ? await shareOrCopy(`I scored ${fmt(total)} in PokéGuessr. Same five places, can you beat me?`, challengeUrl)
        : await shareOrCopy(text, `${origin}/guessr`);
    if (outcome === "failed") setShared({ kind, outcome: "failed" });
    else if (outcome !== "cancelled") setShared({ kind, outcome: "done" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
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
            <div className="text-sm text-muted-foreground">out of {fmt(MAX_TOTAL)}</div>
            <div className="meter mx-auto max-w-xl">
              <motion.div className="h-full bg-primary" initial={{ width: 0 }} animate={{ width: `${(total / MAX_TOTAL) * 100}%` }} transition={{ duration: 1.1 }} />
            </div>
          </>
        )}
        {reward && (
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            {reward.xp > 0 && <span className="rounded-sm bg-secondary px-2 py-1 font-pixel text-[10px]">+{reward.xp} XP</span>}
            {reward.best && <span className="rounded-sm border border-warning/50 px-2 py-1 font-pixel text-[10px] text-warning">New best</span>}
          </div>
        )}
      </div>

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
                </span>
                {!isStreak && <span className="font-pixel text-xs tabular-nums">{fmt(p.graded.score)}</span>}
              </li>
            ))}
          </ol>

          <div className="grid gap-2 sm:grid-cols-2">
            {challengeUrl && (
              <Button className="sm:col-span-2" size="lg" variant="success" onClick={() => void share("challenge")}>
                <Link2 className="h-4 w-4" aria-hidden />
                {shared?.kind === "challenge" && shared.outcome === "done" ? "Challenge link copied!" : "Challenge a friend"}
              </Button>
            )}
            <Button size="lg" onClick={() => void share("result")}>
              <Share2 className="h-4 w-4" aria-hidden /> {shared?.kind === "result" && shared.outcome === "done" ? "Copied!" : "Share result"}
            </Button>
            <Button size="lg" variant="secondary" onClick={onRestart}>
              <RotateCcw className="h-4 w-4" aria-hidden /> Play again
            </Button>
          </div>
          {shared?.outcome === "failed" && (
            <CopyFallback text={shared.kind === "challenge" && challengeUrl ? challengeUrl : `${text}\n${origin}/guessr`} />
          )}

          {canRank ? (
            <form className="space-y-2" onSubmit={submit}>
              <label htmlFor="geo-name" className="hud-label">
                Save to the leaderboard
              </label>
              <div className="flex gap-2">
                <input
                  id="geo-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
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
          ) : null}

          <Link
            href={
              game.daily
                ? `/leaderboard?board=geo&date=${game.daily}`
                : `/leaderboard?board=geo&format=${geoBoardKey({ region: region.id, kind: game.kind })}`
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
