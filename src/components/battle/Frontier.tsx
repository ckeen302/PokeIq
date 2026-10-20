"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Crown, Flag, Loader2, Repeat, Swords, Trophy } from "lucide-react";
import {
  FRONTIER_INFO,
  FRONTIER_ROUND,
  frontierKey,
  localBests,
  rememberBest,
  saveRun,
  savedRun,
  type FactoryStyle,
  type FrontierKey,
  type FrontierMode,
  type FrontierMon,
  type FrontierRunView,
} from "@/lib/battle/frontier";
import { CPU_LEVEL_INFO, type BattleView } from "@/lib/battle/play";
import { loadBattleSeat, saveBattleSeat } from "@/lib/battle/seat";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { setTrainerName, useProgress } from "@/lib/progress";
import { unlockAudio } from "@/lib/sound";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BattleSprite } from "@/components/battle/BattleSprite";
import { cn } from "@/lib/utils";
import { useSpriteLookup } from "./hooks";

/**
 * The Battle Frontier's pages: a run's hub (rent or bring a team, the streak,
 * the Factory's trade after a win, the next battle) and what a run's battle
 * shows once it's over. The run itself is a token the server signs; this
 * device keeps it between battles, with the best streaks.
 */

async function frontier<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/battle/frontier", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

/** Best streaks: this device's, and the account's when signed in. */
function useBests(): Partial<Record<FrontierKey, number>> {
  const [bests, setBests] = useState<Partial<Record<FrontierKey, number>>>({});
  useEffect(() => {
    const local = localBests();
    setBests(local);
    frontier<{ bests: Partial<Record<FrontierKey, number>> | null }>({ action: "bests" })
      .then(({ bests: server }) => {
        if (!server) return;
        const merged = { ...local };
        for (const [k, v] of Object.entries(server) as [FrontierKey, number][]) merged[k] = Math.max(merged[k] ?? 0, v);
        setBests(merged);
      })
      .catch(() => undefined);
  }, []);
  return bests;
}

function MonCard({ mon, sprite, picked, onPick, testid }: { mon: FrontierMon; sprite: ReturnType<typeof useSpriteLookup>; picked?: boolean; onPick?: () => void; testid?: string }) {
  const body = (
    <>
      <BattleSprite species={sprite?.(mon.species)} animated={false} size={48} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-sm font-bold uppercase">{mon.species}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {mon.item || "No item"} · {mon.ability}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{mon.moves.join(" / ")}</span>
      </span>
    </>
  );
  const cls = cn("flex w-full items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-left", picked && "border-primary ring-1 ring-primary");
  return onPick ? (
    <button type="button" className={cn(cls, "hover:border-screen/60")} onClick={onPick} aria-pressed={picked} data-testid={testid}>
      {body}
    </button>
  ) : (
    <div className={cls} data-testid={testid}>
      {body}
    </div>
  );
}

function StreakBar({ run, best }: { run: FrontierRunView; best: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2" data-testid="frontier-streak">
      <span className="flex items-baseline gap-2">
        <span className="hud-label">Streak</span>
        <span className="font-pixel text-2xl tabular-nums text-primary">{run.streak}</span>
      </span>
      <span className="flex items-baseline gap-2">
        <span className="hud-label">Best</span>
        <span className="font-pixel text-lg tabular-nums">{Math.max(best, run.streak)}</span>
      </span>
      {!run.over && (
        <span className="flex items-center gap-1.5" aria-label={`Round ${run.next.round}, battle ${run.next.battle} of ${FRONTIER_ROUND}`}>
          <span className="hud-label">Round {run.next.round}</span>
          {Array.from({ length: FRONTIER_ROUND }, (_, i) => (
            <span
              key={i}
              className={cn("h-2.5 w-2.5 rounded-full border", i < run.next.battle - 1 ? "border-success bg-success" : i === run.next.battle - 1 ? "border-primary bg-primary/40" : "border-foreground/20")}
            />
          ))}
        </span>
      )}
      {run.tier && <span className="hud-label text-screen">Tier: {run.tier}</span>}
    </div>
  );
}

/** A Frontier facility's page: the run in progress, or a new one. */
export function FrontierHub({ mode, startPanel }: { mode: FrontierMode; startPanel?: (props: { name: string; onRun: (run: FrontierRunView) => void }) => React.ReactNode }) {
  const router = useRouter();
  const progress = useProgress();
  const sprite = useSpriteLookup();
  const bests = useBests();
  const [style, setStyle] = useState<FactoryStyle>("open");
  const key = frontierKey(mode, style);
  const [run, setRun] = useState<FrontierRunView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [give, setGive] = useState<number | null>(null);
  const [take, setTake] = useState<number | null>(null);

  useEffect(() => {
    setRun(savedRun(key));
    setLoaded(true);
    setGive(null);
    setTake(null);
  }, [key]);
  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

  const keep = useCallback((next: FrontierRunView | null) => {
    setRun(next);
    saveRun(next, next?.key);
    setGive(null);
    setTake(null);
  }, []);

  async function call<T>(body: Record<string, unknown>, then: (data: T) => void) {
    setBusy(true);
    setError(null);
    try {
      then(await frontier<T>(body));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const start = () => {
    if (!isCleanName(name)) return setError(NAME_REJECTED);
    if (!progress?.name) setTrainerName(name.trim());
    void call<{ run: FrontierRunView }>({ action: "start", mode, style, name: name.trim() }, (d) => keep(d.run));
  };
  const next = () => {
    if (!run) return;
    unlockAudio();
    void call<{ code: string; token: string; href: string }>({ action: "next", run: run.token }, (d) => {
      saveBattleSeat(d.code, d.token);
      router.push(d.href);
    });
  };
  const swap = (keepTeam: boolean) => {
    if (!run) return;
    void call<{ run: FrontierRunView }>({ action: "swap", run: run.token, give: keepTeam ? -1 : give, take: keepTeam ? 0 : take }, (d) => keep(d.run));
  };
  const abandon = () => keep(null);

  const best = bests[key] ?? 0;
  const info = FRONTIER_INFO[key];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]" data-testid={`frontier-${mode}`}>
      <div className="space-y-5">
        {mode === "factory" && (
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Factory">
            {(["open", "bss"] as const).map((s) => {
              const k = frontierKey("factory", s);
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={style === s}
                  onClick={() => setStyle(s)}
                  className={cn("menu-item hud flex flex-col items-start gap-1 rounded-lg border bg-card p-4 text-left", style === s && "border-primary ring-1 ring-primary")}
                >
                  <span className="font-display font-bold uppercase">{FRONTIER_INFO[k].name}</span>
                  <span className="text-sm text-muted-foreground">{FRONTIER_INFO[k].blurb}</span>
                  <span className="hud-label text-screen">Best streak: {bests[k] ?? 0}</span>
                </button>
              );
            })}
          </div>
        )}

        {!loaded ? null : run ? (
          <Card>
            <CardContent className="space-y-4 p-5">
              <StreakBar run={run} best={best} />
              {run.offer ? (
                <div className="space-y-3" data-testid="factory-swap">
                  <p className="font-display text-lg font-bold uppercase">Trade with the trainer you beat?</p>
                  <p className="text-sm text-muted-foreground">Pick one of yours to give up and one of theirs to take, or keep your team.</p>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <span className="hud-label">Your team: give</span>
                      {run.team.map((m, i) => (
                        <MonCard key={i} mon={m} sprite={sprite} picked={give === i} onPick={() => setGive(i)} testid="swap-give" />
                      ))}
                    </div>
                    <div className="space-y-1.5">
                      <span className="hud-label">Their team: take</span>
                      {run.offer.map((m, i) => (
                        <MonCard key={i} mon={m} sprite={sprite} picked={take === i} onPick={() => setTake(i)} testid="swap-take" />
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => swap(false)} disabled={busy || give === null || take === null} data-testid="swap-confirm">
                      <ArrowLeftRight className="h-4 w-4" aria-hidden /> Swap
                    </Button>
                    <Button type="button" variant="outline" onClick={() => swap(true)} disabled={busy}>
                      Keep my team
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <span className="hud-label">{mode === "factory" ? "Your rental team" : "Your team"}</span>
                  <div className="grid gap-1.5 md:grid-cols-2">
                    {run.team.map((m, i) => (
                      <MonCard key={i} mon={m} sprite={sprite} testid="frontier-mon" />
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ) : mode === "factory" ? (
          <Card>
            <CardContent className="space-y-3 p-5">
              <p className="font-display text-lg font-bold uppercase">Rent a team</p>
              <p className="text-sm text-muted-foreground">
                {info.blurb} You get six Pokémon from Pokémon Showdown&apos;s own Battle Factory sets{style === "open" ? ", all from one tier" : ""}. Win seven in a row to clear a round; after each win you may trade one of
                yours for one of your opponent&apos;s.
              </p>
            </CardContent>
          </Card>
        ) : (
          startPanel?.({ name: name.trim(), onRun: keep })
        )}
      </div>

      <Card className="h-fit border-primary/40 lg:sticky lg:top-20">
        <CardContent className="space-y-4 p-6">
          <p className="hud-label flex items-center gap-1.5 text-primary">
            <Trophy className="h-3.5 w-3.5" aria-hidden /> {info.name}
          </p>
          {run && !run.over ? (
            <>
              <p className="font-display text-2xl font-bold uppercase leading-tight">
                {run.next.boss ? (
                  <span className="flex items-center gap-2 text-warning">
                    <Crown className="h-6 w-6" aria-hidden /> Tower Tycoon
                  </span>
                ) : (
                  <>Battle {run.next.battle} of {FRONTIER_ROUND}</>
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                Round {run.next.round}. {CPU_LEVEL_INFO[run.next.level].name} computer{run.next.boss ? " with its best team" : ""}.
              </p>
              <Button size="lg" className="w-full" onClick={next} disabled={busy} data-testid="frontier-next">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Swords className="h-4 w-4" aria-hidden />} {run.offer ? "Skip trade and battle" : "Next battle"}
              </Button>
              <Button size="sm" variant="ghost" className="w-full" onClick={abandon} disabled={busy}>
                <Flag className="h-3.5 w-3.5" aria-hidden /> Give up this run
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <label htmlFor="frontier-name" className="hud-label">
                  Your trainer name
                </label>
                <input
                  id="frontier-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={24}
                  placeholder="Trainer name"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              {mode === "factory" && (
                <Button size="lg" className="w-full" onClick={start} disabled={busy || !name.trim()} data-testid="frontier-start">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Repeat className="h-4 w-4" aria-hidden />} Rent a team
                </Button>
              )}
              <p className="text-xs text-muted-foreground">Best streak: {best}. Signed-in trainers keep their best on their account.</p>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** A run's battle is over: the streak, and the way on (a trade, the next battle) or the end of the run. */
export function FrontierAfter({ view }: { view: BattleView }) {
  const [result, setResult] = useState<{ won: boolean; run: FrontierRunView; best: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const info = view.frontier!;
  const hub = info.mode === "factory" ? "/battle/factory" : "/battle/tower";

  useEffect(() => {
    let live = true;
    const token = loadBattleSeat(view.code);
    frontier<{ won: boolean; run: FrontierRunView; best: number | null }>({ action: "result", code: view.code, token })
      .then((d) => {
        if (!live) return;
        // Only this run's newest state replaces the one kept on this device.
        const kept = savedRun(d.run.key);
        if (!kept || kept.streak <= d.run.streak || kept.token === d.run.token) saveRun(d.run, d.run.key);
        if (d.run.over) saveRun(null, d.run.key);
        const best = Math.max(rememberBest(d.run.key, d.run.streak), d.best ?? 0);
        setResult({ won: d.won, run: d.run, best });
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : "Couldn't record the result."));
    return () => {
      live = false;
    };
  }, [view.code]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!result) return <Loader2 className="mx-auto h-5 w-5 animate-spin text-screen" aria-label="Recording the result" />;
  return (
    <div className="space-y-2 text-center" data-testid="frontier-after">
      <p className="font-display text-lg font-bold uppercase">
        {result.won ? `Streak: ${result.run.streak}` : `Run over at ${result.run.streak} win${result.run.streak === 1 ? "" : "s"}`}
      </p>
      <p className="text-sm text-muted-foreground">Best streak: {result.best}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {result.won ? (
          <Link href={hub} className={buttonVariants()} data-testid="frontier-continue">
            <Swords className="h-4 w-4" aria-hidden /> {info.mode === "factory" ? "Trade and continue" : "Continue"}
          </Link>
        ) : (
          <Link href={hub} className={buttonVariants()}>
            <Repeat className="h-4 w-4" aria-hidden /> New run
          </Link>
        )}
        <Link href="/battle" className={buttonVariants({ variant: "outline" })}>
          Battle home
        </Link>
      </div>
    </div>
  );
}
