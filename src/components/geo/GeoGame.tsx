"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Compass, Gamepad2, Loader2, MapPin as MapPinIcon, Mountain, RotateCcw, Share2, Trophy } from "lucide-react";
import {
  GEO_MAX_ROUND_SCORE,
  GEO_ROUNDS,
  geoBoardKey,
  type GeoGuessResponse,
  type GeoRegionInfo,
  type GeoRoundPublic,
  type GeoStartResponse,
  type GeoStyle,
} from "@/lib/geo-types";
import { dailyNumber } from "@/lib/daily";
import { useToday } from "@/lib/use-today";
import { recordGeoGame, useProgress } from "@/lib/progress";
import { play, unlockAudio } from "@/lib/sound";
import { shareOrCopy } from "@/lib/share";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CopyFallback } from "@/components/quiz/CopyFallback";
import { GeoMap, type MapPin } from "./GeoMap";
import { cn } from "@/lib/utils";

type Phase = "setup" | "loading" | "guessing" | "submitting" | "revealed" | "results" | "error";

interface Game {
  style: GeoStyle;
  daily?: string;
  practice?: string;
  token: string;
  round: GeoRoundPublic;
}

interface Played {
  guess: MapPin;
  graded: GeoGuessResponse;
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

const STYLE_INFO: Record<GeoStyle, { title: string; blurb: string; icon: React.ReactNode }> = {
  classic: {
    title: "Classic",
    blurb: "3D street-level views from Let's Go, Pikachu! and Eevee! The GeoGuessr experience.",
    icon: <Mountain className="h-6 w-6" aria-hidden />,
  },
  retro: {
    title: "Retro",
    blurb: "Top-down layouts from Red/Blue, Gold/Silver and FireRed/LeafGreen. For Game Boy veterans.",
    icon: <Gamepad2 className="h-6 w-6" aria-hidden />,
  },
};

const placeName = (name: string) => name.replace(/^Kanto /, "");

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export function GeoGame({ region }: { region: GeoRegionInfo }) {
  const today = useToday();
  const progress = useProgress();
  const [phase, setPhase] = useState<Phase>("setup");
  const [error, setError] = useState<string | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [pick, setPick] = useState<MapPin | null>(null);
  const [played, setPlayed] = useState<Played[]>([]);
  const [shotLoaded, setShotLoaded] = useState(false);
  const [reward, setReward] = useState<{ xp: number; best: boolean } | null>(null);

  const current = phase === "revealed" ? played[played.length - 1] : null;
  const total = played.reduce((s, p) => s + p.graded.score, 0);

  async function start(style: GeoStyle, daily?: string) {
    unlockAudio();
    setPhase("loading");
    setError(null);
    try {
      const res = await post<GeoStartResponse>("/api/geo", daily ? { daily } : { region: region.id, style });
      setGame({ style, daily, practice: res.practice, token: res.token, round: res.round });
      setPick(null);
      setPlayed([]);
      setReward(null);
      setShotLoaded(false);
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
      setPlayed((p) => [...p, { guess: pick, graded }]);
      setGame({ ...game, token: graded.token });
      play(graded.score >= 2500 ? "correct" : "wrong");
      if (graded.next) new window.Image().src = graded.next.shot;
      if (graded.done && graded.result) {
        setReward(recordGeoGame(geoBoardKey({ region: region.id, style: game.style }), graded.result.score, game.daily));
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
    setPhase("guessing");
  }

  // Space / Enter: guess, then next round (GeoGuessr's shortcuts).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
    return (
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="space-y-3 text-center">
          <p className="hud-label text-screen">Field survey · {region.name}</p>
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-6xl">
            Poké<span className="text-primary">Guessr</span>
          </h1>
          <p className="mx-auto max-w-xl text-muted-foreground">
            You&apos;re dropped somewhere in {region.name}. Look around, then drop a pin on the map. The closer you are, the
            more points you score: up to {fmt(GEO_MAX_ROUND_SCORE)} a round, {fmt(MAX_TOTAL)} a game.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-center text-sm text-destructive">
            {error}
          </p>
        )}

        <Card className="overflow-hidden">
          <div className="grid gap-0 md:grid-cols-[1fr_auto]">
            <CardContent className="space-y-2 p-6">
              <p className="hud-label text-warning">Daily game {today ? `#${dailyNumber(today)}` : ""}</p>
              <p className="font-display text-2xl font-bold uppercase">5 places · same for everyone</p>
              <p className="text-sm text-muted-foreground">
                {dailyDone !== undefined
                  ? `You scored ${fmt(dailyDone)} today. Replays don't count for the leaderboard.`
                  : "Classic views. Your first game today goes on the daily leaderboard."}
              </p>
            </CardContent>
            <div className="flex items-center p-6 pt-0 md:pt-6">
              <Button size="lg" className="w-full md:w-auto" disabled={!today || phase === "loading"} onClick={() => today && void start("classic", today)}>
                {phase === "loading" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Compass className="h-4 w-4" aria-hidden />}
                {dailyDone !== undefined ? "Play again" : "Play today's"}
              </Button>
            </div>
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          {(["classic", "retro"] as const).map((style) => {
            const best = progress?.best[`geo:${geoBoardKey({ region: region.id, style })}`];
            return (
              <button
                key={style}
                type="button"
                disabled={phase === "loading"}
                onClick={() => void start(style)}
                className="menu-item group flex flex-col gap-3 overflow-hidden rounded-lg border bg-card p-4 text-left transition-colors hover:border-screen/60"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- CDN-cached preview screenshot */}
                <img
                  src={region.previews[style] ?? region.map.src}
                  alt=""
                  className="aspect-[16/10] w-full rounded-sm bg-shade/30 object-cover opacity-85 transition-opacity group-hover:opacity-100"
                  style={{ imageRendering: style === "retro" ? "pixelated" : "auto" }}
                />
                <span className="flex items-center gap-2 text-screen">
                  {STYLE_INFO[style].icon}
                  <span className="font-display text-2xl font-bold uppercase text-foreground">{STYLE_INFO[style].title}</span>
                </span>
                <span className="text-sm text-muted-foreground">{STYLE_INFO[style].blurb}</span>
                <span className="hud-label">
                  {region.locations[style]} places{best ? ` · Best ${fmt(best)}` : ""}
                </span>
              </button>
            );
          })}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Screenshots and maps from{" "}
          <a href="https://bulbapedia.bulbagarden.net" className="underline underline-offset-2" target="_blank" rel="noreferrer">
            Bulbapedia
          </a>
          . Pokémon game imagery © Nintendo / Game Freak / The Pokémon Company.
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
    return (
      <GeoSummary
        region={region}
        game={game}
        played={played}
        resultToken={played[played.length - 1]?.graded.resultToken}
        reward={reward}
        onRestart={() => setPhase("setup")}
      />
    );
  }

  const roundNumber = Math.min(played.length + (phase === "revealed" ? 0 : 1), GEO_ROUNDS);
  const hud = (
    <div className="flex items-stretch justify-between gap-3 rounded-md border bg-card/90 px-4 py-2 backdrop-blur">
      <div className="min-w-0">
        <div className="hud-label">Map</div>
        <div className="truncate font-display font-bold uppercase">
          {region.name} · {STYLE_INFO[game.style].title}
          {game.daily ? ` · Daily #${dailyNumber(game.daily)}` : ""}
        </div>
      </div>
      <div className="flex shrink-0 gap-6 text-right">
        <div>
          <div className="hud-label">Round</div>
          <div className="font-pixel tabular-nums">
            {roundNumber}/{GEO_ROUNDS}
          </div>
        </div>
        <div>
          <div className="hud-label">Score</div>
          <div className="font-pixel tabular-nums text-screen">{fmt(total)}</div>
        </div>
      </div>
    </div>
  );

  // ---- round result ------------------------------------------------------------
  if (phase === "revealed" && current) {
    const { graded, guess: g } = current;
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        {hud}
        <GeoMap region={region} revealed={[{ guess: g, answer: graded.answer }]} />
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 text-center">
          <div>
            <p className="hud-label text-screen">{verdict(graded.score)}</p>
            <p className="font-display text-4xl font-bold tabular-nums">{fmt(graded.score)} points</p>
          </div>
          <div className="meter mx-auto max-w-xl">
            <motion.div
              className="h-full bg-success"
              initial={{ width: 0 }}
              animate={{ width: `${(graded.score / GEO_MAX_ROUND_SCORE) * 100}%` }}
              transition={{ duration: 0.7 }}
            />
          </div>
          <p className="text-muted-foreground">
            It was <span className="font-semibold text-foreground">{placeName(graded.answer.name)}</span>
            <span className="text-sm"> · Pokémon {graded.answer.game}</span>
          </p>
          <Button size="lg" className="w-full max-w-xs" onClick={next}>
            {graded.done ? "View summary" : "Next round"} ▶
          </Button>
        </motion.div>
      </div>
    );
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
            onLoad={() => setShotLoaded(true)}
            className={cn(
              "absolute inset-0 h-full w-full transition-opacity duration-300",
              // Let's Go location cards have a light frame: zoom just past it.
              game.style === "classic" ? "scale-[1.07] object-cover" : "object-contain",
              shotLoaded ? "opacity-100" : "opacity-0"
            )}
            style={{ imageRendering: game.style === "retro" ? "pixelated" : "auto" }}
          />
        </div>

        {/* GeoGuessr-style mini-map: docked bottom-right on desktop, grows on hover. */}
        <div className="group mt-3 space-y-2 lg:absolute lg:bottom-4 lg:right-4 lg:z-10 lg:mt-0 lg:w-[19rem] lg:transition-[width] lg:duration-200 lg:focus-within:w-[34rem] lg:hover:w-[34rem]">
          <div className="rounded-md lg:opacity-80 lg:shadow-2xl lg:transition-opacity lg:group-hover:opacity-100">
            <GeoMap
              region={region}
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
    </div>
  );
}

function GeoSummary({
  region,
  game,
  played,
  resultToken,
  reward,
  onRestart,
}: {
  region: GeoRegionInfo;
  game: Game;
  played: Played[];
  resultToken?: string;
  reward: { xp: number; best: boolean } | null;
  onRestart: () => void;
}) {
  const progress = useProgress();
  const total = played.reduce((s, p) => s + p.graded.score, 0);
  const [name, setName] = useState("");
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [shared, setShared] = useState<"idle" | "done" | "failed">("idle");

  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

  const title = game.daily ? `PokéGuessr Daily #${dailyNumber(game.daily)}` : `PokéGuessr ${region.name} (${STYLE_INFO[game.style].title})`;
  const text = `${title}: ${fmt(total)} / ${fmt(MAX_TOTAL)}\n${played.map((p) => emoji(p.graded.score)).join("")}`;
  const url = typeof window !== "undefined" ? `${window.location.origin}/guessr` : "/guessr";
  const canRank = !game.practice && !!resultToken;

  async function share() {
    const outcome = await shareOrCopy(text, url);
    if (outcome === "failed") setShared("failed");
    else if (outcome !== "cancelled") setShared("done");
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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2 text-center">
        <p className="hud-label text-screen">Survey complete</p>
        <div className="font-display text-6xl font-bold tabular-nums text-screen [text-shadow:0_0_18px_hsl(var(--screen)/0.5)]">{fmt(total)}</div>
        <div className="text-sm text-muted-foreground">out of {fmt(MAX_TOTAL)}</div>
        <div className="meter mx-auto max-w-xl">
          <motion.div className="h-full bg-primary" initial={{ width: 0 }} animate={{ width: `${(total / MAX_TOTAL) * 100}%` }} transition={{ duration: 0.9 }} />
        </div>
        {reward && (
          <div className="flex justify-center gap-2 pt-1">
            <span className="rounded-sm bg-secondary px-2 py-1 font-pixel text-[10px]">+{reward.xp} XP</span>
            {reward.best && <span className="rounded-sm border border-warning/50 px-2 py-1 font-pixel text-[10px] text-warning">New best</span>}
          </div>
        )}
      </div>

      <GeoMap region={region} revealed={played.map((p, i) => ({ guess: p.guess, answer: p.graded.answer, label: String(i + 1) }))} />

      <Card>
        <CardContent className="space-y-5 p-5">
          <ol className="space-y-2">
            {played.map((p, i) => (
              <li key={i} className="flex items-center gap-3 rounded-md border bg-shade/20 px-3 py-2">
                <span className="font-pixel text-xs text-muted-foreground">{i + 1}</span>
                <span aria-hidden>{emoji(p.graded.score)}</span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="font-semibold">{placeName(p.graded.answer.name)}</span>
                  <span className="text-muted-foreground"> · {p.graded.answer.game}</span>
                </span>
                <span className="font-pixel text-xs tabular-nums">{fmt(p.graded.score)}</span>
              </li>
            ))}
          </ol>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="flex-1" size="lg" onClick={() => void share()}>
              <Share2 className="h-4 w-4" aria-hidden /> {shared === "done" ? "Copied!" : "Share result"}
            </Button>
            <Button className="flex-1" size="lg" variant="secondary" onClick={onRestart}>
              <RotateCcw className="h-4 w-4" aria-hidden /> Play again
            </Button>
          </div>
          {shared === "failed" && <CopyFallback text={`${text}\n${url}`} />}

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
          ) : game.practice ? (
            <p className="text-xs text-muted-foreground">Only your first daily game of the day goes on the leaderboard.</p>
          ) : null}

          <Link
            href={
              game.daily
                ? `/leaderboard?board=geo&date=${game.daily}`
                : `/leaderboard?board=geo&format=${geoBoardKey({ region: region.id, style: game.style })}`
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
