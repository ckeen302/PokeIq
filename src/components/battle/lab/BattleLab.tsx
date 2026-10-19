"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Dices, FlaskConical, Link2, LoaderCircle, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cleanMasterSeed, newMasterSeed } from "@/lib/battle/lab/seed";
import { decodeSetup, defaultSetup, fitToGen, labQuery, normalizeSetup, runSettingsSchema, setupJson, setupProblem } from "@/lib/battle/lab/setup";
import { count, margin, pct, wilson } from "@/lib/battle/lab/stats";
import {
  DEFAULT_RUNS,
  LAB_GEN_GAMES,
  LAB_GENS,
  MAX_RUNS,
  RUN_PRESETS,
  TERRAIN_NAMES,
  WEATHER_NAMES,
  doublesAllowed,
  terrainsFor,
  weathersFor,
  type LabGen,
  type LabSetup,
  type LabSide,
  type LabTerrain,
  type LabWeather,
} from "@/lib/battle/lab/types";
import { cn } from "@/lib/utils";
import { inputClass, NumberInput, Toggle } from "../controls";
import { useLabDex, useSpriteLookup } from "../hooks";
import { LabResults } from "./LabResults";
import { MonEditor } from "./MonEditor";
import { SideCard } from "./SideCard";
import { useLabRun } from "./use-lab-run";

/**
 * Battle Lab: set up two sides, pick how each plays, and run the battle
 * hundreds or thousands of times on Pokémon Showdown's simulator in Web
 * Workers. The page itself never loads the simulator.
 */

const DRAFT_KEY = "pokeiq:battle-lab:v1";
const TURN_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 0];

function loadDraft(): LabSetup | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? normalizeSetup(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function saveDraft(setup: LabSetup) {
  try {
    window.localStorage.setItem(DRAFT_KEY, setupJson(setup));
  } catch {
    // Private mode / quota: the setup just won't be remembered.
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function BattleLab() {
  const [setup, setSetup] = useState<LabSetup>(defaultSetup);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sel, setSel] = useState<{ side: 0 | 1; slot: number }>({ side: 0, slot: 0 });
  const [runs, setRuns] = useState<number>(DEFAULT_RUNS);
  const [customRuns, setCustomRuns] = useState(false);
  const [seed, setSeed] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [linkState, setLinkState] = useState<{ copied: boolean; url: string | null }>({ copied: false, url: null });
  const { run, start, cancel, replay, workers } = useLabRun();
  const { dex, error } = useLabDex(setup.gen);
  const sprite = useSpriteLookup();
  const resultsRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const running = run?.status === "running";

  // A shared link's setup (and run size and seed), else the last setup on this device.
  useEffect(() => {
    let live = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("setup");
    (async () => {
      const shared = code ? await decodeSetup(code) : null;
      if (!live) return;
      if (shared) setSetup(shared);
      else {
        if (code) setNotice("That link's setup couldn't be read, so here's your last one.");
        const draft = loadDraft();
        if (draft) setSetup(draft);
      }
      const settings = runSettingsSchema.safeParse({ runs: params.get("runs") ?? undefined, seed: params.get("seed") ?? undefined });
      const wantedRuns = settings.success ? settings.data.runs : undefined;
      if (wantedRuns) {
        setRuns(wantedRuns);
        setCustomRuns(!(RUN_PRESETS as readonly number[]).includes(wantedRuns));
      }
      setSeed((settings.success && settings.data.seed) || newMasterSeed());
      setReady(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (ready) saveDraft(setup);
  }, [setup, ready]);

  const setSide = useCallback((side: 0 | 1, next: LabSide) => {
    setSetup((s) => {
      const sides: [LabSide, LabSide] = [...s.sides];
      sides[side] = next;
      return { ...s, sides };
    });
    setProblem(null);
  }, []);

  const setGen = (gen: LabGen) => setSetup((s) => fitToGen({ ...s, gen }));

  function begin(useSeed: string) {
    const issue = setupProblem(setup);
    if (issue) {
      setProblem(issue);
      return;
    }
    setProblem(null);
    const master = cleanMasterSeed(useSeed) ?? newMasterSeed();
    const total = Math.max(1, Math.min(MAX_RUNS, Math.round(runs)));
    start(setup, master, total);
    // The next run gets a fresh seed; "Run again with seed …" repeats this one.
    setSeed(newMasterSeed());
    setLinkState({ copied: false, url: null });
    void labQuery(setup, { runs: total, seed: master }).then((q) => window.history.replaceState(null, "", `?${q}`));
    window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  /** The same run again (the setup as it was then, not as edited since): identical results, by design. */
  function rerun(master: string) {
    if (!run) return;
    start(run.setup, master, run.total);
    void labQuery(run.setup, { runs: run.total, seed: master }).then((q) => window.history.replaceState(null, "", `?${q}`));
  }

  async function copySetupLink() {
    const url = `${window.location.origin}/battle/lab?${await labQuery(setup)}`;
    const ok = await copyText(url);
    setLinkState({ copied: ok, url: ok ? null : url });
    if (ok) window.setTimeout(() => setLinkState((l) => ({ ...l, copied: false })), 1600);
  }

  async function copyResultLink(): Promise<boolean> {
    if (!run) return false;
    const url = `${window.location.origin}/battle/lab?${await labQuery(run.setup, { runs: run.total, seed: run.seed })}`;
    const ok = await copyText(url);
    if (!ok) setLinkState({ copied: false, url });
    return ok;
  }

  const p = run?.progress;
  const live = p && p.done ? wilson(p.totals.wins[0], p.totals.battles) : null;
  const pace = p && p.elapsedMs > 0 ? (p.done / p.elapsedMs) * 1000 : 0;

  return (
    <div className="space-y-6">
      {notice && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm" role="status">
          {notice}
        </p>
      )}

      {/* The rules */}
      <section className="hud flex flex-wrap items-end gap-4 rounded-lg border bg-card p-4" aria-label="Rules">
        <label className="min-w-[14rem] flex-1 space-y-1.5">
          <span className="hud-label block">Mechanics</span>
          <select value={setup.gen} onChange={(e) => setGen(Number(e.target.value) as LabGen)} className={cn(inputClass, "h-10")} aria-label="Generation">
            {LAB_GENS.map((g) => (
              <option key={g} value={g}>
                Gen {g} · {LAB_GEN_GAMES[g]}
              </option>
            ))}
          </select>
        </label>
        <div className="space-y-1.5">
          <span className="hud-label block">Battle</span>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Singles or doubles">
            <Toggle pressed={!setup.doubles} onChange={() => setSetup((s) => ({ ...s, doubles: false }))} className="h-10 px-4">
              Singles
            </Toggle>
            <Toggle pressed={setup.doubles} onChange={() => setSetup((s) => ({ ...s, doubles: true }))} disabled={!doublesAllowed(setup.gen)} className="h-10 px-4">
              Doubles
            </Toggle>
          </div>
        </div>
        <p className="min-w-[14rem] flex-[2] text-sm text-muted-foreground">
          Showdown&apos;s <strong className="text-foreground">Gen {setup.gen} Custom Game</strong>: no tiers and no level rules. Any level from 1 to 100, and any Pokémon, item and
          move Gen {setup.gen} has. {!doublesAllowed(setup.gen) && "Double battles start in Gen 3."}
        </p>
      </section>

      {/* The two sides */}
      <div className="grid gap-4 lg:grid-cols-2">
        {([0, 1] as const).map((side) => (
          <SideCard
            key={side}
            side={side}
            setup={setup}
            sprite={sprite}
            selected={sel.side === side ? sel.slot : null}
            onSelect={(slot) => {
              setSel({ side, slot });
              // On a phone the editor sits below both sides: bring it up.
              window.requestAnimationFrame(() => {
                const top = editorRef.current?.getBoundingClientRect().top ?? 0;
                if (top > window.innerHeight * 0.8) editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              });
            }}
            onChange={(next) => setSide(side, next)}
            onGen={setGen}
          />
        ))}
      </div>

      <div ref={editorRef} className="scroll-mt-20">
        <MonEditor
          dex={dex}
          error={error}
          setup={setup}
          side={sel.side}
          slot={Math.min(sel.slot, setup.sides[sel.side].team.length)}
          onChange={(next) => setSide(sel.side, next)}
          onSelect={(slot) => setSel((s) => ({ ...s, slot }))}
        />
      </div>

      {/* The field */}
      {(weathersFor(setup.gen).length > 1 || terrainsFor(setup.gen).length > 1) && (
        <section className="hud flex flex-wrap items-end gap-4 rounded-lg border bg-card p-4" aria-label="Field">
          <p className="hud-label w-full">The field at the start</p>
          {weathersFor(setup.gen).length > 1 && (
            <FieldPick
              label="Weather"
              options={weathersFor(setup.gen).map((w) => [w, WEATHER_NAMES[w]])}
              value={setup.weather}
              onValue={(weather) => setSetup((s) => ({ ...s, weather: weather as LabWeather }))}
              turns={setup.weatherTurns}
              onTurns={(weatherTurns) => setSetup((s) => ({ ...s, weatherTurns }))}
            />
          )}
          {terrainsFor(setup.gen).length > 1 && (
            <FieldPick
              label="Terrain"
              options={terrainsFor(setup.gen).map((t) => [t, TERRAIN_NAMES[t]])}
              value={setup.terrain}
              onValue={(terrain) => setSetup((s) => ({ ...s, terrain: terrain as LabTerrain }))}
              turns={setup.terrainTurns}
              onTurns={(terrainTurns) => setSetup((s) => ({ ...s, terrainTurns }))}
            />
          )}
          <p className="min-w-[12rem] flex-1 text-xs text-muted-foreground">Hazards and screens are set on each side above.</p>
        </section>
      )}

      {/* Run */}
      <section className="hud space-y-4 rounded-lg border bg-card p-4 sm:p-5" aria-label="Run">
        <div className="flex flex-wrap items-end gap-4">
          <fieldset className="space-y-1.5">
            <legend className="hud-label mb-1.5">Battles</legend>
            <div className="flex flex-wrap items-center gap-1.5">
              {RUN_PRESETS.map((n) => (
                <Toggle
                  key={n}
                  pressed={!customRuns && runs === n}
                  onChange={() => {
                    setCustomRuns(false);
                    setRuns(n);
                  }}
                  className="h-10 px-3 font-mono"
                >
                  {count(n)}
                </Toggle>
              ))}
              <Toggle pressed={customRuns} onChange={() => setCustomRuns(true)} className="h-10 px-3">
                Custom
              </Toggle>
              {customRuns && <NumberInput label="Custom number of battles" value={runs} min={1} max={MAX_RUNS} onChange={setRuns} className="h-10 w-24" />}
            </div>
          </fieldset>
          <label className="space-y-1.5">
            <span className="hud-label block">Seed for the next run</span>
            <span className="flex gap-1.5">
              <input
                value={seed}
                onChange={(e) => setSeed(e.target.value.slice(0, 32))}
                spellCheck={false}
                aria-label="Master seed"
                className={cn(inputClass, "h-10 w-36 font-mono")}
              />
              <Button type="button" variant="outline" size="icon" onClick={() => setSeed(newMasterSeed())} aria-label="New seed">
                <Dices className="h-4 w-4" aria-hidden />
              </Button>
            </span>
          </label>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={copySetupLink}>
              {linkState.copied ? <Check className="h-4 w-4 text-success" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />} {linkState.copied ? "Copied" : "Copy setup link"}
            </Button>
            {running ? (
              <Button type="button" variant="destructive" size="lg" onClick={cancel}>
                <Square className="h-4 w-4" aria-hidden /> Cancel
              </Button>
            ) : (
              <Button type="button" size="lg" onClick={() => begin(seed)} disabled={!ready}>
                <Play className="h-4 w-4" aria-hidden /> Run {count(Math.max(1, Math.min(MAX_RUNS, runs)))} battles
              </Button>
            )}
          </div>
        </div>
        {problem && (
          <p className="text-sm text-destructive" role="alert">
            {problem}
          </p>
        )}
        {linkState.url && (
          <input readOnly value={linkState.url} onFocus={(e) => e.target.select()} aria-label="Link" className={cn(inputClass, "font-mono text-xs")} />
        )}
        {run && p && running && (
          <div className="space-y-2" data-testid="lab-progress">
            <Progress value={(p.done / Math.max(1, p.total)) * 100} aria-label="Battles played" />
            <p className="flex flex-wrap justify-between gap-2 font-mono text-xs tabular-nums text-muted-foreground">
              <span>
                {count(p.done)} of {count(p.total)} battles{pace ? ` · ${count(Math.round(pace))}/s` : ""} · {run.workers} worker{run.workers === 1 ? "" : "s"}
              </span>
              <span>
                {live ? (
                  <>
                    {run.labels[0]} {pct(live.p)} ± {pct(margin(live))}
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> Loading the simulator…
                  </span>
                )}
              </span>
            </p>
          </div>
        )}
        <p className="flex gap-2 text-xs text-muted-foreground">
          <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Every battle is a real one on Pokémon Showdown&apos;s simulator, played right here in your browser{workers ? ` on ${workers} worker${workers === 1 ? "" : "s"}` : ""}. Each
            battle&apos;s randomness comes from the run&apos;s seed, so the same seed and setup always give the same result. Battles still going at turn 300 count as draws.
          </span>
        </p>
      </section>

      <div ref={resultsRef} className="scroll-mt-20">
        {run && run.status === "error" ? (
          <p className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm" role="alert">
            {run.setupError ? "This setup can't run: " : ""}
            {run.error}
          </p>
        ) : run ? (
          <LabResults run={run} sprite={sprite} onRerun={rerun} onCopyLink={copyResultLink} replayBattle={(index) => replay(run.setup, run.seed, index)} />
        ) : null}
      </div>
    </div>
  );
}

function FieldPick({
  label,
  options,
  value,
  onValue,
  turns,
  onTurns,
}: {
  label: string;
  options: [string, string][];
  value: string;
  onValue: (v: string) => void;
  turns: number;
  onTurns: (n: number) => void;
}) {
  return (
    <div className="flex items-end gap-2">
      <label className="space-y-1.5">
        <span className="hud-label block">{label}</span>
        <select value={value} onChange={(e) => onValue(e.target.value)} className={cn(inputClass, "h-10 w-44")} aria-label={label}>
          {options.map(([v, name]) => (
            <option key={v} value={v}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {value && (
        <label className="space-y-1.5">
          <span className="hud-label block">Turns left</span>
          <select value={turns} onChange={(e) => onTurns(Number(e.target.value))} className={cn(inputClass, "h-10 w-28")} aria-label={`${label} turns left`}>
            {TURN_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "Never ends" : `${n} turn${n === 1 ? "" : "s"}`}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
