"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Check, Clapperboard, Copy, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import battleLab from "@/messages/battle-lab";
import type { LabReplay } from "@/lib/battle/lab/pool";
import { margin, meanTurns, medianTurns, topMoves, wilson } from "@/lib/battle/lab/stats";
import { TURN_LIMIT } from "@/lib/battle/lab/types";
import { labMessage, labNumbers, labSummary } from "@/lib/battle/lab/words";
import { cn } from "@/lib/utils";
import type { SpriteSpecies } from "@/lib/battle/sprites";
import { BattleSprite } from "../BattleSprite";
import { useBattleNames } from "../use-battle-names";
import { CardSection, DRAW_COLOR, SIDE_COLOR, Swatch } from "./charts";
import { ConvergenceChart, Legend, OutcomeBar, StackedColumns, turnBins } from "./lab-charts";
import type { LabRun } from "./use-lab-run";

const SampleReplay = dynamic(() => import("./SampleReplay"), {
  ssr: false,
  loading: () => <ReplayLoading />,
});

function ReplayLoading() {
  const t = useT(battleLab);
  return (
    <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> {t("results.loadingReplay")}
    </p>
  );
}

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
  const tr = useT(battleLab);
  const names = useBattleNames();
  const num = labNumbers(tr.locale);
  const t = progress.totals;
  const n = t.battles;
  const running = run.status === "running";
  const ciA = wilson(t.wins[0], n);
  const ciB = wilson(t.wins[1], n);
  const ciD = wilson(t.draws, n);
  const oneVsOne = !setup.doubles && setup.sides[0].team.length === 1 && setup.sides[1].team.length === 1;
  const [copied, setCopied] = useState(false);
  const [replay, setReplay] = useState<{ state: "loading" } | { state: "ready"; data: LabReplay } | { state: "error"; message: string } | null>(null);

  const ciText = (ci: ReturnType<typeof wilson>) => tr("results.ci", { m: num.pct(margin(ci)), lo: num.pct(ci.lo), hi: num.pct(ci.hi) });

  async function watch(outcome: 1 | 2 | 3) {
    const indices: number[] = [];
    progress.outcomes.forEach((o, i) => o === outcome && indices.push(i));
    if (!indices.length) return;
    const index = indices[Math.floor(Math.random() * indices.length)];
    setReplay({ state: "loading" });
    try {
      setReplay({ state: "ready", data: await replayBattle(index) });
    } catch (err) {
      setReplay({ state: "error", message: labMessage(err instanceof Error ? err.message : "Couldn't replay that battle.", names, tr) });
    }
  }

  const bins = turnBins(t, tr);
  const sideNames = [tr("results.wins", { side: labels[0] }), tr("results.wins", { side: labels[1] })];

  return (
    <div className="space-y-4" aria-busy={running}>
      {/* The answer */}
      <div className="hud space-y-4 rounded-lg border bg-card p-4 sm:p-5">
        <div className="space-y-1">
          <p className="font-display text-xl font-bold leading-snug sm:text-2xl" data-testid="lab-summary" aria-live={running ? "off" : "polite"}>
            {n ? labSummary(t, labels, num, tr) : tr("results.starting")}
          </p>
          <p className="hud-label normal-case tracking-wider">
            {tr.rich("results.meta", {
              gen: setup.gen,
              doubles: setup.doubles,
              a: tr(`strategy.${setup.sides[0].strategy}.name`),
              b: tr(`strategy.${setup.sides[1].strategy}.name`),
              seed: run.seed,
              n,
              cancelled: run.status === "cancelled",
              mono: (chunks) => <span className="font-mono text-foreground">{chunks}</span>,
              size: (chunks) => (
                <span className="text-foreground" data-testid="lab-sample-size">
                  {chunks}
                </span>
              ),
            })}
          </p>
        </div>
        <OutcomeBar totals={t} labels={labels} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label={tr("results.wins", { side: labels[0] })} value={n ? num.pct(ciA.p) : "—"} ci={n ? ciText(ciA) : undefined} color={SIDE_COLOR[0]} testId="lab-win-a" />
          <Tile
            label={tr("results.draws")}
            value={n ? num.pct(ciD.p) : "—"}
            ci={n ? (t.draws ? `${ciText(ciD)}${t.capped ? tr("results.capped", { n: num.count(t.capped), limit: num.count(TURN_LIMIT) }) : ""}` : tr("results.noDraws")) : undefined}
            color={DRAW_COLOR}
          />
          <Tile label={tr("results.wins", { side: labels[1] })} value={n ? num.pct(ciB.p) : "—"} ci={n ? ciText(ciB) : undefined} color={SIDE_COLOR[1]} testId="lab-win-b" />
        </div>
        <p className="text-sm text-muted-foreground">
          {tr.rich("results.length", {
            mean: n ? num.fixed(meanTurns(t), 1) : "—",
            median: n ? (tr.locale === "en" ? medianTurns(t) : num.count(medianTurns(t))) : "—",
            b: (chunks) => <strong className="text-foreground">{chunks}</strong>,
          })}
        </p>
        {!running && n > 0 && margin(ciA) > 0.05 && (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm" data-testid="lab-small-sample">
            {tr("results.small", { n, m: num.pct(margin(ciA)) })}
          </p>
        )}
        {!running && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onRerun(run.seed)}>
              <RotateCcw className="h-4 w-4" aria-hidden />{" "}
              {tr.rich("results.again", { seed: run.seed, mono: (chunks) => <span className="font-mono normal-case tracking-normal">{chunks}</span> })}
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
              {copied ? <Check className="h-4 w-4 text-success" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? tr("results.linkCopied") : tr("results.copyLink")}
            </Button>
          </div>
        )}
        {(run.notes.length > 0 || run.misses.length > 0 || t.refused > 0 || t.broken > 0) && (
          <ul className="space-y-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            {[
              ...run.notes.map((note) => labMessage(note, names, tr)),
              ...run.misses.map((miss) => labMessage(miss, names, tr)),
              ...(t.refused ? [tr("results.refused", { num: t.refused, n: num.count(t.refused) })] : []),
              ...(t.broken ? [tr("results.broken", { num: t.broken, n: num.count(t.broken) })] : []),
            ].map((note) => (
              <li key={note} className="flex gap-2">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden /> {note}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CardSection title={tr("results.converging")} aside={tr("results.rateAside", { side: labels[0] })}>
          <ConvergenceChart history={run.history} total={run.status === "cancelled" ? Math.max(1, progress.done) : run.total} label={labels[0]} />
        </CardSection>
        <CardSection title={tr("results.turnsTitle")} aside={n ? tr("results.median", { m: tr.locale === "en" ? medianTurns(t) : num.count(medianTurns(t)) }) : undefined}>
          <Legend
            items={[
              { label: sideNames[0], color: SIDE_COLOR[0] },
              { label: sideNames[1], color: SIDE_COLOR[1] },
              ...(t.draws ? [{ label: tr("results.draws"), color: DRAW_COLOR }] : []),
            ]}
          />
          <StackedColumns
            bins={bins}
            series={[
              { label: sideNames[0], color: SIDE_COLOR[0] },
              { label: sideNames[1], color: SIDE_COLOR[1] },
              { label: tr("results.draws"), color: DRAW_COLOR },
            ]}
            caption={tr("results.byTurn")}
          />
        </CardSection>
      </div>

      {oneVsOne && (
        <CardSection title={tr("results.hpTitle")} aside={tr("results.hpAside")}>
          <div className="grid gap-4 sm:grid-cols-2">
            {([0, 1] as const).map((s) => {
              const wins = t.wins[s];
              const buckets = t.winnerHp[s];
              return (
                <div key={s} className="min-w-0 space-y-1">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <Swatch color={SIDE_COLOR[s]} /> {labels[s]}
                    <span className="font-normal text-muted-foreground">{tr("results.nWins", { num: wins, n: num.count(wins) })}</span>
                  </p>
                  {wins ? (
                    <StackedColumns
                      height={140}
                      bins={buckets.map((v, i) => ({ label: `${i * 10}`, title: tr("results.hpBin", { lo: i * 10, hi: i === 9 ? 100 : i * 10 + 9 }), values: [v / wins] }))}
                      series={[{ label: tr("results.hpShare"), color: SIDE_COLOR[s] }]}
                      caption={tr("results.hpCaption", { side: labels[s] })}
                      format={(v: number) => num.pct(v)}
                      axisFormat={(v: number) => (tr.locale === "en" ? `${Math.round(v * 1000) / 10}%` : num.pct(Math.round(v * 1000) / 1000, Number.isInteger(Math.round(v * 1000) / 10) ? 0 : 1))}
                    />
                  ) : (
                    <p className="py-8 text-center text-sm text-muted-foreground">{tr("results.noWins")}</p>
                  )}
                </div>
              );
            })}
          </div>
        </CardSection>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <CardSection title={tr("results.kosTitle")} aside={tr("results.kosAside")}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {([0, 1] as const).map((s) => {
              const mons = setup.sides[s].team;
              const kos = t.kos[s];
              const total = kos.reduce((a, b) => a + b, 0) + t.otherKos[s];
              const rows = [
                ...mons.map((m, i) => ({ key: String(i), name: m.set.name || names.species(m.set.species), species: m.set.species, shiny: m.set.shiny, value: kos[i] ?? 0 })),
                { key: "other", name: tr("results.indirect"), species: "", shiny: false, value: t.otherKos[s] },
              ];
              return (
                <div key={s} className="min-w-0 space-y-1.5">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <Swatch color={SIDE_COLOR[s]} /> {labels[s]}
                  </p>
                  <table className="w-full text-sm">
                    <caption className="sr-only">{tr("results.kosCaption", { side: labels[s] })}</caption>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.key} className="border-t border-foreground/[0.06]">
                          <td className="py-1 pr-2">
                            <span className="flex min-w-0 items-center gap-1.5">
                              {r.species ? <BattleSprite species={sprite?.(r.species)} shiny={r.shiny} animated={false} size={28} /> : <span className="w-7" />}
                              <span className={cn("truncate", !r.species && "text-muted-foreground")} title={r.species ? undefined : tr("results.indirectTitle")}>
                                {r.name}
                              </span>
                            </span>
                          </td>
                          <td className="w-20 py-1">
                            <Share value={total ? r.value / total : 0} color={SIDE_COLOR[s]} />
                          </td>
                          <td className="w-12 py-1 text-right font-mono tabular-nums">{n ? num.fixed(r.value / n, 2) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">{tr("results.indirectNote")}</p>
        </CardSection>

        <CardSection title={tr("results.luckTitle")} aside={tr("results.luckAside")}>
          <table className="w-full text-sm">
            <caption className="sr-only">{tr("results.luckCaption")}</caption>
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
                  {tr("results.critWins")}
                </th>
                {([0, 1] as const).map((s) => (
                  <td key={s} className="py-1.5 text-right font-mono tabular-nums">
                    {t.wins[s] ? num.pct(t.critWins[s] / t.wins[s]) : "—"}
                    <span className="block text-[10px] text-muted-foreground">{tr("results.ofWins", { num: t.wins[s], n: num.count(t.wins[s]) })}</span>
                  </td>
                ))}
              </tr>
              <tr className="border-t border-foreground/[0.06]">
                <th scope="row" className="py-1.5 pr-2 text-left font-normal text-muted-foreground">
                  {tr("results.missLosses")}
                </th>
                {([0, 1] as const).map((s) => (
                  <td key={s} className="py-1.5 text-right font-mono tabular-nums">
                    {t.wins[1 - s] ? num.pct(t.missLosses[s] / t.wins[1 - s]) : "—"}
                    <span className="block text-[10px] text-muted-foreground">{tr("results.ofLosses", { num: t.wins[1 - s], n: num.count(t.wins[1 - s]) })}</span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">{tr("results.luckNote")}</p>
        </CardSection>
      </div>

      <CardSection title={tr("results.movesTitle")} aside={tr("results.movesAside")}>
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
                    <caption className="sr-only">{tr("results.movesCaption", { side: labels[s] })}</caption>
                    <tbody>
                      {moves.map((m) => (
                        <tr key={m.move} className="border-t border-foreground/[0.06]">
                          <td className="truncate py-1 pr-2">{names.move(m.move)}</td>
                          <td className="w-24 py-1">
                            <Share value={m.share} color={SIDE_COLOR[s]} />
                          </td>
                          <td className="w-12 py-1 text-right font-mono tabular-nums">{num.fixed(m.perBattle, 2)}</td>
                          <td className="w-12 py-1 text-right font-mono text-xs tabular-nums text-muted-foreground">{num.pct(m.share, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-sm text-muted-foreground">{tr("results.noneYet")}</p>
                )}
              </div>
            );
          })}
        </div>
      </CardSection>

      {!running && n > 0 && (
        <CardSection title={tr("results.watchTitle")} aside={tr("results.watchAside")}>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => watch(1)} disabled={!t.wins[0] || replay?.state === "loading"}>
              <Clapperboard className="h-4 w-4" aria-hidden /> {tr("results.aWin", { side: labels[0] })}
            </Button>
            <Button size="sm" variant="outline" onClick={() => watch(2)} disabled={!t.wins[1] || replay?.state === "loading"}>
              <Clapperboard className="h-4 w-4" aria-hidden /> {tr("results.aWin", { side: labels[1] })}
            </Button>
            {t.draws > 0 && (
              <Button size="sm" variant="outline" onClick={() => watch(3)} disabled={replay?.state === "loading"}>
                <Clapperboard className="h-4 w-4" aria-hidden /> {tr("results.aDraw")}
              </Button>
            )}
          </div>
          {replay?.state === "loading" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> {tr("results.replaying")}
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
