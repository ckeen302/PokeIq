"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Dices, FlaskConical, Link2, LoaderCircle, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cleanMasterSeed, newMasterSeed } from "@/lib/battle/lab/seed";
import { useT } from "@/i18n/client";
import { localUrl } from "@/i18n/paths";
import battleLab from "@/messages/battle-lab";
import { decodeSetup, defaultSetup, fitToGen, labQuery, normalizeSetup, runSettingsSchema, setupIssue, setupJson, type SetupIssue } from "@/lib/battle/lab/setup";
import { margin, wilson } from "@/lib/battle/lab/stats";
import { labMessage, labNumbers, setupIssueText } from "@/lib/battle/lab/words";
import {
  DEFAULT_RUNS,
  LAB_GENS,
  MAX_RUNS,
  RUN_PRESETS,
  TERRAIN_NAMES,
  doublesAllowed,
  sideLabels,
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
import { useBattleNames } from "../use-battle-names";
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
  const [notice, setNotice] = useState(false);
  const [sel, setSel] = useState<{ side: 0 | 1; slot: number }>({ side: 0, slot: 0 });
  const [runs, setRuns] = useState<number>(DEFAULT_RUNS);
  const [customRuns, setCustomRuns] = useState(false);
  const [seed, setSeed] = useState("");
  const [problem, setProblem] = useState<SetupIssue | null>(null);
  const [linkState, setLinkState] = useState<{ copied: boolean; url: string | null }>({ copied: false, url: null });
  const { run, start, cancel, replay, workers } = useLabRun();
  const { dex, error } = useLabDex(setup.gen);
  const sprite = useSpriteLookup();
  const resultsRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const running = run?.status === "running";
  const t = useT(battleLab);
  const names = useBattleNames();
  const num = labNumbers(t.locale);

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
        if (code) setNotice(true);
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
    const issue = setupIssue(setup);
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
    const url = `${window.location.origin}${localUrl(`/battle/lab?${await labQuery(setup)}`)}`;
    const ok = await copyText(url);
    setLinkState({ copied: ok, url: ok ? null : url });
    if (ok) window.setTimeout(() => setLinkState((l) => ({ ...l, copied: false })), 1600);
  }

  async function copyResultLink(): Promise<boolean> {
    if (!run) return false;
    const url = `${window.location.origin}${localUrl(`/battle/lab?${await labQuery(run.setup, { runs: run.total, seed: run.seed })}`)}`;
    const ok = await copyText(url);
    if (!ok) setLinkState({ copied: false, url });
    return ok;
  }

  const p = run?.progress;
  const live = p && p.done ? wilson(p.totals.wins[0], p.totals.battles) : null;
  const pace = p && p.elapsedMs > 0 ? (p.done / p.elapsedMs) * 1000 : 0;
  // The run's side names in the page's language (English: as the run named them).
  const shown = run && { ...run, labels: sideLabels(run.setup, { sides: [t("side.a"), t("side.b")], species: names.species }) };

  return (
    <div className="space-y-6">
      {notice && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm" role="status">
          {t("notice.badLink")}
        </p>
      )}

      {/* The rules */}
      <section className="hud flex flex-wrap items-end gap-4 rounded-lg border bg-card p-4" aria-label={t("rules.label")}>
        <label className="min-w-[14rem] flex-1 space-y-1.5">
          <span className="hud-label block">{t("rules.mechanics")}</span>
          <select value={setup.gen} onChange={(e) => setGen(Number(e.target.value) as LabGen)} className={cn(inputClass, "h-10")} aria-label={t("rules.generation")}>
            {LAB_GENS.map((g) => (
              <option key={g} value={g}>
                {t("rules.option", { gen: g, games: t(`games.${g}`) })}
              </option>
            ))}
          </select>
        </label>
        <div className="space-y-1.5">
          <span className="hud-label block">{t("rules.battle")}</span>
          <div className="flex gap-1.5" role="radiogroup" aria-label={t("rules.singlesOrDoubles")}>
            <Toggle pressed={!setup.doubles} onChange={() => setSetup((s) => ({ ...s, doubles: false }))} className="h-10 px-4">
              {t("rules.singles")}
            </Toggle>
            <Toggle pressed={setup.doubles} onChange={() => setSetup((s) => ({ ...s, doubles: true }))} disabled={!doublesAllowed(setup.gen)} className="h-10 px-4">
              {t("rules.doubles")}
            </Toggle>
          </div>
        </div>
        <p className="min-w-[14rem] flex-[2] text-sm text-muted-foreground">
          {t.rich("rules.custom", { gen: setup.gen, b: (chunks) => <strong className="text-foreground">{chunks}</strong> })} {!doublesAllowed(setup.gen) && t("rules.noDoubles")}
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
        <section className="hud flex flex-wrap items-end gap-4 rounded-lg border bg-card p-4" aria-label={t("field.label")}>
          <p className="hud-label w-full">{t("field.heading")}</p>
          {weathersFor(setup.gen).length > 1 && (
            <FieldPick
              label={t("field.weather")}
              options={weathersFor(setup.gen).map((w) => [w, t(`weather.${w || "none"}`)])}
              value={setup.weather}
              onValue={(weather) => setSetup((s) => ({ ...s, weather: weather as LabWeather }))}
              turns={setup.weatherTurns}
              onTurns={(weatherTurns) => setSetup((s) => ({ ...s, weatherTurns }))}
            />
          )}
          {terrainsFor(setup.gen).length > 1 && (
            <FieldPick
              label={t("field.terrain")}
              options={terrainsFor(setup.gen).map((id) => [id, id ? names.move(TERRAIN_NAMES[id]) : t("field.none")])}
              value={setup.terrain}
              onValue={(terrain) => setSetup((s) => ({ ...s, terrain: terrain as LabTerrain }))}
              turns={setup.terrainTurns}
              onTurns={(terrainTurns) => setSetup((s) => ({ ...s, terrainTurns }))}
            />
          )}
          <p className="min-w-[12rem] flex-1 text-xs text-muted-foreground">{t("field.note")}</p>
        </section>
      )}

      {/* Run */}
      <section className="hud space-y-4 rounded-lg border bg-card p-4 sm:p-5" aria-label={t("run.label")}>
        <div className="flex flex-wrap items-end gap-4">
          <fieldset className="space-y-1.5">
            <legend className="hud-label mb-1.5">{t("run.battles")}</legend>
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
                  {num.count(n)}
                </Toggle>
              ))}
              <Toggle pressed={customRuns} onChange={() => setCustomRuns(true)} className="h-10 px-3">
                {t("run.custom")}
              </Toggle>
              {customRuns && <NumberInput label={t("run.customLabel")} value={runs} min={1} max={MAX_RUNS} onChange={setRuns} className="h-10 w-24" />}
            </div>
          </fieldset>
          <label className="space-y-1.5">
            <span className="hud-label block">{t("run.seed")}</span>
            <span className="flex gap-1.5">
              <input
                value={seed}
                onChange={(e) => setSeed(e.target.value.slice(0, 32))}
                spellCheck={false}
                aria-label={t("run.masterSeed")}
                className={cn(inputClass, "h-10 w-36 font-mono")}
              />
              <Button type="button" variant="outline" size="icon" onClick={() => setSeed(newMasterSeed())} aria-label={t("run.newSeed")}>
                <Dices className="h-4 w-4" aria-hidden />
              </Button>
            </span>
          </label>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={copySetupLink}>
              {linkState.copied ? <Check className="h-4 w-4 text-success" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />} {linkState.copied ? t("run.copied") : t("run.copySetup")}
            </Button>
            {running ? (
              <Button type="button" variant="destructive" size="lg" onClick={cancel}>
                <Square className="h-4 w-4" aria-hidden /> {t("run.cancel")}
              </Button>
            ) : (
              <Button type="button" size="lg" onClick={() => begin(seed)} disabled={!ready}>
                <Play className="h-4 w-4" aria-hidden /> {t("run.run", { num: Math.max(1, Math.min(MAX_RUNS, runs)), n: num.count(Math.max(1, Math.min(MAX_RUNS, runs))) })}
              </Button>
            )}
          </div>
        </div>
        {problem && (
          <p className="text-sm text-destructive" role="alert">
            {setupIssueText(problem, names, t)}
          </p>
        )}
        {linkState.url && (
          <input readOnly value={linkState.url} onFocus={(e) => e.target.select()} aria-label={t("run.link")} className={cn(inputClass, "font-mono text-xs")} />
        )}
        {run && p && running && (
          <div className="space-y-2" data-testid="lab-progress">
            <Progress value={(p.done / Math.max(1, p.total)) * 100} aria-label={t("run.played")} />
            <p className="flex flex-wrap justify-between gap-2 font-mono text-xs tabular-nums text-muted-foreground">
              <span>
                {t("run.progress", { num: p.total, done: num.count(p.done), total: num.count(p.total) })}
                {pace ? ` · ${t("run.pace", { pace: num.count(Math.round(pace)) })}` : ""} · {t("run.workers", { n: run.workers })}
              </span>
              <span>
                {live ? (
                  <>
                    {shown?.labels[0]} {num.pct(live.p)} ± {num.pct(margin(live))}
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> {t("run.loading")}
                  </span>
                )}
              </span>
            </p>
          </div>
        )}
        <p className="flex gap-2 text-xs text-muted-foreground">
          <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{t("run.about", { workers })}</span>
        </p>
      </section>

      <div ref={resultsRef} className="scroll-mt-20">
        {shown && shown.status === "error" ? (
          <p className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm" role="alert">
            {shown.setupError ? t("run.cantRun", { error: labMessage(shown.error ?? "", names, t) }) : labMessage(shown.error ?? "", names, t)}
          </p>
        ) : shown ? (
          <LabResults run={shown} sprite={sprite} onRerun={rerun} onCopyLink={copyResultLink} replayBattle={(index) => replay(shown.setup, shown.seed, index)} />
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
  const t = useT(battleLab);
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
          <span className="hud-label block">{t("field.turnsLeft")}</span>
          <select value={turns} onChange={(e) => onTurns(Number(e.target.value))} className={cn(inputClass, "h-10 w-28")} aria-label={t("field.turnsLeftLabel", { label })}>
            {TURN_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? t("field.never") : t("field.turns", { n })}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
