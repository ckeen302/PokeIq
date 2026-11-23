"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useT } from "@/i18n/client";
import geoNs from "@/messages/geo";
import geoNamesNs from "@/messages/geo-names";
import huntNs from "@/messages/hunt";
import { localDateString } from "@/lib/daily";
import { formatNumber } from "@/i18n/format";
import { play, unlockAudio } from "@/lib/sound";
import { WORLD_REGION, type GeoRegionInfo } from "@/lib/geo-types";
import { GeoMap, LINE_DRAW_MS, type MapPin, type RevealedRound } from "@/components/geo/GeoMap";
import {
  BAR_BTN,
  ConfirmExit,
  CountdownPill,
  ExitButton,
  FullscreenButton,
  GameShell,
  GuessButton,
  HudDials,
  MapDock,
  Notch,
  RoundBadge,
  RoundReadout,
  ScoreTracker,
  TimerDial,
  usePhone,
} from "@/components/geo/GameShell";
import { huntShareText } from "@/lib/hunt/share";
import {
  HUNT_DAILY_FROM,
  HUNT_REGIONS,
  type HuntGuessResponse,
  type HuntMapRegionId,
  type HuntMode,
  type HuntResult,
  type HuntRoundPublic,
  type HuntStartResponse,
} from "@/lib/hunt/types";
import { HuntSetup } from "./HuntSetup";
import { HuntRoundCard } from "./HuntRoundCard";
import { HuntPinBar } from "./HuntPinBar";
import { HuntRevealPanel } from "./HuntRevealPanel";
import { HuntResults } from "./HuntResults";

/**
 * Pokémon Hunt's game: the state machine, the pins, the clock and the API
 * calls. The screens it shows are hunt design's presentation components; the
 * frame, the map dock, the timer and the score tracker are PokéGuessr's.
 *
 * setup → starting → playing → grading → reveal → (playing …) → results
 */

type Phase = "setup" | "starting" | "playing" | "grading" | "reveal" | "results";

interface Game {
  token: string;
  mode: HuntMode;
  map: GeoRegionInfo;
  rounds: number;
  timer: number;
  daily?: { date: string; number: number };
  round: HuntRoundPublic;
}

const RECENT_KEY = "pokeiq:hunt-recent";
const DAILY_KEY = "pokeiq:hunt-daily";
const RECENT_MAX = 60;
/** Each region's spots pop in this long after the one before. */
const REGION_STEP_S = 0.45;
const FIT_MS = 900;

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: forgotten with the tab.
  }
};

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/** The Daily Hunt's number on a date (#1 on HUNT_DAILY_FROM), as the server counts it. */
const dailyNumberOf = (date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${HUNT_DAILY_FROM}T00:00:00Z`)) / 86_400_000) + 1;

interface DailyRecord {
  date: string;
  score: number;
  rounds: number[];
}

export function HuntGame({ maps }: { maps: GeoRegionInfo[] }) {
  const t = useT(huntNs);
  const g = useT(geoNs);
  const names = useT(geoNamesNs);
  const phone = usePhone();
  const fmt = (n: number) => formatNumber(n, t.locale);

  const [phase, setPhase] = useState<Phase>("setup");
  const [error, setError] = useState<string | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [pins, setPins] = useState<MapPin[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [scores, setScores] = useState<number[]>([]);
  const [graded, setGraded] = useState<{ body: HuntGuessResponse; pins: MapPin[] } | null>(null);
  const [result, setResult] = useState<HuntResult | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [confirmExit, setConfirmExit] = useState(false);
  const [today, setToday] = useState<string>(HUNT_DAILY_FROM);
  const [daily, setDaily] = useState<DailyRecord | null>(null);
  const lastSpec = useRef<{ mode: HuntMode; region?: HuntMapRegionId } | null>(null);

  // The player's date (dailies follow the local day, like every daily on the site), and whether today's is played.
  useEffect(() => {
    const date = localDateString();
    setToday(date < HUNT_DAILY_FROM ? HUNT_DAILY_FROM : date);
    const rec = read<DailyRecord | null>(DAILY_KEY, null);
    setDaily(rec?.date === date ? rec : null);
  }, []);

  const mapOf = useCallback((id: string) => maps.find((m) => m.id === id) ?? maps.find((m) => m.id === WORLD_REGION)!, [maps]);

  const start = async (spec: { mode: HuntMode; region?: HuntMapRegionId }) => {
    unlockAudio();
    lastSpec.current = spec;
    setPhase("starting");
    setError(null);
    try {
      const body = await post<HuntStartResponse>("/api/geo/hunt", {
        ...spec,
        ...(spec.mode === "daily" ? { date: localDateString() } : { recent: read<string[]>(RECENT_KEY, []) }),
      });
      setGame({ token: body.token, mode: body.mode, map: mapOf(body.map), rounds: body.rounds, timer: body.timer, daily: body.daily, round: body.round });
      setScores([]);
      setResult(null);
      beginRound(body.timer);
      setPhase("playing");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.start"));
      setPhase("setup");
    }
  };

  const beginRound = (timer: number) => {
    setPins([]);
    setSelected(null);
    setGraded(null);
    setDeadline(Date.now() + timer * 1000);
  };

  // The clock.
  useEffect(() => {
    if (phase !== "playing" || deadline === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [phase, deadline]);
  const msLeft = phase === "playing" && deadline !== null ? Math.max(0, deadline - now) : null;

  const submitting = useRef(false);
  const submit = useCallback(
    async (timeout = false) => {
      if (!game || submitting.current) return;
      submitting.current = true;
      setPhase("grading");
      const sent = pins;
      try {
        const body = await post<HuntGuessResponse>("/api/geo/hunt/guess", { token: game.token, pins: sent, ...(timeout ? { timeout: true } : {}) });
        setGraded({ body, pins: sent });
        setScores((s) => [...s, body.score]);
        setGame((cur) => (cur ? { ...cur, token: body.token } : cur));
        const recent = read<string[]>(RECENT_KEY, []);
        write(RECENT_KEY, [body.reveal.id, ...recent.filter((id) => id !== body.reveal.id)].slice(0, RECENT_MAX));
        if (body.done && body.result) {
          setResult(body.result);
          if (game.daily) {
            const rec: DailyRecord = { date: game.daily.date, score: body.result.score, rounds: body.result.rounds.map((r) => r.score) };
            write(DAILY_KEY, rec);
            setDaily(rec);
          }
        }
        play(body.score >= 4000 ? "correct" : "pin");
        setPhase("reveal");
      } catch (e) {
        setError(e instanceof Error ? e.message : t("errors.grade"));
        setPhase("playing");
      } finally {
        submitting.current = false;
      }
    },
    [game, pins, t]
  );

  // Time's up: whatever pins are down go in.
  useEffect(() => {
    if (msLeft === 0 && phase === "playing") void submit(true);
  }, [msLeft, phase, submit]);

  // Space hunts once a pin is down (as PokéGuessr's Guess).
  useEffect(() => {
    if (phase !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !pins.length) return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select, button")) return;
      e.preventDefault();
      void submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, pins.length, submit]);

  const next = () => {
    if (!graded || !game) return;
    if (graded.body.done || !graded.body.next) {
      setPhase("results");
      return;
    }
    setGame({ ...game, round: graded.body.next });
    beginRound(game.timer);
    setPhase("playing");
  };

  const leave = () => {
    setConfirmExit(false);
    setGame(null);
    setPhase("setup");
  };
  const requestExit = () => (phase === "playing" || phase === "grading" || phase === "reveal" ? setConfirmExit(true) : leave());

  // ---- pins -------------------------------------------------------------------------
  const max = game?.round.pins ?? 1;
  const onPick = (p: MapPin) => {
    play("pin");
    setPins((cur) => {
      if (selected !== null && selected < cur.length) return cur.map((q, i) => (i === selected ? p : q));
      if (cur.length < max) return [...cur, p];
      // Every pin is down: the nearest one moves.
      let near = 0;
      cur.forEach((q, i) => {
        if (Math.hypot(q.x - p.x, q.y - p.y) < Math.hypot(cur[near].x - p.x, cur[near].y - p.y)) near = i;
      });
      return cur.map((q, i) => (i === near ? p : q));
    });
    setSelected(null);
  };
  const pinMarkers = pins.map((p, i) => ({ ...p, label: String(i + 1), color: selected === i ? "#ffd23c" : "#3a8dde" }));

  // ---- the reveal on the map ----------------------------------------------------------------
  const revealed = useMemo((): RevealedRound[] => {
    if (!graded) return [];
    const { reveal } = graded.body;
    const order = HUNT_REGIONS.filter((r) => reveal.spots.some((s) => s.region === r));
    const base = LINE_DRAW_MS / 1000;
    const spots: RevealedRound[] = reveal.spots.map((s) => ({
      guess: null,
      answer: { pin: s.pin, mask: s.mask },
      delay: base + order.indexOf(s.region) * REGION_STEP_S,
      caption: s.labels.length > 1 ? `${s.labels[0]} +${s.labels.length - 1}` : s.labels[0],
    }));
    const lines: RevealedRound[] = reveal.pins.flatMap((p, i) => {
      if (p.spot === null) return [];
      const s = reveal.spots[p.spot];
      return [{ guess: p.pin, answer: { pin: s.pin, mask: [] }, label: String(i + 1), color: p.found ? "#4cbb17" : "#3a8dde" }];
    });
    return [...spots, ...lines];
  }, [graded]);

  // ---- render -------------------------------------------------------------------------
  if (phase === "setup" || phase === "starting") {
    return <HuntSetup onStart={(spec) => void start(spec)} busy={phase === "starting"} error={error} daily={{ number: dailyNumberOf(today), played: daily ? { score: daily.score } : null }} />;
  }
  if (phase === "results" && result && game) {
    const share = game.daily ? huntShareText(game.daily.number, result.score, result.rounds.map((r) => r.score)) : null;
    return <HuntResults result={result} share={share} onAgain={() => (lastSpec.current && lastSpec.current.mode !== "daily" ? void start(lastSpec.current) : leave())} daily={game.daily ? { number: game.daily.number } : undefined} />;
  }
  if (!game) return null;

  const roundNo = Math.min(game.rounds, scores.length + (phase === "reveal" ? 0 : 1));
  const total = scores.reduce((a, b) => a + b, 0);
  const mapName = game.mode === "region" ? names(`regions.${game.map.id as HuntMapRegionId}`) : undefined;
  const modeLine = game.daily ? t("round.daily", { n: game.daily.number }) : mapName ? `${t("round.mode")} · ${mapName}` : `${t("round.mode")} · ${t("round.classic")}`;
  const pinBar = <HuntPinBar placed={pins.length} max={max} selected={selected} onSelect={(i) => setSelected((s) => (s === i ? null : i))} onRemove={(i) => {
    setPins((cur) => cur.filter((_, k) => k !== i));
    setSelected(null);
  }} />;

  return (
    <GameShell onExit={requestExit}>
      {({ fs, toggle }) => (
        <>
          {phase === "reveal" && graded ? (
            <div className="relative flex h-full flex-col md:block" data-testid="hunt-reveal-view">
              <div className="relative min-h-0 flex-1 md:absolute md:inset-x-0 md:top-0 md:bottom-[11rem]">
                <GeoMap region={game.map} revealed={revealed} fit={{ delay: LINE_DRAW_MS, duration: FIT_MS }} fill controls={false} />
              </div>
              <div className="geo-safe-tl absolute left-3 top-3 z-20">
                <ExitButton onClick={requestExit} />
              </div>
              <div className="geo-safe-tr absolute right-3 top-3 z-20 hidden lg:block">
                <ScoreTracker rounds={game.rounds} scores={scores} current={scores.length - 1} total={fmt(total)} />
              </div>
              <Notch>
                <div className="text-center">
                  <div className="font-display text-xl font-bold uppercase italic leading-none tracking-wide sm:text-2xl">{graded.body.reveal.name}</div>
                  <div className="mt-0.5 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c8bfff]">{graded.body.timedOut ? t("reveal.timedOut") : modeLine}</div>
                </div>
              </Notch>
              <div className="relative z-20 shrink-0 border-t-4 border-[#a99cff] bg-[#1e1a3f]/95 text-white shadow-[0_-12px_40px_rgba(0,0,0,0.5)] backdrop-blur md:absolute md:inset-x-0 md:bottom-0">
                <HuntRevealPanel reveal={graded.body.reveal} score={graded.body.score} index={scores.length - 1} rounds={game.rounds} onNext={next} last={graded.body.done} />
              </div>
            </div>
          ) : (
            <div className="relative h-full" data-testid="hunt-play-view">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,#2d2766_0%,#0f0d1f_70%)]" style={{ bottom: "var(--geo-bar)" }}>
                <HuntRoundCard round={game.round} mode={game.mode} mapName={mapName} />
              </div>
              {phone ? (
                <>
                  <HudDials>
                    {msLeft !== null && <TimerDial ms={msLeft} totalMs={game.timer * 1000} urgentMs={10_000} testId="hunt-time-left" clock />}
                    <RoundReadout round={roundNo} rounds={game.rounds} total={fmt(total)} />
                  </HudDials>
                  <RoundBadge testId="geo-round" label={g("round")} value={roundNo} of={game.rounds} mode={modeLine} />
                </>
              ) : (
                <>
                  <div className="geo-safe-tl absolute left-3 top-3 z-20 flex items-center gap-2">
                    <ExitButton onClick={requestExit} />
                    <FullscreenButton fs={fs} onClick={toggle} />
                  </div>
                  <Notch below={msLeft !== null ? <CountdownPill ms={msLeft} totalMs={game.timer * 1000} urgentMs={10_000} testId="hunt-time-left" clock /> : undefined}>
                    <div className="min-w-0 text-center">
                      <div className="font-display text-xl font-bold uppercase italic leading-none tracking-wide sm:text-2xl" data-testid="geo-round">
                        {g("round")} {roundNo}
                        <span className="text-white/50">/{game.rounds}</span>
                      </div>
                      <div className="mt-0.5 truncate font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c8bfff]">{modeLine}</div>
                    </div>
                  </Notch>
                  <div className="geo-safe-tr absolute right-3 top-3 z-20 flex items-start gap-2">
                    <ScoreTracker className="max-lg:hidden" rounds={game.rounds} scores={scores} current={roundNo - 1} total={fmt(total)} />
                    <RoundReadout className="!h-9 lg:hidden" testId="geo-score-compact" round={roundNo} rounds={game.rounds} total={fmt(total)} />
                  </div>
                </>
              )}
              {error && (
                <p className="absolute left-1/2 top-24 z-30 -translate-x-1/2 rounded-md bg-destructive px-3 py-2 text-sm" role="alert">
                  {error}
                </p>
              )}
              <MapDock
                resetKey={game.round.index}
                hasPin={pins.length > 0}
                map={({ fill, land }) => <GeoMap land={land} round={game.round.index} region={game.map} others={pinMarkers} fill={fill} onPick={onPick} />}
                tools={
                  <button type="button" onClick={requestExit} className={BAR_BTN} aria-label={g("shell.back")} title={g("shell.back")} data-testid="geo-exit" data-keep>
                    <X className="h-5 w-5" />
                  </button>
                }
                extra={pinBar}
                button={<GuessButton hasPin={pins.length > 0} busy={phase === "grading"} disabled={phase === "grading"} onClick={() => void submit()} />}
              />
            </div>
          )}
          {confirmExit && <ConfirmExit daily={!!game.daily} onLeave={leave} onStay={() => setConfirmExit(false)} />}
        </>
      )}
    </GameShell>
  );
}
