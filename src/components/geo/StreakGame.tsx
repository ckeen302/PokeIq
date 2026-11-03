"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Flame, Loader2, Play, Trophy, X } from "lucide-react";
import { type GeoRegionInfo } from "@/lib/geo-types";
import { GEO_REGION_STREAK_BOARD, GEO_REGION_STREAK_KEY, GEO_STREAK_REGIONS, type GeoStreakGuessResponse, type GeoStreakRegion, type GeoStreakStartResponse } from "@/lib/geo-streak-types";
import { recordGeoGame, useProgress } from "@/lib/progress";
import { play, unlockAudio } from "@/lib/sound";
import { useGuessrMusic } from "@/lib/use-guessr-music";
import { preloadImage } from "@/lib/preload";
import { useAccount } from "@/lib/account";
import { avatarSrc } from "@/lib/avatar";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ShareButton } from "@/components/share/ShareButton";
import { GeoMap, LINE_DRAW_MS } from "./GeoMap";
import { ExitButton, FullscreenButton, GameShell, GuessButton, Notch } from "./GameShell";
import { ShotCarousel, shotFit } from "./ShotCarousel";
import { LearnCard } from "./LearnCard";
import { ReportShot } from "./ReportShot";
import { GeoResults, type ResultsRound } from "./GeoResults";
import { resultPath } from "./ShareResultLink";

type Phase = "setup" | "loading" | "guessing" | "submitting" | "revealed" | "results" | "error";

interface Run {
  token: string;
  shot: string;
  regions: GeoStreakRegion[];
}
interface Played {
  graded: GeoStreakGuessResponse;
  shot: string;
}

/** Each region's generation, for the picker's small label. */
const GEN_OF: Record<GeoStreakRegion, number> = { Kanto: 1, Johto: 2, Hoenn: 3, Sinnoh: 4, Unova: 5, Kalos: 6, Alola: 7, Galar: 8, Paldea: 9 };
const FIT_MS = 800;

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/**
 * Region Streak: one screenshot, name the region, no pin. Right keeps the
 * run alive and deals the next shot; wrong (or a wrong pick) ends it with
 * the results map. The answer only ever arrives with the grade.
 */
export function StreakGame({ world }: { world: GeoRegionInfo }) {
  const progress = useProgress();
  const account = useAccount();
  const pinImage = account.user?.avatar ? avatarSrc(account.user.avatar) : undefined;
  const [phase, setPhase] = useState<Phase>("setup");
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [pick, setPick] = useState<GeoStreakRegion | null>(null);
  const [played, setPlayed] = useState<Played[]>([]);
  const [zoomed, setZoomed] = useState(false);
  const [zoomPixelated, setZoomPixelated] = useState(false);
  const [best, setBest] = useState<number | null>(null);
  const [newBest, setNewBest] = useState(false);

  const streak = played.filter((p) => p.graded.correct).length;
  const current = phase === "revealed" ? played[played.length - 1] : null;
  // Music: the menu loop on the start screen, the calm loop while playing, a sting when the streak ends.
  useGuessrMusic(phase === "results" ? "draw" : phase === "guessing" || phase === "submitting" || phase === "revealed" ? "round" : "lobby");
  const localBest = progress?.best[`geo:${GEO_REGION_STREAK_KEY}`] ?? 0;

  async function start() {
    unlockAudio();
    setPhase("loading");
    setError(null);
    try {
      const res = await post<GeoStreakStartResponse>("/api/geo/streak", { name: progress?.name || undefined });
      setRun(res);
      setPlayed([]);
      setPick(null);
      setNewBest(false);
      setPhase("guessing");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start a run.");
      setPhase("error");
    }
  }

  async function guess() {
    if (!run || !pick || phase !== "guessing") return;
    setPhase("submitting");
    try {
      play("guess");
      const graded = await post<GeoStreakGuessResponse>("/api/geo/streak/guess", { token: run.token, region: pick });
      const next = [...played, { graded, shot: run.shot }];
      setPlayed(next);
      setRun({ ...run, token: graded.token, shot: graded.next?.shot ?? run.shot });
      if (graded.next) void preloadImage(graded.next.shot);
      play(graded.correct ? (graded.streak % 5 === 0 ? "streak" : "correct") : "wrong");
      if (graded.done) {
        const reward = recordGeoGame(GEO_REGION_STREAK_KEY, { kind: "streak", score: graded.streak, rounds: [] });
        setNewBest(reward.best && graded.streak > 0);
        if (graded.best) setBest(graded.best.best);
      }
      setPhase("revealed");
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't grade that pick.");
      setPhase("error");
    }
  }

  function next() {
    if (!run || !current) return;
    if (current.graded.done) {
      play("fanfare");
      setPhase("results");
      return;
    }
    setPick(null);
    setPhase("guessing");
  }

  // 1–9 pick a region, Space / Enter guess, then go on; Esc closes the zoomed view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setZoomed(false);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, button, a")) return;
      if (phase === "guessing" && /^[1-9]$/.test(e.key)) {
        const region = GEO_STREAK_REGIONS[Number(e.key) - 1];
        if (region) {
          setPick(region);
          play("pin");
        }
        return;
      }
      if (e.key !== "Enter" && e.key !== " ") return;
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
  if (phase === "setup" || phase === "loading" || (phase === "error" && !run)) {
    const loading = phase === "loading";
    return (
      <div className="mx-auto max-w-3xl space-y-8" data-testid="streak-setup">
        <div className="space-y-3 text-center">
          <p className="hud-label text-screen">Field survey · the Pokémon world</p>
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-6xl">
            Region <span className="text-primary">Streak</span>
          </h1>
          <p className="mx-auto max-w-xl text-muted-foreground">
            One screenshot, one question: which region is this? No pin to place. Every right answer deals the next screenshot; one wrong region ends the run.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-center text-sm text-destructive">
            {error}
          </p>
        )}

        <Card className="overflow-hidden border-warning/40">
          <div className="grid md:grid-cols-[1fr_auto]">
            <CardContent className="space-y-2 p-6">
              <p className="hud-label flex items-center gap-1.5 text-warning">
                <Flame className="h-3.5 w-3.5" aria-hidden /> Streak mode
              </p>
              <p className="font-display text-2xl font-bold uppercase">Kanto to Paldea, until you miss</p>
              <p className="text-sm text-muted-foreground">
                {localBest > 0 ? `Your best: ${localBest} in a row.` : "Your first run sets your best."} Finished runs go on the Region Streak leaderboard.
              </p>
            </CardContent>
            <div className="flex items-center p-6 pt-0 md:pt-6">
              <Button size="lg" className="w-full md:w-auto" disabled={loading} onClick={() => void start()} data-testid="streak-start">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                Start a run
              </Button>
            </div>
          </div>
        </Card>

        <div className="flex flex-wrap items-center justify-center gap-1.5" aria-label="The nine regions">
          {GEO_STREAK_REGIONS.map((r) => (
            <span key={r} className="rounded-md border bg-card px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {r}
            </span>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Link href={`/leaderboard?board=geo&format=${GEO_REGION_STREAK_BOARD}`} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full")}>
            <Trophy className="h-4 w-4" aria-hidden /> Streak leaderboard
          </Link>
          <Link href="/guessr" className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "w-full")}>
            Back to PokéGuessr
          </Link>
        </div>
      </div>
    );
  }

  if (phase === "error" || !run) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="space-y-4 p-6 text-center">
          <p className="font-display text-xl font-bold uppercase">Something went wrong</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={() => setPhase("setup")}>Back to Region Streak</Button>
        </CardContent>
      </Card>
    );
  }

  // ---- results -----------------------------------------------------------------
  if (phase === "results") {
    const last = played[played.length - 1]?.graded;
    const rounds: ResultsRound[] = played.map((p) => ({
      guess: null,
      graded: { score: p.graded.correct ? 1 : 0, hit: p.graded.correct, answer: p.graded.answer, token: "", total: 0, done: true },
    }));
    return (
      <GeoResults game={{ region: world, kind: "streak", rounds: played.length }} played={rounds} pinImage={pinImage} shareToken={last?.resultToken} onRestart={() => setPhase("setup")}>
        <StreakSummary streak={streak} best={Math.max(best ?? 0, localBest)} newBest={newBest} resultToken={last?.resultToken} />
      </GeoResults>
    );
  }

  const notch = (
    <Notch>
      <div className="min-w-0 text-center">
        <div className="font-display text-xl font-bold uppercase italic leading-none tracking-wide sm:text-2xl" data-testid="streak-count">
          <span className="inline-flex items-center gap-1.5">
            <Flame className="h-5 w-5 text-warning" aria-hidden /> Streak {streak}
          </span>
        </div>
        <div className="mt-0.5 truncate font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c8bfff]">Region Streak · World</div>
      </div>
    </Notch>
  );

  // ---- round result ------------------------------------------------------------
  if (phase === "revealed" && current) {
    return (
      <GameShell onExit={() => setPhase("setup")}>
        {() => <StreakReveal world={world} current={current} streak={streak} onNext={next} onExit={() => setPhase("setup")} notch={notch} />}
      </GameShell>
    );
  }

  // ---- guessing ------------------------------------------------------------------
  return (
    <GameShell onExit={() => setPhase("setup")}>
      {({ fs, toggle }) => (
        <div className="relative h-full">
          <div className="absolute inset-0">
            <ShotCarousel views={[run.shot]} index={0} onIndex={() => undefined} onZoom={() => setZoomed(true)} fs />
          </div>
          <div className="absolute left-3 top-3 z-20 flex items-center gap-2">
            <ExitButton onClick={() => setPhase("setup")} label="Back to Region Streak" />
            <FullscreenButton fs={fs} onClick={toggle} />
          </div>
          {notch}

          {/* The region picker: nine tiles, 1–9 on the keyboard, then Guess. */}
          <div className="absolute inset-x-3 bottom-3 z-10 flex flex-col gap-2 md:inset-x-auto md:bottom-4 md:right-4 md:w-[26rem]" data-testid="streak-picker">
            <div className="grid grid-cols-3 gap-1.5 rounded-md bg-black/55 p-1.5 backdrop-blur" role="radiogroup" aria-label="Which region is this?">
              {run.regions.map((r, i) => {
                const on = pick === r;
                return (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-testid={`streak-region-${r.toLowerCase()}`}
                    onClick={() => {
                      setPick(r);
                      play("pin");
                    }}
                    className={cn(
                      "relative flex h-12 flex-col items-center justify-center rounded border font-display text-sm font-bold uppercase tracking-wide transition-colors sm:h-14 sm:text-base",
                      on ? "border-[#9be15d] bg-[#4cbb17] text-white shadow-lg" : "border-white/15 bg-[#1e1a3f]/90 text-white hover:border-[#a99cff] hover:bg-[#27224f]"
                    )}
                  >
                    {r}
                    <span className={cn("text-[9px] font-semibold tracking-[0.12em]", on ? "text-white/80" : "text-white/45")}>Gen {GEN_OF[r]}</span>
                    <kbd aria-hidden className="absolute right-1 top-1 hidden rounded border border-white/25 px-1 text-[9px] font-normal normal-case text-white/60 sm:inline">
                      {i + 1}
                    </kbd>
                  </button>
                );
              })}
            </div>
            <GuessButton hasPin={!!pick} busy={phase === "submitting"} disabled={phase === "submitting"} onClick={() => void guess()} label={pick ? undefined : "Pick a region"} />
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
                  src={run.shot}
                  alt="Which region is this?"
                  onLoad={(e) => setZoomPixelated(shotFit(e.currentTarget).pixelated)}
                  className="max-h-[calc(100vh-2rem)] max-w-full rounded-md object-contain"
                  style={{ imageRendering: zoomPixelated ? "pixelated" : "auto" }}
                />
                <button type="button" className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="Close">
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

/** The pick's result: the place flagged on the world map, right or wrong in the bottom bar, the learn card, and Next. */
function StreakReveal({ world, current, streak, notch, onNext, onExit }: { world: GeoRegionInfo; current: Played; streak: number; notch: React.ReactNode; onNext: () => void; onExit: () => void }) {
  const { graded } = current;
  const reduced = useReducedMotion();
  const rise = (delay: number) => ({ initial: reduced ? false : { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, delay: reduced ? 0 : delay, ease: [0.2, 0.8, 0.2, 1] as const } });
  return (
    <div className="relative h-full" data-testid="streak-reveal">
      <div className="absolute inset-x-0 top-0 bottom-[8.5rem] md:bottom-[6.75rem]">
        <GeoMap region={world} revealed={[{ guess: null, answer: graded.answer }]} fit={{ delay: LINE_DRAW_MS / 2, duration: FIT_MS }} fill controls={false} />
      </div>
      <div className="absolute left-3 top-3 z-20">
        <ExitButton onClick={onExit} label="Back to Region Streak" />
      </div>
      {notch}
      <motion.div {...rise(0.15)} className="absolute inset-x-0 bottom-0 z-20 border-t-4 border-[#a99cff] bg-[#1e1a3f]/95 text-white shadow-[0_-12px_40px_rgba(0,0,0,0.5)] backdrop-blur">
        <div className="mx-auto grid max-w-6xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6 md:grid-cols-[1fr_auto_1fr]">
          <div className="min-w-0 text-center md:text-left">
            <p className={cn("hud-label", graded.correct ? "!text-[#9be15d]" : "!text-[#ff5a5a]")} data-testid="streak-verdict">
              {graded.correct ? "Right region!" : "Wrong region. Streak over"}
            </p>
            <p className="flex items-center justify-center gap-2 font-display text-4xl font-bold italic md:justify-start">
              {graded.correct ? <Check className="h-8 w-8 text-[#9be15d]" aria-hidden /> : <X className="h-8 w-8 text-[#ff5a5a]" aria-hidden />}
              {graded.correct ? `${streak} in a row` : `Final streak: ${streak}`}
            </p>
            <p className="text-sm text-white/70">
              {graded.correct ? `It's ${graded.region}.` : `You picked ${graded.picked ?? "nothing"}: it's ${graded.region ?? graded.answer.region}.`}
            </p>
          </div>
          <motion.div {...rise(reduced ? 0 : 0.5)} className="flex min-w-0 justify-center">
            <LearnCard answer={graded.answer} shot={current.shot} map={world} />
          </motion.div>
          <div className="flex flex-col items-center gap-1.5 md:items-end">
            <button
              type="button"
              onClick={onNext}
              data-testid="streak-next"
              className="flex h-12 w-full max-w-xs items-center justify-center gap-2 rounded-md bg-[#4cbb17] px-6 font-display text-base font-bold uppercase tracking-wider text-white shadow-lg transition-[background-color,transform] hover:bg-[#58d01c] active:scale-[0.98]"
            >
              {graded.done ? "See results" : "Next shot"} ▶
              <kbd aria-hidden className="ml-1 hidden rounded border border-white/40 px-1.5 text-[10px] font-normal normal-case sm:inline">Space</kbd>
            </button>
            <div className="text-white/60 [&_button]:text-white/60 [&_button:hover]:text-white">
              <ReportShot key={current.shot} shot={current.shot} mode="solo" />
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/** Under the results map: the best streak, the leaderboard form and sharing. */
function StreakSummary({ streak, best, newBest, resultToken }: { streak: number; best: number; newBest: boolean; resultToken?: string }) {
  const progress = useProgress();
  const [name, setName] = useState("");
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

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
      await post("/api/geo/streak/leaderboard", { resultToken, playerName: name });
      setSave("saved");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save.");
      setSave("error");
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareText = `PokéGuessr Region Streak\n🔥${streak} region${streak === 1 ? "" : "s"} in a row\n${"✅".repeat(Math.min(streak, 20))}${streak > 20 ? "…" : ""}❌${resultToken ? `\n${origin}${resultPath(resultToken)}` : ""}`;
  return (
    <div className="space-y-4" data-testid="streak-summary">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {newBest && <span className="rounded-sm border border-warning/50 px-2 py-1 font-pixel text-[10px] text-warning">New best</span>}
        {best > 0 && <span className="rounded-sm border px-2 py-1 font-pixel text-[10px] text-muted-foreground">Best {best} in a row</span>}
      </div>
      <ShareButton size="lg" variant="outline" kind="guessr" label="Share…" getText={() => shareText} className="w-full" />
      {resultToken && streak > 0 ? (
        <form className="space-y-2" onSubmit={submit}>
          <label htmlFor="streak-name" className="hud-label">
            Save to the streak leaderboard
          </label>
          <div className="flex gap-2">
            <input
              id="streak-name"
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
      ) : (
        <p className="text-xs text-muted-foreground">Name at least one region to get on the leaderboard.</p>
      )}
      <Link href={`/leaderboard?board=geo&format=${GEO_REGION_STREAK_BOARD}`} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full")}>
        <Trophy className="h-4 w-4" aria-hidden /> Streak leaderboard
      </Link>
    </div>
  );
}
