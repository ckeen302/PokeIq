"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Check, Clapperboard, Copy, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LabReplay } from "@/lib/battle/lab/pool";
import { count, margin, meanTurns, medianTurns, pct, summaryLine, topMoves, wilson } from "@/lib/battle/lab/stats";
import { STRATEGY_INFO, TURN_LIMIT } from "@/lib/battle/lab/types";
import { cn } from "@/lib/utils";
import type { SpriteSpecies } from "@/lib/battle/sprites";
import { BattleSprite } from "../BattleSprite";
import { CardSection, ConvergenceChart, DRAW_COLOR, Legend, OutcomeBar, SIDE_COLOR, StackedColumns, Swatch, turnBins } from "./charts";
import type { LabRun } from "./use-lab-run";

const SampleReplay = dynamic(() => import("./SampleReplay"), {
  ssr: false,
  loading: () => (
    <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Loading the replay…
    </p>
  ),
});

function Tile({ label, value, ci, color, testId }: { label: string; value: string; ci?: string; color?: string; testId?: string }) {
  return (
    <div className="min-w-0 space-y-1 rounded-lg border bg-shade/20 p-3" data-testid={testId}>
      <p className="hud-label flex items-center gap-1.5 normal-case tracking-wider">
        {color && <Swatch color={color} />} {label}
      </p>
      <p className="font-display text-3xl font-bold leading-none">{value}</p>
      {ci && <p className="font-mono text-[11px] tabular-nums text-muted-foreground">{ci}</p>}
    </div>
  );
}

/** A thin horizontal meter, for shares in tables. */
function Share({ value, color }: { value: number; color: string }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-shade/40" aria-hidden>
      <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </span>
  );
}

export function LabResults({
  run,
  sprite,
  onRerun,
  onCopyLink,
  replayBattle,
}: {
  run: LabRun;
  sprite: ((name: string) => SpriteSpecies | null) | null;
  onRerun: (seed: string) => void;
  onCopyLink: () => Promise<boolean>;
  replayBattle: (index: number) => Promise<LabReplay>;
}) {
  const { progress, labels, setup } = run;
  const t = progress.totals;
  const n = t.battles;
  const running = run.status === "running";
  const ciA = wilson(t.wins[0], n);
  const ciB = wilson(t.wins[1], n);
  const ciD = wilson(t.draws, n);
  const oneVsOne = !setup.doubles && setup.sides[0].team.length === 1 && setup.sides[1].team.length === 1;
  const [copied, setCopied] = useState(false);
  const [replay, setReplay] = useState<{ state: "loading" } | { state: "ready"; data: LabReplay } | { state: "error"; message: string } | null>(null);

  const ciText = (ci: ReturnType<typeof wilson>) => `± ${pct(margin(ci))} · 95% CI ${pct(ci.lo)}–${pct(ci.hi)}`;

  async function watch(outcome: 1 | 2 | 3) {
    const indices: number[] = [];
    progress.outcomes.forEach((o, i) => o === outcome && indices.push(i));
    if (!indices.length) return;
    const index = indices[Math.floor(Math.random() * indices.length)];
    setReplay({ state: "loading" });
    try {
      setReplay({ state: "ready", data: await replayBattle(index) });
    } catch (err) {
      setReplay({ state: "error", message: err instanceof Error ? err.message : "Couldn't replay that battle." });
    }
  }

  const bins = turnBins(t);
  const sideNames = [`${labels[0]} wins`, `${labels[1]} wins`];

  return (
    <div className="space-y-4" aria-busy={running}>
      {/* The answer */}
      <div className="hud space-y-4 rounded-lg border bg-card p-4 sm:p-5">
        <div className="space-y-1">
          <p className="font-display text-xl font-bold leading-snug sm:text-2xl" data-testid="lab-summary" aria-live={running ? "off" : "polite"}>
            {n ? summaryLine(t, labels) : "Starting the simulator…"}
          </p>
          <p className="hud-label normal-case tracking-wider">
            Gen {setup.gen} {setup.doubles ? "doubles" : "singles"} · {STRATEGY_INFO[setup.sides[0].strategy].name} vs {STRATEGY_INFO[setup.sides[1].strategy].name} · seed{" "}
            <span className="font-mono text-foreground">{run.seed}</span>
            {run.status === "cancelled" && " · cancelled"}
          </p>
        </div>
        <OutcomeBar totals={t} labels={labels} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label={`${labels[0]} wins`} value={n ? pct(ciA.p) : "—"} ci={n ? ciText(ciA) : undefined} color={SIDE_COLOR[0]} testId="lab-win-a" />
          <Tile label="Draws" value={n ? pct(ciD.p) : "—"} ci={n ? (t.draws ? `${ciText(ciD)}${t.capped ? ` · ${count(t.capped)} at the ${count(TURN_LIMIT)}-turn limit` : ""}` : "None") : undefined} color={DRAW_COLOR} />
          <Tile label={`${labels[1]} wins`} value={n ? pct(ciB.p) : "—"} ci={n ? ciText(ciB) : undefined} color={SIDE_COLOR[1]} testId="lab-win-b" />
        </div>
        <p className="text-sm text-muted-foreground">
          Battles last <strong className="text-foreground">{n ? meanTurns(t).toFixed(1) : "—"}</strong> turns on average (median{" "}
          <strong className="text-foreground">{n ? medianTurns(t) : "—"}</strong>). The 95% confidence interval is a Wilson score interval: with more battles it narrows.
        </p>
        {!running && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onRerun(run.seed)}>
              <RotateCcw className="h-4 w-4" aria-hidden /> Run again with seed <span className="font-mono normal-case tracking-normal">{run.seed}</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                if (await onCopyLink()) {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                }
              }}
            >
              {copied ? <Check className="h-4 w-4 text-success" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? "Link copied" : "Copy link to this result"}
            </Button>
          </div>
        )}
        {(run.notes.length > 0 || run.misses.length > 0 || t.refused > 0 || t.broken > 0) && (
          <ul className="space-y-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            {[...run.notes, ...run.misses, ...(t.refused ? [`The simulator refused ${count(t.refused)} choices (a legal one was played instead).`] : []), ...(t.broken ? [`${count(t.broken)} battles couldn't finish and count as draws.`] : [])].map((note) => (
              <li key={note} className="flex gap-2">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden /> {note}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CardSection title="Converging" aside={`${labels[0]}'s win rate as battles came in`}>
          <ConvergenceChart history={run.history} total={run.status === "cancelled" ? Math.max(1, progress.done) : run.total} label={labels[0]} />
        </CardSection>
        <CardSection title="Turns to finish" aside={n ? `median ${medianTurns(t)}` : undefined}>
          <Legend
            items={[
              { label: sideNames[0], color: SIDE_COLOR[0] },
              { label: sideNames[1], color: SIDE_COLOR[1] },
              ...(t.draws ? [{ label: "Draws", color: DRAW_COLOR }] : []),
            ]}
          />
          <StackedColumns
            bins={bins}
            series={[
              { label: sideNames[0], color: SIDE_COLOR[0] },
              { label: sideNames[1], color: SIDE_COLOR[1] },
              { label: "Draws", color: DRAW_COLOR },
            ]}
            caption="Battles by the turn they ended on"
          />
        </CardSection>
      </div>

      {oneVsOne && (
        <CardSection title="HP left when it wins" aside="the winner's HP at the end">
          <div className="grid gap-4 sm:grid-cols-2">
            {([0, 1] as const).map((s) => {
              const wins = t.wins[s];
              const buckets = t.winnerHp[s];
              return (
                <div key={s} className="min-w-0 space-y-1">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <Swatch color={SIDE_COLOR[s]} /> {labels[s]}
                    <span className="font-normal text-muted-foreground">· {count(wins)} wins</span>
                  </p>
                  {wins ? (
                    <StackedColumns
                      height={140}
                      bins={buckets.map((v, i) => ({ label: `${i * 10}`, title: `${i * 10}–${i === 9 ? 100 : i * 10 + 9}% HP left`, values: [v / wins] }))}
                      series={[{ label: "Share of its wins", color: SIDE_COLOR[s] }]}
                      caption={`${labels[s]}'s HP left when it wins`}
                      format={(v) => pct(v)}
                      axisFormat={(v) => `${Math.round(v * 1000) / 10}%`}
                    />
                  ) : (
                    <p className="py-8 text-center text-sm text-muted-foreground">No wins.</p>
                  )}
                </div>
              );
            })}
          </div>
        </CardSection>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <CardSection title="Who scores the KOs" aside="KOs per battle">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {([0, 1] as const).map((s) => {
              const mons = setup.sides[s].team;
              const kos = t.kos[s];
              const total = kos.reduce((a, b) => a + b, 0) + t.otherKos[s];
              const rows = [
                ...mons.map((m, i) => ({ key: String(i), name: m.set.name || m.set.species, species: m.set.species, shiny: m.set.shiny, value: kos[i] ?? 0 })),
                { key: "other", name: "Indirect", species: "", shiny: false, value: t.otherKos[s] },
              ];
              return (
                <div key={s} className="min-w-0 space-y-1.5">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <Swatch color={SIDE_COLOR[s]} /> {labels[s]}
                  </p>
                  <table className="w-full text-sm">
                    <caption className="sr-only">KOs scored by {labels[s]}&apos;s Pokémon</caption>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.key} className="border-t border-foreground/[0.06]">
                          <td className="py-1 pr-2">
                            <span className="flex min-w-0 items-center gap-1.5">
                              {r.species ? <BattleSprite species={sprite?.(r.species)} shiny={r.shiny} animated={false} size={28} /> : <span className="w-7" />}
                              <span className={cn("truncate", !r.species && "text-muted-foreground")} title={r.species ? undefined : "Status, weather, hazards, recoil and self-KOs"}>
                                {r.name}
                              </span>
                            </span>
                          </td>
                          <td className="w-20 py-1">
                            <Share value={total ? r.value / total : 0} color={SIDE_COLOR[s]} />
                          </td>
                          <td className="w-12 py-1 text-right font-mono tabular-nums">{n ? (r.value / n).toFixed(2) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">Indirect: the foe fainted to status, weather, hazards, recoil or its own move (Explosion, Life Orb…).</p>
        </CardSection>

        <CardSection title="Crits and misses" aside="how often luck was in it">
          <table className="w-full text-sm">
            <caption className="sr-only">How often a critical hit or a miss was part of the result</caption>
            <thead>
              <tr className="hud-label text-left">
                <th scope="col" className="py-1 font-normal" />
                {([0, 1] as const).map((s) => (
                  <th key={s} scope="col" className="py-1 text-right font-normal">
                    <span className="inline-flex items-center gap-1.5">
                      <Swatch color={SIDE_COLOR[s]} /> {labels[s]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-foreground/[0.06]">
                <th scope="row" className="py-1.5 pr-2 text-left font-normal text-muted-foreground">
                  Wins with a KO from a critical hit
                </th>
                {([0, 1] as const).map((s) => (
                  <td key={s} className="py-1.5 text-right font-mono tabular-nums">
                    {t.wins[s] ? pct(t.critWins[s] / t.wins[s]) : "—"}
                    <span className="block text-[10px] text-muted-foreground">of {count(t.wins[s])} wins</span>
                  </td>
                ))}
              </tr>
              <tr className="border-t border-foreground/[0.06]">
                <th scope="row" className="py-1.5 pr-2 text-left font-normal text-muted-foreground">
                  Losses after missing a move
                </th>
                {([0, 1] as const).map((s) => (
                  <td key={s} className="py-1.5 text-right font-mono tabular-nums">
                    {t.wins[1 - s] ? pct(t.missLosses[s] / t.wins[1 - s]) : "—"}
                    <span className="block text-[10px] text-muted-foreground">of {count(t.wins[1 - s])} losses</span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">
            A win &quot;came down to a crit&quot; when a critical hit scored one of its KOs; a loss &quot;came down to a miss&quot; when the loser missed at least once.
            Both are upper bounds on luck: the crit or the miss may not have changed the result.
          </p>
        </CardSection>
      </div>

      <CardSection title="Most-used moves" aside="uses per battle">
        <div className="grid gap-4 sm:grid-cols-2">
          {([0, 1] as const).map((s) => {
            const moves = topMoves(t, s, 8);
            return (
              <div key={s} className="min-w-0 space-y-1.5">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <Swatch color={SIDE_COLOR[s]} /> {labels[s]}
                </p>
                {moves.length ? (
                  <table className="w-full text-sm">
                    <caption className="sr-only">{labels[s]}&apos;s most-used moves</caption>
                    <tbody>
                      {moves.map((m) => (
                        <tr key={m.move} className="border-t border-foreground/[0.06]">
                          <td className="truncate py-1 pr-2">{m.move}</td>
                          <td className="w-24 py-1">
                            <Share value={m.share} color={SIDE_COLOR[s]} />
                          </td>
                          <td className="w-12 py-1 text-right font-mono tabular-nums">{m.perBattle.toFixed(2)}</td>
                          <td className="w-12 py-1 text-right font-mono text-xs tabular-nums text-muted-foreground">{pct(m.share, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-sm text-muted-foreground">None yet.</p>
                )}
              </div>
            );
          })}
        </div>
      </CardSection>

      {!running && n > 0 && (
        <CardSection title="Watch a sample battle" aside="any battle of the run, replayed exactly">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => watch(1)} disabled={!t.wins[0] || replay?.state === "loading"}>
              <Clapperboard className="h-4 w-4" aria-hidden /> A {labels[0]} win
            </Button>
            <Button size="sm" variant="outline" onClick={() => watch(2)} disabled={!t.wins[1] || replay?.state === "loading"}>
              <Clapperboard className="h-4 w-4" aria-hidden /> A {labels[1]} win
            </Button>
            {t.draws > 0 && (
              <Button size="sm" variant="outline" onClick={() => watch(3)} disabled={replay?.state === "loading"}>
                <Clapperboard className="h-4 w-4" aria-hidden /> A draw
              </Button>
            )}
          </div>
          {replay?.state === "loading" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Playing it again…
            </p>
          )}
          {replay?.state === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {replay.message}
            </p>
          )}
          {replay?.state === "ready" && <SampleReplay replay={replay.data} labels={labels} seed={run.seed} onClose={() => setReplay(null)} />}
        </CardSection>
      )}
    </div>
  );
}
