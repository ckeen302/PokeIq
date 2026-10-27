"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Dices, Info, Skull, Swords, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyFallback } from "@/components/quiz/CopyFallback";
import { copyText } from "@/lib/share";
import { pct } from "@/lib/battle/analysis/maths";
import { luckVerdict, mvpOf, shareText, signed, workLine, workScore, type TurningPoint } from "@/lib/battle/analysis/stats-text";
import { INDIRECT_LABELS, STATS_VERSION, type BattleStats, type IndirectKind, type MonStats, type SideLuck, type StatsSide } from "@/lib/battle/analysis/stats-types";
import type { LuckTally } from "@/lib/battle/analysis/luck-math";
import type { ReplayData } from "@/lib/battle/replay";
import { cn } from "@/lib/utils";
import { BattleSprite } from "./BattleSprite";
import { CardSection, SIDE_COLOR } from "./lab/charts";

/**
 * A finished battle's stats under its analysis: the luck meter (crits,
 * misses, side effects and damage rolls against their odds), who did the
 * work (damage dealt and taken per Pokémon, KOs, healing, turns in
 * battle, the MVP), and a card to share. Worked out on the server from the
 * saved log, asked for only once this panel is near the screen.
 */

type Load = { status: "idle" | "loading" } | { status: "done"; stats: BattleStats } | { status: "error"; message: string };

const requests = new Map<string, Promise<BattleStats>>();

function fetchStats(id: string): Promise<BattleStats> {
  let p = requests.get(id);
  if (!p) {
    p = fetch(`/api/battle/analysis/stats/${id}?v=${STATS_VERSION}`).then(async (res) => {
      const body = (await res.json().catch(() => ({}))) as { stats?: BattleStats; error?: string };
      if (!res.ok || !body.stats) throw new Error(body.error ?? "Couldn't load this battle's stats.");
      return body.stats;
    });
    requests.set(id, p);
    p.catch(() => requests.delete(id));
  }
  return p;
}

/** The battle's stats, fetched once `ref`'s element comes near the screen. */
export function useBattleStats(id: string, ref: React.RefObject<HTMLElement | null>): Load {
  const [load, setLoad] = useState<Load>({ status: "idle" });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const start = () => {
      setLoad({ status: "loading" });
      fetchStats(id).then(
        (stats) => !cancelled && setLoad({ status: "done", stats }),
        (err: Error) => !cancelled && setLoad({ status: "error", message: err.message })
      );
    };
    if (typeof IntersectionObserver === "undefined") {
      start();
      return () => void (cancelled = true);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          start();
        }
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [id, ref]);
  return load;
}

const foeOf = (s: StatsSide): StatsSide => (s === 0 ? 1 : 0);
const num = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-US");

export function BattleStatsPanel({ load, viewer, replay, turning }: { load: Load; viewer: StatsSide; replay: ReplayData; turning: TurningPoint[] }) {
  return (
    <CardSection title="Battle stats" aside="From the battle log">
      <div data-testid="battle-stats" className="space-y-5">
        {load.status === "done" ? (
          <>
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <LuckMeter stats={load.stats} viewer={viewer} />
              <ShareCard stats={load.stats} viewer={viewer} replay={replay} turning={turning} />
            </div>
            <WhoDidTheWork stats={load.stats} viewer={viewer} />
          </>
        ) : load.status === "error" ? (
          <p className="text-sm text-destructive" role="alert">
            {load.message}
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2" aria-busy="true" aria-label="Loading the battle's stats">
            {[0, 1].map((i) => (
              <div key={i} className="h-44 animate-pulse rounded-md border bg-shade/20" />
            ))}
          </div>
        )}
      </div>
    </CardSection>
  );
}

// ---------------------------------------------------------------------------
// Turning points (shown with the win chance, once the analysis has run)
// ---------------------------------------------------------------------------

export function TurningPoints({ points }: { points: TurningPoint[] }) {
  return (
    <div className="space-y-2">
      <h4 className="hud-label">Turning points</h4>
      {points.length ? (
        <ol className="grid gap-2 md:grid-cols-3" data-testid="turning-points">
          {points.map((t) => {
            const up = t.delta >= 0;
            return (
              <li key={t.turn} className={cn("flex gap-3 rounded-md border px-3 py-2.5 text-sm", up ? "border-success/35 bg-success/5" : "border-destructive/35 bg-destructive/5")}>
                <span className={cn("flex shrink-0 flex-col items-center gap-0.5 pt-0.5 font-mono text-xs font-bold tabular-nums", up ? "text-success" : "text-destructive")}>
                  {up ? <TrendingUp className="h-4 w-4" aria-hidden /> : <TrendingDown className="h-4 w-4" aria-hidden />}
                  {up ? "+" : "−"}
                  {Math.round(Math.abs(t.delta) * 100)}
                </span>
                <span className="min-w-0">{t.text}</span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="turning-points">
          No single turn moved the win chance by more than the simulations&apos; margin of error: this one was decided bit by bit.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Luck
// ---------------------------------------------------------------------------

function LuckMeter({ stats, viewer }: { stats: BattleStats; viewer: StatsSide }) {
  const l = stats.luck[viewer];
  const verdict = luckVerdict(l);
  const name = stats.players[viewer];
  const range = Math.max(3, Math.ceil(Math.abs(l.score) + 0.5), Math.ceil(l.sd * 2));
  const at = (x: number) => `${50 + (Math.max(-range, Math.min(range, x)) / range) * 50}%`;
  const tone = verdict.tone === "good" ? "text-success" : verdict.tone === "bad" ? "text-destructive" : "text-foreground";
  const [open, setOpen] = useState(false);
  const events = stats.luckEvents;
  const shown = open ? events : events.slice(0, 4);
  return (
    <section className="space-y-3 rounded-md border bg-shade/10 p-3" data-testid="luck-meter" aria-label="Luck meter">
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <div>
          <p className="hud-label flex items-center gap-1.5">
            <Dices className="h-3.5 w-3.5" aria-hidden /> Luck meter · {name}
          </p>
          <p className={cn("mt-1 font-display text-3xl font-bold tabular-nums", tone)} data-testid="luck-score">
            {signed(l.score)}
          </p>
        </div>
        <p className={cn("text-sm font-semibold", tone)}>{verdict.label}</p>
      </div>

      <div className="space-y-1">
        <div className="relative h-3 rounded-full bg-gradient-to-r from-destructive/30 via-shade/30 to-success/30" role="img" aria-label={`Luck ${signed(l.score)}, where luck alone usually lands within ±${num(l.sd)}`}>
          <div className="absolute inset-y-0 rounded-full border border-foreground/20 bg-foreground/10" style={{ left: at(-l.sd), right: `calc(100% - ${at(l.sd)})` }} />
          <div className="absolute inset-y-[-3px] w-px bg-foreground/40" style={{ left: "50%" }} />
          <div className={cn("absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card shadow", verdict.tone === "good" ? "bg-success" : verdict.tone === "bad" ? "bg-destructive" : "bg-foreground")} style={{ left: at(l.score) }} />
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>Unlucky</span>
          <span>Usual range ±{num(l.sd)}</span>
          <span>Lucky</span>
        </div>
      </div>

      <LuckTable luck={l} />

      {events.length > 0 && (
        <div className="space-y-1.5">
          <p className="hud-label">The dice, turn by turn</p>
          <ul className="space-y-1 text-sm" data-testid="luck-events">
            {shown.map((e, i) => {
              const good = e.side === viewer;
              return (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="w-12 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">T{e.turn}</span>
                  <span className={cn("h-2 w-2 shrink-0 translate-y-[-1px] rounded-full", good ? "bg-success" : "bg-destructive")} aria-label={good ? "in your favour" : "against you"} />
                  <span className="min-w-0 flex-1">{e.text}</span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{pct(e.chance)}</span>
                </li>
              );
            })}
          </ul>
          {events.length > 4 && (
            <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline" aria-expanded={open}>
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
              {open ? "Show fewer" : `Show all ${events.length}`}
            </button>
          )}
        </div>
      )}

      <details className="group rounded-md border border-foreground/10 p-2.5 text-xs text-muted-foreground" data-testid="luck-explained">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold text-foreground">
          <Info className="h-3.5 w-3.5" aria-hidden /> How luck is worked out
          <ChevronDown className="ml-auto h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="mt-2 space-y-1.5">
          <p>
            Every crit, miss and side effect (burn, paralysis, freeze, poison, sleep, confusion, flinch, stat changes) is counted against the odds it had when it happened, from the move&apos;s
            accuracy, crit rate and effect chance with the stat stages, weather and the items and abilities the battle had shown. Each one that came off above its odds is +1 for the side it
            helped; one expected but not seen is the same in reverse. A damage roll counts up to ±0.5 (a top roll +0.5, an average one 0).
          </p>
          <p>
            The expected numbers are <strong>estimates</strong>: an item or ability nobody saw (Scope Lens, Serene Grace, BrightPowder…) comes from the most likely set, and damage rolls are
            placed with the damage calc on assumed sets, only where the HP bar can tell ({stats.rolls.placed} of {stats.rolls.placed + stats.rolls.unplaced} plain hits). The usual range is how
            far luck alone strays in a battle with this many chances (one standard deviation).
          </p>
        </div>
      </details>
    </section>
  );
}

function LuckTable({ luck: l }: { luck: SideLuck }) {
  const row = (label: string, t: LuckTally, goodWhenMore: boolean) => {
    const net = (t.observed - t.expected) * (goodWhenMore ? 1 : -1);
    return { label, observed: String(t.observed), expected: num(t.expected), net, chances: t.n };
  };
  const rollNet = l.rollsOwn.sum - l.rollsOwn.n / 2 - (l.rollsReceived.sum - l.rollsReceived.n / 2);
  const rows = [
    row("Crits you landed", l.critsLanded, true),
    row("Crits against you", l.critsReceived, false),
    row("Your misses", l.missesOwn, false),
    row("Their misses", l.missesFoe, true),
    row("Side effects you got", l.procsLanded, true),
    row("Side effects against you", l.procsReceived, false),
  ];
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-xs sm:text-sm" data-testid="luck-table">
        <thead className="bg-shade/20 text-left">
          <tr>
            <th className="px-2.5 py-1.5 font-normal">
              <span className="hud-label">Chance events</span>
            </th>
            <th className="px-2 py-1.5 text-right font-normal">
              <span className="hud-label">Seen</span>
            </th>
            <th className="px-2 py-1.5 text-right font-normal">
              <span className="hud-label">Expected</span>
            </th>
            <th className="px-2.5 py-1.5 text-right font-normal">
              <span className="hud-label">Luck</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="px-2.5 py-1.5">
                {r.label}
                <span className="ml-1 hidden text-[11px] text-muted-foreground sm:inline" title="Chances">({r.chances})</span>
              </td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{r.observed}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground">{r.expected}</td>
              <td className={cn("px-2.5 py-1.5 text-right font-mono font-semibold tabular-nums", tone(r.net))}>{signed(r.net)}</td>
            </tr>
          ))}
          <tr>
            <td className="px-2.5 py-1.5" colSpan={3}>
              Damage rolls
              <span className="ml-1 text-[11px] text-muted-foreground">
                (yours: {l.rollsOwn.high} high, {l.rollsOwn.low} low of {l.rollsOwn.n}; theirs: {l.rollsReceived.high} high, {l.rollsReceived.low} low of {l.rollsReceived.n})
              </span>
            </td>
            <td className={cn("px-2.5 py-1.5 text-right font-mono font-semibold tabular-nums", tone(rollNet))}>{signed(rollNet)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const tone = (n: number) => (Math.abs(n) < 0.05 ? "text-muted-foreground" : n > 0 ? "text-success" : "text-destructive");

// ---------------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------------

function ShareCard({ stats, viewer, replay, turning }: { stats: BattleStats; viewer: StatsSide; replay: ReplayData; turning: TurningPoint[] }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const [origin, setOrigin] = useState("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const biggest = turning.length ? turning.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a)) : null;
  const url = `${origin}/battle/replay/${replay.id}?analysis=1&side=${viewer}`;
  const full = shareText(stats, viewer, { formatName: replay.formatName, url, turning: biggest });
  // The card as it pastes, without the brand line (shown as the heading) and the link (said underneath).
  const body = full.split("\n").slice(1, -1).join("\n");
  async function copy() {
    const ok = await copyText(full);
    setState(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    if (ok) timer.current = window.setTimeout(() => setState("idle"), 2200);
  }
  return (
    <section className="flex flex-col gap-2 rounded-md border bg-shade/20 p-3" data-testid="stats-share-card" aria-label="Share card">
      <div className="flex items-center justify-between gap-3">
        <p className="hud-label">Your battle card</p>
        <Button size="sm" variant={state === "copied" ? "success" : "secondary"} onClick={() => void copy()} data-testid="stats-copy">
          {state === "copied" ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          {state === "copied" ? "Copied!" : "Copy"}
        </Button>
      </div>
      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed" data-testid="stats-share-preview">
        {body}
      </pre>
      <p className="truncate text-xs text-muted-foreground">+ a link to this analysis</p>
      {state === "failed" && <CopyFallback text={full} />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Who did the work
// ---------------------------------------------------------------------------

function WhoDidTheWork({ stats, viewer }: { stats: BattleStats; viewer: StatsSide }) {
  const most = Math.max(1, ...stats.mons.map(workScore));
  return (
    <section className="space-y-2" data-testid="damage-summary" aria-label="Who did the work">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="hud-label flex items-center gap-1.5">
          <Swords className="h-3.5 w-3.5" aria-hidden /> Who did the work
        </h4>
        <p className="text-[11px] text-muted-foreground">Damage as % of a Pokémon&apos;s max HP (100% = one whole Pokémon)</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {[viewer, foeOf(viewer)].map((side) => {
          const mons = stats.mons.filter((m) => m.side === side).sort((a, b) => workScore(b) - workScore(a));
          const mvp = mvpOf(stats.mons, side);
          const total = mons.reduce((a, m) => a + m.dealt + m.dealtIndirect, 0);
          return (
            <div key={side} className="min-w-0 rounded-md border" data-testid={`damage-side-${side}`}>
              <p className="flex items-center gap-2 border-b bg-shade/20 px-3 py-1.5 text-sm font-semibold">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: SIDE_COLOR[side === viewer ? 0 : 1] }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{stats.players[side]}</span>
                <span className="font-mono text-xs font-normal tabular-nums text-muted-foreground">{Math.round(total)}% dealt</span>
              </p>
              <ul className="divide-y">
                {mons.map((m) => (
                  <MonRow key={m.key} m={m} mvp={m === mvp} most={most} color={SIDE_COLOR[side === viewer ? 0 : 1]} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MonRow({ m, mvp, most, color }: { m: MonStats; mvp: boolean; most: number; color: string }) {
  const indirect = (Object.entries(m.takenIndirect) as [IndirectKind, number][]).filter(([, v]) => v >= 0.5);
  const lostIndirect = indirect.reduce((a, [, v]) => a + v, 0);
  const hp = (p: number) => (m.maxHp && p >= 0.5 ? ` (≈${Math.round((p * m.maxHp) / 100)} HP)` : "");
  return (
    <li className={cn("flex items-center gap-2.5 px-2.5 py-2", mvp && "bg-warning/10")} data-testid={mvp ? "mvp" : undefined}>
      <BattleSprite species={m.sprite} size={40} animated={false} className={cn("shrink-0", m.fainted && "opacity-50 grayscale")} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate font-semibold">{m.species}</span>
          {mvp && (
            <span className="inline-flex items-center gap-1 rounded bg-warning/20 px-1.5 py-0.5 font-pixel text-[9px] uppercase text-warning">
              <Trophy className="h-3 w-3" aria-hidden /> MVP
            </span>
          )}
          {m.fainted && <Skull className="h-3.5 w-3.5 text-muted-foreground" aria-label="Fainted" />}
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-shade/40" aria-hidden>
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, (workScore(m) / most) * 100)}%`, background: color }} />
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {m.kos ? `${m.kos} KO${m.kos === 1 ? "" : "s"} · ` : ""}
          took {Math.round(m.taken + lostIndirect)}%{hp(m.taken + lostIndirect)}
          {indirect.length ? ` (${indirect.map(([k, v]) => `${Math.round(v)}% ${INDIRECT_LABELS[k].toLowerCase()}`).join(", ")})` : ""}
          {m.healed >= 0.5 ? ` · healed ${Math.round(m.healed)}%` : ""} · {m.turns} turn{m.turns === 1 ? "" : "s"}
        </p>
      </div>
      <div className="w-16 shrink-0 text-right">
        <p className="font-display text-lg font-bold leading-none tabular-nums">{Math.round(m.dealt + m.dealtIndirect)}%</p>
        <p className="mt-1 text-[10px] leading-tight text-muted-foreground" title={workLine(m)}>
          {m.dealtIndirect >= 0.5 ? `${Math.round(m.dealtIndirect)}% indirect` : m.dealtHp ? `≈${m.dealtHp} HP` : "dealt"}
        </p>
      </div>
    </li>
  );
}
