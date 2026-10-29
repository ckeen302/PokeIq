"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, Copy, Crown, Link2, Loader2, Pause, Play, SkipBack, SkipForward, Swords, Trophy, Zap } from "lucide-react";
import { DUEL_HP, type DuelRoundResult } from "@/lib/duel-types";
import { REPLAY_PHASES, replayHp, replayStep, replaySteps, type GeoDuelReplay, type ReplayPhase } from "@/lib/geo-duel-history";
import { WORLD_REGION, type GeoAnswer, type GeoRegionInfo } from "@/lib/geo-types";
import { GEO_ERA_NAMES } from "@/lib/geo-families";
import { keepRankedId } from "@/lib/ranked-client";
import { Button, buttonVariants } from "@/components/ui/button";
import { BackButton } from "@/components/ui/BackButton";
import { SEAT_COLORS } from "@/components/duel/DuelParts";
import { cn } from "@/lib/utils";
import { GeoMap, type RevealedRound } from "./GeoMap";
import { THEM_COLOR, YOU_COLOR, distanceText } from "./DuelHud";
import { GymLeaderTag } from "./GeoRanked";
import { EloChange, formatDuelDate, historyHeaders } from "./DuelHistory";

/**
 * A kept PokéGuessr duel, replayed (/guessr/history/<code>): round by round,
 * the screenshot, then both pins and the true place on the map with the
 * distances and scores, then the damage landing and the HP after. Step
 * through with the buttons (or ← →), or press Play. Only the two trainers
 * can open it, unless one of them shares the link.
 */

const fmt = (n: number) => n.toLocaleString("en-US");
const STEP_MS: Record<ReplayPhase, number> = { shot: 2200, pins: 3200, damage: 2600 };
const PHASE_LABEL: Record<ReplayPhase, string> = { shot: "The shot", pins: "The pins", damage: "The damage" };

/** As the duel shows places: no "Kanto " before route names, no wiki disambiguation, and the region on the world map. */
const clean = (s: string) => s.replace(/^(Kanto|Johto|Hoenn|Sinnoh|Unova|Kalos|Alola|Galar|Paldea) (?=Route)/, "");
const shown = (s: string) => clean(s).replace(/ \((Kanto|Johto|Hoenn|Sinnoh|Unova|Kalos|Alola|Galar|Paldea|Generation [IVX]+|BW|B2W2|Jagged Pass)\)$/, "");
function placeName(answer: GeoAnswer, map: GeoRegionInfo): string {
  const name = answer.parent ? `${shown(answer.name)} · ${shown(answer.parent)}` : shown(answer.name);
  return answer.region && answer.region !== map.name ? `${name}, ${answer.region}` : name;
}

type Load = { status: "loading" } | { status: "missing" } | { status: "error"; message: string } | { status: "ready"; replay: GeoDuelReplay };

function useReplay(code: string) {
  const [state, setState] = useState<Load>({ status: "loading" });
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/geo/history/${code}`, { headers: historyHeaders(), cache: "no-store" });
        const data = (await res.json().catch(() => null)) as (GeoDuelReplay & { error?: string; id?: string }) | null;
        if (!live) return;
        if (data?.id) keepRankedId(data.id);
        if (res.status === 404) return setState({ status: "missing" });
        if (!res.ok || !data) return setState({ status: "error", message: data?.error ?? "Couldn't load the replay." });
        setState({ status: "ready", replay: data });
      } catch {
        if (live) setState({ status: "error", message: "Couldn't load the replay." });
      }
    })();
    return () => {
      live = false;
    };
  }, [code]);
  return [state, setState] as const;
}

export function GeoReplay({ code, regions }: { code: string; regions: GeoRegionInfo[] }) {
  const [state, setState] = useReplay(code);
  if (state.status === "loading") {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <BackButton href="/guessr/history" label="Duel history" />
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading the replay…
        </p>
      </div>
    );
  }
  if (state.status !== "ready") {
    return (
      <div className="mx-auto max-w-3xl space-y-6" data-testid="geo-replay-missing">
        <BackButton href="/guessr/history" label="Duel history" />
        <div className="space-y-3 rounded-lg border bg-card p-6 text-center">
          <p className="font-display text-xl font-bold">{state.status === "missing" ? "No replay here" : "Something went wrong"}</p>
          <p className="text-sm text-muted-foreground">
            {state.status === "missing" ? "This duel's replay doesn't exist, or it's private to the two trainers who played it." : state.message}
          </p>
          <Link href="/guessr" className={buttonVariants({ variant: "outline" })}>
            <Swords className="h-4 w-4" aria-hidden /> Play PokéGuessr
          </Link>
        </div>
      </div>
    );
  }
  const map = regions.find((r) => r.id === state.replay.region) ?? regions.find((r) => r.id === WORLD_REGION) ?? regions[0];
  return <ReplayView replay={state.replay} map={map} onShared={(value) => setState({ status: "ready", replay: { ...state.replay, public: value } })} />;
}

function ReplayView({ replay, map, onShared }: { replay: GeoDuelReplay; map: GeoRegionInfo; onShared: (value: boolean) => void }) {
  const reduced = useReducedMotion();
  const rounds = replay.rounds;
  const total = replaySteps(rounds.length);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const { round: index, phase } = replayStep(step, rounds.length);
  const round: DuelRoundResult | undefined = rounds[index];
  const me = replay.you;
  // Viewer first: you on the left in green. A shared replay keeps the seats' own colours.
  const order = me === 1 ? [1, 0] : [0, 1];
  const colorOf = (seat: number) => (me === null ? SEAT_COLORS[seat] : seat === me ? YOU_COLOR : THEM_COLOR);
  const nameOf = (seat: number) => replay.players[seat]?.name ?? "Trainer";

  const go = useCallback((s: number) => setStep(Math.max(0, Math.min(total - 1, s))), [total]);

  // Play: through the steps at the duel's pace, stopping at the end.
  useEffect(() => {
    if (!playing) return;
    if (step >= total - 1) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => setStep((s) => s + 1), reduced ? 1200 : STEP_MS[phase]);
    return () => window.clearTimeout(id);
  }, [playing, step, total, phase, reduced]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "ArrowRight") go(step + 1);
      else if (e.key === "ArrowLeft") go(step - 1);
      else return;
      setPlaying(false);
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, step]);

  const revealed: RevealedRound[] = useMemo(
    () =>
      !round || phase === "shot"
        ? []
        : order.map((seat) => {
            const g = round.guesses[seat];
            return { guess: g && { x: g.x, y: g.y }, answer: round.answer, color: colorOf(seat), label: String(index + 1) };
          }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [round, phase, index, me]
  );

  const won = me !== null && replay.winner === me;
  const draw = replay.winner === null;
  const headline = me === null ? (draw ? "Draw" : `${nameOf(replay.winner!)} won`) : draw ? "Draw" : won ? "Victory" : "Defeat";
  const hp = round ? replayHp(round, phase) : replay.hp;

  return (
    <div className="mx-auto max-w-6xl space-y-5" data-testid="geo-replay">
      <BackButton href="/guessr/history" label="Duel history" />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="hud-label flex flex-wrap items-center gap-x-2 gap-y-0.5 text-screen">
            <span className={cn("inline-flex items-center gap-1", replay.ranked && "text-warning")}>
              {replay.ranked ? <Trophy className="h-3 w-3" aria-hidden /> : <Swords className="h-3 w-3" aria-hidden />}
              {replay.ranked ? "Ranked" : "Casual"} replay
            </span>
            <span className="text-muted-foreground">
              {replay.mode === "race" ? "Points race" : "HP battle"} · {map.id === WORLD_REGION ? "World map" : map.name}
              {replay.era ? ` · ${GEO_ERA_NAMES[replay.era]}` : ""}
            </span>
            {replay.turbo && (
              <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                <Zap className="h-3 w-3" aria-hidden /> Turbo
              </span>
            )}
          </p>
          <h1 className="flex min-w-0 flex-wrap items-center gap-x-2 font-display text-2xl font-bold tracking-tight sm:text-3xl">
            <span className="truncate" style={{ color: colorOf(order[0]) }}>
              {nameOf(order[0])}
            </span>
            <span className="text-muted-foreground">vs</span>
            <span className="truncate" style={{ color: colorOf(order[1]) }}>
              {nameOf(order[1])}
            </span>
            {replay.players.some((p) => p.bot) && <GymLeaderTag />}
          </h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className={cn("inline-flex items-center gap-1 font-display font-bold uppercase", draw ? "text-[#8b7cf6]" : me === null || won ? "text-success" : "text-destructive")} data-testid="geo-replay-result">
              {(won || (me === null && !draw)) && <Crown className="h-4 w-4" aria-hidden />}
              {headline}
            </span>
            <span>{formatDuelDate(replay.endedAt)}</span>
            {replay.elo && me !== null && (
              <span className="inline-flex items-center gap-1">
                Elo <EloChange before={replay.elo.before[me]} after={replay.elo.after[me]} />
              </span>
            )}
          </p>
        </div>
        {me !== null && <ShareReplay code={replay.code} shared={replay.public} onShared={onShared} />}
      </header>

      {!round ? (
        <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">This duel ended before a round was played.</p>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <figure className="relative aspect-video overflow-hidden rounded-lg border bg-black" data-testid="geo-replay-shot">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img key={round.shot} src={round.shot} alt={`Round ${index + 1}'s screenshot`} className="h-full w-full object-contain" decoding="async" />
              <figcaption className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 font-pixel text-[10px] uppercase text-white">
                Round {index + 1}
                {round.multiplier > 1 ? ` · ×${round.multiplier} damage` : ""}
              </figcaption>
              {phase !== "shot" && (
                <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-3 pb-2 pt-6 text-white" data-testid="geo-replay-place">
                  <span className="block truncate font-semibold">{placeName(round.answer, map)}</span>
                  <span className="block truncate text-xs text-white/70">{round.answer.game}</span>
                </figcaption>
              )}
            </figure>
            <div className="relative aspect-video overflow-hidden rounded-lg border" data-testid="geo-replay-map">
              <GeoMap region={map} revealed={revealed} fill className="absolute inset-0" />
            </div>
          </div>

          <Controls
            step={step}
            total={total}
            playing={playing}
            label={`Round ${index + 1} of ${rounds.length} · ${PHASE_LABEL[phase]}`}
            onStep={(s) => {
              setPlaying(false);
              go(s);
            }}
            onPlay={() => {
              if (step >= total - 1) setStep(0);
              setPlaying((p) => !p);
            }}
          />

          <div className="grid gap-3 sm:grid-cols-2" data-testid="geo-replay-players">
            {order.map((seat) => (
              <SeatPanel
                key={seat}
                name={nameOf(seat)}
                color={colorOf(seat)}
                bot={!!replay.players[seat]?.bot}
                round={round}
                seat={seat}
                phase={phase}
                hp={hp[seat] ?? 0}
                race={replay.mode === "race"}
              />
            ))}
          </div>

          <RoundTable replay={replay} map={map} order={order} colorOf={colorOf} current={index} onJump={(i) => {
            setPlaying(false);
            go(i * REPLAY_PHASES.length + 1);
          }} />
        </>
      )}
    </div>
  );
}

function Controls({ step, total, playing, label, onStep, onPlay }: { step: number; total: number; playing: boolean; label: string; onStep: (s: number) => void; onPlay: () => void }) {
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3" data-testid="geo-replay-controls">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="flex items-center gap-1">
          <Button type="button" size="icon" variant="ghost" onClick={() => onStep(0)} disabled={step === 0} aria-label="First step">
            <SkipBack className="h-4 w-4" aria-hidden />
          </Button>
          <Button type="button" size="icon" variant="ghost" onClick={() => onStep(step - 1)} disabled={step === 0} aria-label="Previous step" data-testid="geo-replay-prev">
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </Button>
          <Button type="button" size="icon" onClick={onPlay} aria-label={playing ? "Pause" : "Play"} data-testid="geo-replay-play">
            {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
          </Button>
          <Button type="button" size="icon" variant="ghost" onClick={() => onStep(step + 1)} disabled={step >= total - 1} aria-label="Next step" data-testid="geo-replay-next">
            <ChevronRight className="h-5 w-5" aria-hidden />
          </Button>
          <Button type="button" size="icon" variant="ghost" onClick={() => onStep(total - 1)} disabled={step >= total - 1} aria-label="Last step">
            <SkipForward className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <p className="min-w-0 font-pixel text-[11px] text-muted-foreground sm:text-right" aria-live="polite" data-testid="geo-replay-step">
          {label}
        </p>
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(0, total - 1)}
        value={step}
        onChange={(e) => onStep(Number(e.target.value))}
        className="w-full accent-primary"
        aria-label="Replay position"
      />
    </div>
  );
}

function SeatPanel({ name, color, bot, round, seat, phase, hp, race }: { name: string; color: string; bot: boolean; round: DuelRoundResult; seat: number; phase: ReplayPhase; hp: number; race: boolean }) {
  const g = round.guesses[seat];
  const open = phase !== "shot";
  const dealt = phase === "damage" && round.winner === seat ? round.damage : 0;
  const took = phase === "damage" && round.hurt === seat ? round.damage : 0;
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3" style={{ borderColor: `${color}66` }} data-testid="geo-replay-seat">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
          <span className="truncate font-semibold">{name}</span>
          {bot && <GymLeaderTag />}
        </span>
        {open && round.winner === seat && <span className="font-pixel text-[10px] uppercase text-success">Round won</span>}
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-foreground/[0.04] p-2">
          <dt className="hud-label">Distance</dt>
          <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums">{!open ? "—" : g ? distanceText(g.squares) : "No guess"}</dd>
        </div>
        <div className="rounded-md bg-foreground/[0.04] p-2">
          <dt className="hud-label">Score</dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums">{!open ? "—" : fmt(g?.score ?? 0)}</dd>
        </div>
        <div className="rounded-md bg-foreground/[0.04] p-2">
          <dt className="hud-label">{race ? "Mult." : "Damage"}</dt>
          <dd className={cn("mt-0.5 text-sm font-semibold tabular-nums", dealt > 0 && "text-success")}>
            {race ? `×${round.multipliers[seat] ?? 1}` : phase !== "damage" ? "—" : dealt > 0 ? fmt(dealt) : "0"}
          </dd>
        </div>
      </dl>
      {!race && (
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>HP</span>
            <span className="tabular-nums">
              {took > 0 && <span className="mr-1.5 text-destructive">−{fmt(took)}</span>}
              <b className="text-foreground">{fmt(hp)}</b> / {fmt(DUEL_HP)}
            </span>
          </div>
          <span className="block h-2 overflow-hidden rounded-full bg-foreground/10" role="meter" aria-valuemin={0} aria-valuemax={DUEL_HP} aria-valuenow={hp} aria-label={`${name}'s HP`}>
            <span className="block h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${Math.max(0, Math.min(100, (hp / DUEL_HP) * 100))}%`, background: color }} />
          </span>
        </div>
      )}
    </div>
  );
}

function RoundTable({
  replay,
  map,
  order,
  colorOf,
  current,
  onJump,
}: {
  replay: GeoDuelReplay;
  map: GeoRegionInfo;
  order: number[];
  colorOf: (seat: number) => string;
  current: number;
  onJump: (index: number) => void;
}) {
  const race = replay.mode === "race";
  return (
    <div className="overflow-hidden rounded-lg border bg-card" data-testid="geo-replay-table">
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="hud-label w-10 px-3 py-2">#</th>
            <th className="hud-label px-2 py-2">Place</th>
            {order.map((seat) => (
              <th key={seat} className="hud-label w-16 px-2 py-2 text-right sm:w-24">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colorOf(seat) }} aria-hidden />
                <span className="sr-only">{replay.players[seat]?.name}</span>
              </th>
            ))}
            {!race && <th className="hud-label w-16 px-3 py-2 text-right sm:w-24">Dmg</th>}
          </tr>
        </thead>
        <tbody>
          {replay.rounds.map((r, i) => (
            <tr key={r.index} className={cn("cursor-pointer border-b last:border-0 hover:bg-foreground/[0.03]", i === current && "bg-primary/[0.07]")} onClick={() => onJump(i)}>
              <td className="px-3 py-2 font-pixel text-[11px] text-muted-foreground">
                <button type="button" className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onJump(i)} aria-label={`Go to round ${i + 1}`}>
                  R{i + 1}
                </button>
              </td>
              <td className="truncate px-2 py-2">
                <span className="font-semibold">{placeName(r.answer, map)}</span>
                <span className="hidden text-muted-foreground sm:inline"> · {r.answer.game}</span>
              </td>
              {order.map((seat) => (
                <td key={seat} className={cn("px-2 py-2 text-right tabular-nums", r.winner === seat && "font-bold text-success")}>
                  {r.guesses[seat] ? fmt(r.guesses[seat]!.score) : "—"}
                </td>
              ))}
              {!race && (
                <td className="px-3 py-2 text-right font-pixel text-[11px] tabular-nums" style={r.hurt === null ? undefined : { color: colorOf(r.winner ?? 0) }}>
                  {r.hurt === null ? "0" : fmt(r.damage)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Sharing: makes the replay's link work for anyone (and copies it), or private again. */
function ShareReplay({ code, shared, onShared }: { code: string; shared: boolean; onShared: (value: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/guessr/history/${code}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy the address from the address bar.");
    }
  };
  const set = async (value: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/geo/history/${code}`, { method: "POST", headers: { "Content-Type": "application/json", ...historyHeaders() }, body: JSON.stringify({ public: value }) });
      if (!res.ok) throw new Error();
      onShared(value);
      if (value) await copy();
    } catch {
      setError("Couldn't change sharing. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end" data-testid="geo-replay-share">
      <div className="flex flex-wrap gap-2">
        {shared ? (
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
              {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? "Copied" : "Copy link"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void set(false)}>
              Make private
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void set(true)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />} Share replay
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">{shared ? "Anyone with the link can watch." : "Private to you and your opponent."}</p>
      {error && (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
