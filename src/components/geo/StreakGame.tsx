"use client";

import { useEffect, useState } from "react";
import Link from "@/components/ui/Link";
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
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GeoMap, LINE_DRAW_MS } from "./GeoMap";
import { ConfirmExit, ExitButton, FullscreenButton, GameShell, GuessButton, Notch } from "./GameShell";
import { ShotCarousel, shotFit } from "./ShotCarousel";
import { LearnCard } from "./LearnCard";
import { ReportShot } from "./ReportShot";
import { GeoResults, type ResultsRound } from "./GeoResults";
import { EndBoard, EndLines, EndRow, EndShareCard, ShareSquares } from "./EndScreen";
import { resultPath } from "./ShareResultLink";
import { useT } from "@/i18n/client";
import type { Translator } from "@/i18n/catalog";
import geoNs from "@/messages/geo";
import geoStreak from "@/messages/geo-streak";
import { localeHref } from "@/i18n/href";
import { useGeoNames, type GeoLocal } from "@/lib/geo-i18n-client";

type StreakT = Translator<typeof geoStreak.en>;

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
const FIT_MS = 650;

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
  const t = useT(geoStreak);
  const g = useT(geoNs);
  const names = useGeoNames();
  const progress = useProgress();
  const account = useAccount();
  const pinImage = account.user?.avatar ? avatarSrc(account.user.avatar) : undefined;
  const [phase, setPhase] = useState<Phase>("setup");
  // The music plays while a run is on (from Start, through its rounds and their results), not on the setup or the final results.
  useGuessrMusic(phase === "loading" || phase === "guessing" || phase === "submitting" || phase === "revealed");
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
  /** "Leave this game?" (Exit, Escape), asked while a run is still going, as in every PokéGuessr game. */
  const [confirmExit, setConfirmExit] = useState(false);
  const requestExit = () => (phase === "guessing" || phase === "submitting" || (phase === "revealed" && !current?.graded.done) ? setConfirmExit(true) : setPhase("setup"));
  const exitRun = () => {
    setConfirmExit(false);
    setPhase("setup");
  };
  const confirm = confirmExit ? <ConfirmExit onLeave={exitRun} onStay={() => setConfirmExit(false)} /> : null;
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
      setError(err instanceof Error ? err.message : t("errors.start"));
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
      setError(err instanceof Error ? err.message : t("errors.grade"));
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
      if (confirmExit) return;
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
          <p className="hud-label max-md:hidden text-screen">{t("setup.eyebrow")}</p>
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-6xl">
            {t.rich("setup.title", { b: (c) => <span className="text-primary">{c}</span> })}
          </h1>
          <p className="mx-auto max-w-xl text-muted-foreground">{t("setup.intro")}</p>
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
                <Flame className="h-3.5 w-3.5" aria-hidden />{` ${t("setup.mode")}`}
              </p>
              <p className="font-display text-2xl font-bold uppercase">{t("setup.headline", { from: names.region("Kanto"), to: names.region("Paldea") })}</p>
              <p className="text-sm text-muted-foreground">
                {localBest > 0 ? t("setup.best", { n: localBest }) : t("setup.first")} {t("setup.board")}
              </p>
            </CardContent>
            <div className="flex items-center p-6 pt-0 md:pt-6">
              <Button size="lg" className="w-full md:w-auto" disabled={loading} onClick={() => void start()} data-testid="streak-start">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                {t("setup.start")}
              </Button>
            </div>
          </div>
        </Card>

        <div className="flex flex-wrap items-center justify-center gap-1.5" aria-label={t("setup.regions")}>
          {GEO_STREAK_REGIONS.map((r) => (
            <span key={r} className="rounded-md border bg-card px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {names.region(r)}
            </span>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Link href={`/leaderboard?board=geo&format=${GEO_REGION_STREAK_BOARD}`} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full")}>
            <Trophy className="h-4 w-4" aria-hidden />{` ${t("board")}`}
          </Link>
          <Link href="/pokeguessr" className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "w-full")}>
            {g("shell.back")}
          </Link>
        </div>
      </div>
    );
  }

  if (phase === "error" || !run) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="space-y-4 p-6 text-center">
          <p className="font-display text-xl font-bold uppercase">{t("errors.title")}</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={() => setPhase("setup")}>{t("back")}</Button>
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
      <GeoResults
        game={{ region: world, kind: "streak", rounds: played.length }}
        played={rounds}
        pinImage={pinImage}
        mode={t("hud.mode", { world: names.map(world) })}
        onNext={() => setPhase("setup")}
        onExit={() => setPhase("setup")}
      >
        <StreakSummary streak={streak} best={Math.max(best ?? 0, localBest)} newBest={newBest} resultToken={last?.resultToken} t={t} />
      </GeoResults>
    );
  }

  const notch = (
    <Notch>
      <div className="min-w-0 text-center">
        <div className="font-display text-xl font-bold uppercase italic leading-none tracking-wide sm:text-2xl" data-testid="streak-count">
          <span className="inline-flex items-center gap-1.5">
            <Flame className="h-5 w-5 text-warning" aria-hidden />{` ${t("hud.streak", { n: streak })}`}
          </span>
        </div>
        <div className="mt-0.5 truncate font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c8bfff]">{t("hud.mode", { world: names.map(world) })}</div>
      </div>
    </Notch>
  );

  // ---- round result ------------------------------------------------------------
  if (phase === "revealed" && current) {
    return (
      <GameShell onExit={requestExit}>
        {() => (
          <>
            <StreakReveal world={world} current={current} streak={streak} onNext={next} onExit={requestExit} notch={notch} t={t} names={names} />
            {confirm}
          </>
        )}
      </GameShell>
    );
  }

  // ---- guessing ------------------------------------------------------------------
  return (
    <GameShell onExit={requestExit}>
      {({ fs, toggle }) => (
        <div className="relative h-full">
          <div className="absolute inset-0">
            <ShotCarousel views={[run.shot]} index={0} onIndex={() => undefined} onZoom={() => setZoomed(true)} fs />
          </div>
          <div className="geo-safe-tl absolute left-3 top-3 z-20 flex items-center gap-2">
            <ExitButton onClick={requestExit} label={t("back")} />
            <FullscreenButton fs={fs} onClick={toggle} />
          </div>
          {notch}

          {/* The region picker: nine tiles, 1–9 on the keyboard, then Guess. */}
          <div className="absolute inset-x-3 bottom-3 z-10 flex flex-col gap-2 md:inset-x-auto md:bottom-4 md:right-4 md:w-[26rem]" data-testid="streak-picker">
            <div className="grid grid-cols-3 gap-1.5 rounded-md bg-black/55 p-1.5 backdrop-blur" role="radiogroup" aria-label={t("which")}>
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
                    {names.region(r)}
                    <span className={cn("text-[9px] font-semibold tracking-[0.12em]", on ? "text-white/80" : "text-white/45")}>{t("gen", { n: GEN_OF[r] })}</span>
                    <kbd aria-hidden className="absolute right-1 top-1 hidden rounded border border-white/25 px-1 text-[9px] font-normal normal-case text-white/60 sm:inline">
                      {i + 1}
                    </kbd>
                  </button>
                );
              })}
            </div>
            <GuessButton hasPin={!!pick} busy={phase === "submitting"} disabled={phase === "submitting"} onClick={() => void guess()} label={pick ? undefined : t("pick")} />
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
                aria-label={g("shot.fullscreen")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- same cached screenshot, full size */}
                <img
                  src={run.shot}
                  alt={t("which")}
                  onLoad={(e) => setZoomPixelated(shotFit(e.currentTarget).pixelated)}
                  className="max-h-[calc(100vh-2rem)] max-w-full rounded-md object-contain"
                  style={{ imageRendering: zoomPixelated ? "pixelated" : "auto" }}
                />
                <button type="button" className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label={g("shot.close")}>
                  <X className="h-5 w-5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          {confirm}
        </div>
      )}
    </GameShell>
  );
}

/** The pick's result: the place flagged on the world map, right or wrong in the bottom bar, the learn card, and Next. */
function StreakReveal({ world, current, streak, notch, onNext, onExit, t, names }: { world: GeoRegionInfo; current: Played; streak: number; notch: React.ReactNode; onNext: () => void; onExit: () => void; t: StreakT; names: GeoLocal }) {
  const { graded } = current;
  const reduced = useReducedMotion();
  const rise = (delay: number) => ({ initial: reduced ? false : { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, delay: reduced ? 0 : delay, ease: [0.2, 0.8, 0.2, 1] as const } });
  return (
    <div className="relative h-full" data-testid="streak-reveal">
      <div className="absolute inset-x-0 top-0 bottom-[8.5rem] md:bottom-[6.75rem]">
        <GeoMap region={world} revealed={[{ guess: null, answer: graded.answer }]} fit={{ delay: LINE_DRAW_MS / 2, duration: FIT_MS }} fill controls={false} />
      </div>
      <div className="geo-safe-tl absolute left-3 top-3 z-20">
        <ExitButton onClick={onExit} label={t("back")} />
      </div>
      {notch}
      <motion.div {...rise(0.15)} className="absolute inset-x-0 bottom-0 z-20 border-t-4 border-[#a99cff] bg-[#1e1a3f]/95 text-white shadow-[0_-12px_40px_rgba(0,0,0,0.5)] backdrop-blur">
        <div className="mx-auto grid max-w-6xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6 md:grid-cols-[1fr_auto_1fr]">
          <div className="min-w-0 text-center md:text-left">
            <p className={cn("hud-label", graded.correct ? "!text-[#9be15d]" : "!text-[#ff5a5a]")} data-testid="streak-verdict">
              {graded.correct ? t("reveal.right") : t("reveal.wrong")}
            </p>
            <p className="flex items-center justify-center gap-2 font-display text-4xl font-bold italic md:justify-start md:text-3xl lg:text-4xl">
              {graded.correct ? <Check className="h-8 w-8 text-[#9be15d]" aria-hidden /> : <X className="h-8 w-8 text-[#ff5a5a]" aria-hidden />}
              {graded.correct ? t("reveal.inARow", { n: streak }) : t("reveal.final", { n: streak })}
            </p>
            <p className="text-sm text-white/70">
              {graded.correct
                ? t("reveal.its", { region: names.region(String(graded.region)) })
                : t("reveal.picked", { picked: graded.picked ? names.region(graded.picked) : t("reveal.nothing"), region: names.region(String(graded.region ?? graded.answer.region)) })}
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
              className="flex min-h-12 w-full max-w-xs items-center justify-center gap-2 rounded-md bg-[#4cbb17] px-6 py-1.5 font-display text-base leading-tight font-bold uppercase tracking-wider text-white shadow-lg transition-[background-color,transform] hover:bg-[#58d01c] active:scale-[0.98]"
            >
              {graded.done ? t("reveal.results") : t("reveal.next")} ▶
              <kbd aria-hidden className="ml-1 hidden rounded border border-white/40 px-1.5 text-[10px] font-normal normal-case sm:inline [@media(pointer:coarse)]:!hidden">{t("reveal.space")}</kbd>
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

/** The end screen's rows for Region Streak: a new best (or the best so far), sharing, and the streak leaderboard. */
function StreakSummary({ streak, best, newBest, resultToken, t }: { streak: number; best: number; newBest: boolean; resultToken?: string; t: StreakT }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const ticks = `${"✅".repeat(Math.min(streak, 20))}${streak > 20 ? "…" : ""}❌`;
  const text = `${t("summary.shareTitle")}\n🔥${t("summary.shareCount", { n: streak })}\n${ticks}`;
  const url = resultToken ? `${origin}${localeHref(resultPath(resultToken), t.locale).href}` : undefined;
  const squares = [...Array<string>(Math.min(streak, 9)).fill("✅"), "❌"];
  const line = newBest
    ? { key: "best", icon: <Flame className="h-[1em] w-[1em]" aria-hidden />, text: t("summary.newBest"), testId: "geo-end-best" }
    : best > 0
      ? { key: "best", text: <span className="text-[0.8em] text-white/85">{t("summary.best", { n: best })}</span>, testId: "geo-end-best" }
      : null;
  return (
    <>
      {line && (
        <EndRow order={0}>
          <EndLines lines={[line]} />
        </EndRow>
      )}
      <EndRow order={1}>
        <EndShareCard
          title={t("summary.shareTitle")}
          sub={t("summary.shareCount", { n: streak })}
          text={text}
          url={url}
          kind="guessr"
          picture={<ShareSquares rows={[squares.slice(0, 5), squares.slice(5)].filter((r) => r.length)} label={t("summary.shareCount", { n: streak })} />}
        />
      </EndRow>
      <EndRow order={2} testId="streak-summary">
        <EndBoard
          href={`/leaderboard?board=geo&format=${GEO_REGION_STREAK_BOARD}`}
          boardLabel={t("board")}
          save={
            resultToken && streak > 0
              ? {
                  label: t("summary.save"),
                  placeholder: t("summary.name"),
                  submit: t("summary.submit"),
                  saved: t("summary.saved"),
                  failed: t("summary.saveFailed"),
                  onSave: (name) => post("/api/geo/streak/leaderboard", { resultToken, playerName: name }).then(() => undefined),
                }
              : undefined
          }
          note={t("summary.needOne")}
        />
      </EndRow>
    </>
  );
}
