"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, Crosshair, Info, Loader2, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnalysisUnsupported, analyseReplay, BUDGET_MS, cachedAnalysis, sourceText, unsupportedReason, type AnalysisProgress, type AnalysisResult } from "@/lib/battle/analysis/run";
import { pct, type WinPoint } from "@/lib/battle/analysis/maths";
import type { SideIndex } from "@/lib/battle/analysis/parse";
import { LabPool } from "@/lib/battle/lab/pool";
import type { ReplayData } from "@/lib/battle/replay";
import { cn } from "@/lib/utils";
import { CardSection, SIDE_COLOR, TableView, Tooltip, useWidth } from "./lab/charts";

/**
 * A finished battle's analysis, on its replay page: the win chance turn by
 * turn from one player's side (rollouts on the Battle Lab's simulator, in
 * this browser), the turns that swung it most, and missed KOs and risky
 * switch-ins from the damage calc. Run on demand; kept in this browser.
 */

type State =
  | { status: "idle" }
  | { status: "running"; progress: AnalysisProgress }
  | { status: "done"; result: AnalysisResult }
  | { status: "error"; message: string };

function sideFromUrl(): SideIndex | null {
  const side = new URLSearchParams(window.location.search).get("side");
  return side === "0" ? 0 : side === "1" ? 1 : null;
}

export function ReplayAnalysis({ replay }: { replay: ReplayData }) {
  const unsupported = unsupportedReason(replay);
  const [viewer, setViewer] = useState<SideIndex>(0);
  const [state, setState] = useState<State>({ status: "idle" });
  const pool = useRef<LabPool | null>(null);
  const runId = useRef(0);
  const section = useRef<HTMLDivElement | null>(null);

  const start = useCallback(
    async (side: SideIndex) => {
      const id = ++runId.current;
      pool.current ??= new LabPool();
      setState({ status: "running", progress: { done: 0, total: replay.turns, points: [], stage: "sets" } });
      try {
        const result = await analyseReplay(
          replay,
          side,
          pool.current,
          (progress) => id === runId.current && setState({ status: "running", progress }),
          () => id !== runId.current
        );
        if (id !== runId.current) return;
        setState(result ? { status: "done", result } : { status: "idle" });
      } catch (err) {
        if (id !== runId.current) return;
        setState({ status: "error", message: err instanceof AnalysisUnsupported || err instanceof Error ? err.message : "The analysis stopped." });
      }
    },
    [replay]
  );

  // The side from the link (the after-battle button), a cached result, and ?analysis=1 starts it.
  useEffect(() => {
    const side = sideFromUrl() ?? 0;
    setViewer(side);
    const cached = cachedAnalysis(replay.id, side);
    if (cached) setState({ status: "done", result: cached });
    const params = new URLSearchParams(window.location.search);
    if (params.get("analysis") === "1") {
      section.current?.scrollIntoView({ block: "start" });
      if (!cached && !unsupported) void start(side);
    }
  }, [replay.id, start, unsupported]);

  useEffect(
    () => () => {
      runId.current++;
      pool.current?.dispose();
    },
    []
  );

  const pickSide = (side: SideIndex) => {
    if (side === viewer) return;
    runId.current++;
    setViewer(side);
    const cached = cachedAnalysis(replay.id, side);
    setState(cached ? { status: "done", result: cached } : { status: "idle" });
  };

  return (
    <div ref={section} id="analysis" className="scroll-mt-20">
      <CardSection
        title="Analysis"
        aside={state.status === "done" ? `${state.result.rollouts.toLocaleString("en-US")} simulated battles · ${(state.result.ms / 1000).toFixed(1)} s` : "Win chance, turn by turn"}
      >
        <div data-testid="replay-analysis" className="space-y-4">
          {unsupported ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="analysis-unsupported">
              <Info className="h-4 w-4 shrink-0" aria-hidden /> {unsupported}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="hud-label">Analyse as</span>
                {replay.players.map((name, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pickSide(i as SideIndex)}
                    disabled={state.status === "running"}
                    className={cn(
                      "h-8 rounded-md border px-3 font-display text-xs font-bold uppercase tracking-wider disabled:opacity-50",
                      viewer === i ? "border-primary bg-primary/10 text-primary" : "hover:border-screen/60"
                    )}
                    aria-pressed={viewer === i}
                  >
                    {name}
                  </button>
                ))}
                <span className="ml-auto flex gap-2">
                  {state.status === "running" ? (
                    <Button size="sm" variant="outline" onClick={() => (runId.current++, setState({ status: "idle" }))}>
                      <Square className="h-4 w-4" aria-hidden /> Stop
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => start(viewer)} data-testid="analysis-run">
                      {state.status === "done" ? <RotateCcw className="h-4 w-4" aria-hidden /> : <Activity className="h-4 w-4" aria-hidden />}
                      {state.status === "done" ? "Run again" : "Analyse this battle"}
                    </Button>
                  )}
                </span>
              </div>

              {state.status === "idle" && (
                <p className="text-sm text-muted-foreground">
                  Plays the battle out many times from the start of every turn on Pokémon Showdown&apos;s simulator, in your browser, to estimate {replay.players[viewer]}&apos;s chance to win
                  at each point. About {Math.round(BUDGET_MS / 1000)} seconds for a typical battle.
                </p>
              )}
              {state.status === "running" && <Progress progress={state.progress} />}
              {state.status === "error" && (
                <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> {state.message}
                </p>
              )}
              {(state.status === "running" || state.status === "done") && (
                <WinChart points={state.status === "done" ? state.result.points : state.progress.points} last={replay.turns} name={replay.players[viewer]} keyTurns={state.status === "done" ? state.result.keyMoments.map((k) => k.turn) : []} />
              )}
              {state.status === "done" && <Findings result={state.result} />}
            </>
          )}
        </div>
      </CardSection>
    </div>
  );
}

function Progress({ progress }: { progress: AnalysisProgress }) {
  const share = progress.total ? progress.done / progress.total : 0;
  const label = progress.stage === "sets" ? "Filling in unrevealed sets…" : progress.stage === "calc" ? "Running the damage calc…" : `Turn ${progress.done} of ${progress.total}`;
  return (
    <div className="space-y-1" data-testid="analysis-progress">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {label}
        </span>
        <span className="font-mono tabular-nums">{Math.round(share * 100)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-shade/40" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
        <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

function WinChart({ points, last, name, keyTurns }: { points: WinPoint[]; last: number; name: string; keyTurns: number[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<WinPoint | null>(null);
  const height = 220;
  const m = { l: 38, r: 16, t: 10, b: 24 };
  const w = Math.max(10, width - m.l - m.r);
  const h = height - m.t - m.b;
  const end = last + 1;
  const xs = (t: number) => m.l + ((t - 1) / Math.max(1, end - 1)) * w;
  const ys = (p: number) => m.t + (1 - p) * h;
  const line = points.map((p, i) => `${i ? "L" : "M"}${xs(p.turn).toFixed(1)},${ys(p.p).toFixed(1)}`).join("");
  const band = points.length
    ? `${points.map((p, i) => `${i ? "L" : "M"}${xs(p.turn).toFixed(1)},${ys(p.hi).toFixed(1)}`).join("")}${[...points]
        .reverse()
        .map((p) => `L${xs(p.turn).toFixed(1)},${ys(p.lo).toFixed(1)}`)
        .join("")}Z`
    : "";
  const step = Math.max(1, Math.ceil(end / 12));
  const ticks = Array.from({ length: end }, (_, i) => i + 1).filter((t) => t === 1 || t === end || t % step === 0);

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    if (!points.length) return;
    const box = e.currentTarget.getBoundingClientRect();
    const t = 1 + ((e.clientX - box.left) / Math.max(1, box.width)) * (end - 1);
    setHover(points.reduce((a, b) => (Math.abs(b.turn - t) < Math.abs(a.turn - t) ? b : a)));
  }

  return (
    <div className="space-y-1" data-testid="analysis-chart">
      <div ref={ref} className="relative w-full">
        {width > 0 && (
          <svg width={width} height={height} className="block overflow-visible" role="img" aria-label={`${name}'s win chance by turn`}>
            {[0, 0.25, 0.5, 0.75, 1].map((p) => (
              <g key={p}>
                <line x1={m.l} x2={m.l + w} y1={ys(p)} y2={ys(p)} stroke="hsl(var(--border))" strokeWidth={1} strokeDasharray={p === 0.5 ? "4 3" : undefined} />
                <text x={m.l - 6} y={ys(p)} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px] tabular-nums">
                  {p * 100}%
                </text>
              </g>
            ))}
            {ticks.map((t) => (
              <text key={t} x={xs(t)} y={height - 6} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px] tabular-nums">
                {t === end ? "End" : t}
              </text>
            ))}
            {band && <path d={band} fill={SIDE_COLOR[0]} opacity={0.14} />}
            {line && <path d={line} fill="none" stroke={SIDE_COLOR[0]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
            {points
              .filter((p) => keyTurns.includes(p.turn) || keyTurns.includes(p.turn - 1))
              .map((p) => (
                <circle key={p.turn} cx={xs(p.turn)} cy={ys(p.p)} r={3.5} fill="hsl(var(--card))" stroke={SIDE_COLOR[0]} strokeWidth={2} />
              ))}
            {hover && (
              <>
                <line x1={xs(hover.turn)} x2={xs(hover.turn)} y1={m.t} y2={m.t + h} stroke="hsl(var(--muted-foreground))" strokeWidth={1} opacity={0.6} />
                <circle cx={xs(hover.turn)} cy={ys(hover.p)} r={4} fill={SIDE_COLOR[0]} stroke="hsl(var(--card))" strokeWidth={2} />
              </>
            )}
            <rect x={m.l} y={m.t} width={w} height={h} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
          </svg>
        )}
        {hover && (
          <Tooltip x={xs(hover.turn)} width={width}>
            <p className="font-mono text-sm font-semibold tabular-nums">{pct(hover.p)}</p>
            <p className="text-muted-foreground">
              {hover.n ? (
                <>
                  Start of turn {hover.turn}
                  <br />
                  95% CI {pct(hover.lo)}–{pct(hover.hi)}
                  <br />
                  {hover.n} simulated battles
                </>
              ) : (
                "The result"
              )}
            </p>
          </Tooltip>
        )}
      </div>
      <TableView
        caption={`${name}'s win chance by turn`}
        head={["Turn", "Win chance", "95% CI", "Battles"]}
        rows={points.map((p) => [p.n ? p.turn : "End", pct(p.p), p.n ? `${pct(p.lo)}–${pct(p.hi)}` : "—", p.n || "—"])}
      />
    </div>
  );
}

function Findings({ result }: { result: AnalysisResult }) {
  const viewerName = result.players[result.viewer];
  const foeName = result.players[result.viewer === 0 ? 1 : 0];
  const widest = Math.max(0, ...result.points.filter((p) => p.n).map((p) => (p.hi - p.lo) / 2));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        <h4 className="hud-label">Key moments</h4>
        {result.keyMoments.length ? (
          <ol className="space-y-1.5 text-sm" data-testid="key-moments">
            {result.keyMoments.map((k) => (
              <li key={k.turn} className="rounded-md border border-foreground/10 bg-shade/20 px-3 py-2">
                {k.text}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="key-moments">
            No turn moved the win chance by more than the simulations&apos; own margin of error.
          </p>
        )}
      </div>
      <div className="space-y-2">
        <h4 className="hud-label">Missed KOs and risky plays</h4>
        {result.missedKos.length + result.riskySwitches.length ? (
          <ul className="space-y-1.5 text-sm" data-testid="missed-kos">
            {[...result.missedKos.map((l) => ({ ...l, kind: "ko" })), ...result.riskySwitches.map((l) => ({ ...l, kind: "risk" }))]
              .sort((a, b) => a.turn - b.turn)
              .map((l, i) => (
                <li key={i} className="flex gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2">
                  {l.kind === "ko" ? <Crosshair className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />}
                  <span>{l.text}</span>
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="missed-kos">
            No missed KOs (a move {viewerName} had shown with a 50%+ chance to KO, not used) and no switch-ins into a likely KO.
          </p>
        )}
      </div>
      <div className="space-y-1 rounded-md border border-foreground/10 p-3 text-xs text-muted-foreground lg:col-span-2" data-testid="analysis-assumptions">
        <p className="flex items-center gap-1.5 font-semibold text-foreground">
          <Info className="h-3.5 w-3.5" aria-hidden /> How this was worked out
        </p>
        <p>
          From {viewerName}&apos;s side, using only what the battle showed: each Pokémon&apos;s HP, status, stat stages, hazards, weather and Tera as they stood at the start of the
          turn. Every turn was played out to the end {Math.round(result.rollouts / Math.max(1, result.points.length - 1))} times on average by the computer&apos;s Hard strategy for both
          sides; the shaded band is the 95% confidence interval (up to ±{pct(widest)}).
        </p>
        <p>
          What wasn&apos;t revealed is assumed. {viewerName}: {sourceText(result.sources[result.viewer]) || "nothing"}. {foeName}: {sourceText(result.sources[result.viewer === 0 ? 1 : 0]) || "nothing"}.{" "}
          {result.assumedMoves} move{result.assumedMoves === 1 ? " was" : "s were"} assumed rather than seen. Pokémon that came out later in the battle are counted from the start.
          Missed KOs use only moves {viewerName}&apos;s Pokémon actually used; KO chances are the damage calc&apos;s non-critical rolls times accuracy.
        </p>
      </div>
    </div>
  );
}
