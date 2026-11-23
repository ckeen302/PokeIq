"use client";

import "../tier-list/tier-list.css";
import "./picker.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import picker from "@/messages/favorite-picker";
import type { ArtStyle } from "@/lib/tier-list/art";
import { newSeed } from "@/lib/tier-list/rng";
import { TYPES, type Mon, type Roster, type TypeName } from "@/lib/tier-list/types";
import { ALL_POOL, cleanPool, poolMons, typePool, type PoolConfig } from "@/lib/favorite-picker/pool";
import { pick, undoPick, viewRun, type Run } from "@/lib/favorite-picker/run";
import { TOP_MAX, decodeResult, encodeResult, refCodec, type SharedResult } from "@/lib/favorite-picker/link";
import { loadShinyParts, shinyMakerHref } from "@/lib/favorite-picker/shiny-link";
import { IconButton, PillButton, Segmented } from "../tier-list/ui";
import { Setup } from "./Setup";
import { RunView } from "./RunView";
import { Result, type Slot } from "./Result";
import { TypeChart, type Chart } from "./TypeChart";
import { ExportDialog, ShareDialog, type ExportKind } from "./Dialogs";
import { Toast, poolLabel, typeName } from "./common";

/**
 * The Favorite Pokémon Picker: the picker (pool → narrowing rounds → bracket → favorite and top 10) and the type
 * chart (a favorite per type, by search or by a run on that type). Everything is kept on this device, in one
 * localStorage entry; a run is saved as its pool, seed and picks (lib/favorite-picker/run), so a refresh carries on
 * where it was and undo always works. A shared link (?d=) shows someone's result until "Make your own".
 */

const STORE = "pokeiq-favorite-picker:v1";

type Tab = "picker" | "chart";
type Stage = "setup" | "run" | "result";

interface Saved {
  v: 1;
  tab: Tab;
  art: ArtStyle;
  shinyAll: boolean;
  pool: PoolConfig;
  stage: Stage;
  run: Run | null;
  /** The pool the run (and so the result) came from. */
  runPool: PoolConfig | null;
  top: Slot[];
  chart: Chart;
  /** A run on one type for the chart, and whether it's on screen. */
  typeRun: { type: TypeName; run: Run; open: boolean } | null;
}

const EMPTY: Saved = { v: 1, tab: "picker", art: "hd", shinyAll: false, pool: ALL_POOL, stage: "setup", run: null, runPool: null, top: [], chart: {}, typeRun: null };

function validRun(r: unknown, byKey: ReadonlyMap<string, Mon>): Run | null {
  const run = r as Run | null;
  if (!run || !Array.isArray(run.pool) || typeof run.seed !== "string" || !Array.isArray(run.picks)) return null;
  if (!run.pool.length || run.pool.some((k) => typeof k !== "string" || !byKey.has(k))) return null;
  if (run.picks.some((p) => typeof p !== "number")) return null;
  const v = viewRun(run);
  return { pool: run.pool, seed: run.seed, picks: run.picks.slice(0, v.valid) };
}

const validSlot = (s: unknown, byKey: ReadonlyMap<string, Mon>): Slot | null => {
  const o = s as Slot | null;
  return o && typeof o.k === "string" && byKey.has(o.k) ? { k: o.k, shiny: !!o.shiny } : null;
};

function load(byKey: ReadonlyMap<string, Mon>): Saved {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return EMPTY;
    const s = JSON.parse(raw) as Partial<Saved>;
    const run = validRun(s.run, byKey);
    const top = (Array.isArray(s.top) ? s.top : []).map((x) => validSlot(x, byKey)).filter((x): x is Slot => !!x).slice(0, TOP_MAX);
    const chart: Chart = {};
    for (const ty of TYPES) {
      const slot = validSlot(s.chart?.[ty], byKey);
      if (slot) chart[ty] = slot;
    }
    const tr = s.typeRun && TYPES.includes(s.typeRun.type) ? validRun(s.typeRun.run, byKey) : null;
    let stage: Stage = s.stage === "run" || s.stage === "result" ? s.stage : "setup";
    if (stage === "run" && !run) stage = "setup";
    if (stage === "result" && !top.length) stage = run ? "run" : "setup";
    return {
      v: 1,
      tab: s.tab === "chart" ? "chart" : "picker",
      art: s.art === "pixel" ? "pixel" : "hd",
      shinyAll: !!s.shinyAll,
      pool: cleanPool(s.pool),
      stage,
      run,
      runPool: s.runPool ? cleanPool(s.runPool) : null,
      top,
      chart,
      typeRun: tr && s.typeRun ? { type: s.typeRun.type, run: tr, open: !!s.typeRun.open } : null,
    };
  } catch {
    return EMPTY;
  }
}

function save(s: Saved) {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* storage full or blocked: the picks stay on screen */
  }
}

interface SharedView {
  top: Slot[];
  chart: Chart;
  from: PoolConfig | null;
}

export default function PickerApp({ roster, shared }: { roster: Roster; shared: string | null }) {
  const t = useT(picker);
  const mons = roster.mons;
  const byKey = useMemo(() => new Map(mons.map((m) => [m.k, m])), [mons]);
  const codec = useMemo(() => refCodec(mons), [mons]);

  const [s, setS] = useState<Saved>(() => load(byKey));
  const [view, setView] = useState<SharedView | null>(() => {
    const r = decodeResult(shared);
    if (!r) return null;
    const slot = (x: { ref: number | string; shiny: boolean }) => {
      const k = codec.key(x.ref);
      return k && byKey.has(k) ? { k, shiny: x.shiny } : null;
    };
    const top = r.top.map(slot).filter((x): x is Slot => !!x);
    const chart: Chart = {};
    for (const ty of TYPES) {
      const c = r.chart[ty];
      const v = c ? slot(c) : null;
      if (v) chart[ty] = v;
    }
    return top.length || Object.keys(chart).length ? { top, chart, from: r.pool } : null;
  });
  const [sharedTab, setSharedTab] = useState<Tab>(() => (decodeResult(shared)?.chartFirst ? "chart" : "picker"));
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => {
    if (shared && !view) say(t("share.badLink"));
    // Once, for the link the page opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [prefill, setPrefill] = useState(0);
  const [dialog, setDialog] = useState<null | { kind: "share" } | { kind: "export"; what: ExportKind }>(null);
  const [parts, setParts] = useState<string | null>(null);
  useEffect(() => {
    void loadShinyParts().then(setParts);
  }, []);

  useEffect(() => save(s), [s]);
  const update = useCallback((f: (s: Saved) => Saved) => setS((prev) => f(prev)), []);

  const shinyHref = useCallback((m: Mon, shiny: boolean) => shinyMakerHref(m.d, parts, shiny), [parts]);
  const tab: Tab = view ? sharedTab : s.tab;
  const setTab = (v: Tab) => (view ? setSharedTab(v) : update((st) => ({ ...st, tab: v })));

  // ---- The main run.
  const runView = useMemo(() => (s.run ? viewRun(s.run) : null), [s.run]);
  const start = () => {
    const pool = poolMons(mons, s.pool).map((m) => m.k);
    if (!pool.length) return;
    const run: Run = { pool, seed: newSeed(), picks: [] };
    const v = viewRun(run);
    setPrefill(0);
    update((st) => (v.phase === "done" ? { ...st, run, runPool: st.pool, stage: "result", top: v.ranking.slice(0, TOP_MAX).map((k) => ({ k, shiny: false })) } : { ...st, run, runPool: st.pool, stage: "run" }));
    window.scrollTo({ top: Math.max(0, (document.querySelector('[data-testid="favorite-picker-app"]') as HTMLElement | null)?.offsetTop ?? 0) - 80, behavior: "smooth" });
  };
  const onPick = (p: number) => {
    if (!s.run) return;
    setPrefill(0);
    const run = pick(s.run, p);
    const v = viewRun(run);
    setS(v.phase === "done" ? { ...s, run, stage: "result", top: v.ranking.slice(0, TOP_MAX).map((k) => ({ k, shiny: s.shinyAll })) } : { ...s, run });
  };
  const onUndo = () => {
    if (!s.run || !s.run.picks.length) return;
    setPrefill(s.run.picks[s.run.picks.length - 1]);
    setS({ ...s, run: undoPick(s.run), stage: "run" });
  };
  const quit = () => update((st) => ({ ...st, run: null, stage: "setup" }));

  // ---- The type chart's runs.
  const typeView = useMemo(() => (s.typeRun ? viewRun(s.typeRun.run) : null), [s.typeRun]);
  const finishType = (type: TypeName, ranking: string[]) => {
    const k = ranking[0];
    const m = k ? byKey.get(k) : undefined;
    if (m) say(t("chart.filled", { name: m.n, type: typeName(t, type) }));
    setS({ ...s, typeRun: null, chart: k ? { ...s.chart, [type]: { k, shiny: false } } : s.chart });
  };
  const runType = (type: TypeName) => {
    setPrefill(0);
    if (s.typeRun?.type === type) return setS({ ...s, typeRun: { ...s.typeRun, open: true } });
    const pool = poolMons(mons, typePool(type, s.pool.forms)).map((m) => m.k);
    const run: Run = { pool, seed: newSeed(), picks: [] };
    const v = viewRun(run);
    if (v.phase === "done") return finishType(type, v.ranking);
    setS({ ...s, typeRun: { type, run, open: true } });
  };
  const onTypePick = (p: number) => {
    if (!s.typeRun) return;
    setPrefill(0);
    const run = pick(s.typeRun.run, p);
    const v = viewRun(run);
    if (v.phase === "done") return finishType(s.typeRun.type, v.ranking);
    setS({ ...s, typeRun: { ...s.typeRun, run } });
  };
  const onTypeUndo = () => {
    if (!s.typeRun || !s.typeRun.run.picks.length) return;
    setPrefill(s.typeRun.run.picks[s.typeRun.run.picks.length - 1]);
    setS({ ...s, typeRun: { ...s.typeRun, run: undoPick(s.typeRun.run) } });
  };

  const addToChart = () => {
    const fav = s.top[0];
    const m = fav ? byKey.get(fav.k) : undefined;
    if (!m) return;
    const type = (m.t.find((ty) => !s.chart[ty as TypeName]) ?? m.t[0]) as TypeName;
    update((st) => ({ ...st, chart: { ...st.chart, [type]: { k: m.k, shiny: fav.shiny } } }));
    say(t("result.toChartDone", { name: m.n, type: typeName(t, type) }));
  };

  // ---- Share and download.
  const showing = view ?? { top: s.top, chart: s.chart, from: s.runPool };
  const shareUrl = (() => {
    const r: SharedResult = {
      top: (s.stage === "result" ? s.top : []).flatMap((x) => {
        const ref = codec.ref(x.k);
        return ref === null ? [] : [{ ref, shiny: x.shiny }];
      }),
      chart: Object.fromEntries(
        TYPES.flatMap((ty) => {
          const c = s.chart[ty];
          const ref = c ? codec.ref(c.k) : null;
          return c && ref !== null ? [[ty, { ref, shiny: c.shiny }]] : [];
        })
      ),
      pool: s.runPool,
      chartFirst: s.tab === "chart",
    };
    if (!r.top.length && !Object.keys(r.chart).length) return null;
    return `${window.location.origin}${window.location.pathname.replace(/\/shared$/, "")}?d=${encodeResult(r)}`;
  })();
  const exportInput = useMemo(
    () => ({
      top: showing.top.flatMap((x) => {
        const m = byKey.get(x.k);
        return m ? [{ mon: m, shiny: x.shiny }] : [];
      }),
      chart: Object.fromEntries(
        TYPES.flatMap((ty) => {
          const c = showing.chart[ty];
          const m = c ? byKey.get(c.k) : undefined;
          return c && m ? [[ty, { mon: m, shiny: c.shiny }]] : [];
        })
      ),
      from: showing.from ? poolLabel(t, showing.from) : "",
      art: s.art,
    }),
    [showing.top, showing.chart, showing.from, byKey, t, s.art]
  );

  const makeYours = () => {
    setView(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("d");
    window.history.replaceState(window.history.state, "", url.pathname.replace(/\/shared$/, "") + url.search);
  };

  const shiny = s.shinyAll;
  const lastFavorite = s.top[0] ? (byKey.get(s.top[0].k) ?? null) : null;

  return (
    <div className="tlm-app mt-6 max-sm:mt-5" data-testid="favorite-picker-app" data-stage={view ? "shared" : s.stage} data-tab={tab}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<Tab> label={t("tabs.label")} value={tab} onChange={setTab} options={[{ value: "picker", label: t("tabs.picker"), testId: "fp-tab-picker" }, { value: "chart", label: t("tabs.chart"), testId: "fp-tab-chart" }]} className="max-sm:flex max-sm:w-full" />
        <div className="flex items-center gap-1.5 max-sm:w-full max-sm:justify-end">
          <Segmented<ArtStyle> size="sm" label={t("art.label")} value={s.art} onChange={(v) => update((st) => ({ ...st, art: v }))} options={[{ value: "hd", label: t("art.hd"), testId: "fp-art-hd" }, { value: "pixel", label: t("art.pixel"), testId: "fp-art-pixel" }]} />
          {!view && (
            <IconButton label={t("shinyAll")} active={shiny} aria-pressed={shiny} onClick={() => update((st) => ({ ...st, shinyAll: !st.shinyAll }))} testId="fp-shiny-all">
              <Sparkles className={cn("h-[18px] w-[18px]", shiny && "text-[hsl(var(--warning))]")} aria-hidden />
            </IconButton>
          )}
        </div>
      </div>

      {view && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-screen/[0.08] px-4 py-2.5 text-sm" data-testid="fp-shared-banner">
          <span>{t("share.banner")}</span>
          <button type="button" onClick={makeYours} className="font-semibold text-screen hover:underline" data-testid="fp-make-yours">
            {t("share.makeYours")}
          </button>
        </div>
      )}

      <div className="mt-4">
        {view ? (
          tab === "picker" && view.top.length ? (
            <Result top={view.top} byKey={byKey} art={s.art} readOnly from={view.from ? poolLabel(t, view.from) : null} shinyHref={shinyHref} onChange={() => undefined} onExport={() => setDialog({ kind: "export", what: "result" })} onAgain={makeYours} />
          ) : tab === "picker" ? (
            <EmptyShared onMake={makeYours} />
          ) : (
            <TypeChart chart={view.chart} mons={mons} byKey={byKey} art={s.art} readOnly shinyHref={shinyHref} onChange={() => undefined} onExport={() => setDialog({ kind: "export", what: "chart" })} />
          )
        ) : tab === "picker" ? (
          s.stage === "run" && runView && s.run && runView.phase !== "done" ? (
            <RunView view={runView} byKey={byKey} art={s.art} shiny={shiny} prefill={prefill} canUndo={s.run.picks.length > 0} onPick={onPick} onUndo={onUndo} onQuit={quit} />
          ) : s.stage === "result" && s.top.length ? (
            <Result
              top={s.top}
              byKey={byKey}
              art={s.art}
              from={s.runPool ? poolLabel(t, s.runPool) : null}
              shinyHref={shinyHref}
              onChange={(top) => update((st) => ({ ...st, top }))}
              onShare={() => setDialog({ kind: "share" })}
              onExport={() => setDialog({ kind: "export", what: "result" })}
              onToChart={addToChart}
              onUndo={s.run && s.run.picks.length ? onUndo : undefined}
              onAgain={() => update((st) => ({ ...st, stage: "setup", run: null }))}
            />
          ) : (
            <Setup mons={mons} pool={s.pool} onChange={(pool) => update((st) => ({ ...st, pool }))} onStart={start} lastFavorite={lastFavorite} onShowLast={() => update((st) => ({ ...st, stage: "result" }))} />
          )
        ) : s.typeRun?.open && typeView && typeView.phase !== "done" ? (
          <RunView
            view={typeView}
            byKey={byKey}
            art={s.art}
            shiny={shiny}
            prefill={prefill}
            title={t("chart.running", { type: typeName(t, s.typeRun.type) })}
            canUndo={s.typeRun.run.picks.length > 0}
            onPick={onTypePick}
            onUndo={onTypeUndo}
            onQuit={() => update((st) => ({ ...st, typeRun: null }))}
            back={{ label: t("chart.back"), onClick: () => update((st) => (st.typeRun ? { ...st, typeRun: { ...st.typeRun, open: false } } : st)) }}
          />
        ) : (
          <>
            {s.typeRun && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-primary/[0.08] px-4 py-2.5 text-sm" data-testid="fp-type-paused">
                <span>{t("chart.running", { type: typeName(t, s.typeRun.type) })}</span>
                <button type="button" onClick={() => runType(s.typeRun!.type)} className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline">
                  <Play className="h-3.5 w-3.5" aria-hidden /> {t("run.cancel")}
                </button>
              </div>
            )}
            <TypeChart
              chart={s.chart}
              mons={mons}
              byKey={byKey}
              art={s.art}
              shinyHref={shinyHref}
              onChange={(chart) => update((st) => ({ ...st, chart }))}
              onRun={runType}
              paused={s.typeRun?.type ?? null}
              onShare={() => setDialog({ kind: "share" })}
              onExport={() => setDialog({ kind: "export", what: "chart" })}
            />
          </>
        )}
      </div>

      {dialog?.kind === "share" && <ShareDialog url={shareUrl} onClose={() => setDialog(null)} />}
      {dialog?.kind === "export" && <ExportDialog input={exportInput} initial={dialog.what} onClose={() => setDialog(null)} />}
      <Toast text={toast} />
    </div>
  );
}

function EmptyShared({ onMake }: { onMake(): void }) {
  const t = useT(picker);
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center gap-4 rounded-[28px] border border-foreground/[0.08] bg-card p-8 text-center">
      <PillButton primary onClick={onMake}>
        {t("share.makeYours")}
      </PillButton>
    </div>
  );
}
