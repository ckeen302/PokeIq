"use client";

import "../tier-list/tier-list.css";
import "./nuzlocke.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Copy, Flower2, Package, Route, Users } from "lucide-react";
import Link from "@/components/ui/Link";
import { useRouter } from "@/i18n/navigation";
import { useT } from "@/i18n/client";
import nuz from "@/messages/nuzlocke";
import { cn } from "@/lib/utils";
import {
  addBadge,
  box,
  clearArea,
  displayName,
  evolve,
  getMon,
  graveyard,
  logCatch,
  logFailed,
  moveInTeam,
  newId,
  removeBadge,
  removeMon,
  rename,
  renameRun,
  setLevel,
  setRules,
  setShiny,
  setStatus,
  skipArea,
  swap,
  team,
  toggleBoss,
  type Death,
  type MonStatus,
  type Rules,
  type Run,
} from "@/lib/nuzlocke/run";
import { STORE_KEY, deleteRun, importRun, loadStore, saveRun, savePrefs, setFilter, type AreaFilter, type Prefs } from "@/lib/nuzlocke/storage";
import { decodeRun } from "@/lib/nuzlocke/share";
import { allAreas, allBosses, type GameSummary, type GameView } from "@/lib/nuzlocke/view";
import type { EncounterKind } from "@/lib/nuzlocke/model";
import { PillButton } from "../tier-list/ui";
import type { Act } from "./act";
import { loadView } from "./data";
import { takeHandOff, handOff } from "./handoff";
import { stashDeleted } from "./deleted";
import { RunSkeleton } from "./RunShell";
import { TRACKER_PATH, runPath } from "./StartRun";
import { Toast, type ToastState } from "./parts";
import { RunHeader } from "./RunHeader";
import { RouteList } from "./RouteList";
import { Picker } from "./Picker";
import { DeathDialog } from "./DeathDialog";
import { Panel, SwapDialog, type Side } from "./Panel";
import { DeleteDialog, ImportDialog, RulesDialog } from "./Dialogs";
import { ShareDialog, downloadBackup } from "./ShareDialog";

type Tab = "routes" | Side;
type Dialog = { kind: "pick"; area: string; extra?: boolean } | { kind: "death"; mon: string } | { kind: "swap"; mon: string } | { kind: "rules" } | { kind: "share" } | { kind: "delete" } | null;
type Load = { kind: "loading" } | { kind: "missing" } | { kind: "broken" } | { kind: "error"; run: Run } | { kind: "ready"; run: Run; view: GameView };

/** The run screen: finds the run (saved here, or a share link's), loads its game, then shows it. */
export default function RunApp({ games, shared, brokenText }: { games: GameSummary[]; shared: string | null; brokenText?: string }) {
  const t = useT(nuz);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const open = useCallback(() => {
    let run: Run | null;
    if (shared !== null) run = decodeRun(shared);
    else {
      const id = new URLSearchParams(window.location.search).get("id") ?? "";
      run = takeHandOff(id) ?? loadStore().runs[id] ?? null;
    }
    const summary = run && games.find((g) => g.id === run.game);
    if (!run || !summary) return setLoad({ kind: shared !== null ? "broken" : "missing" });
    setLoad({ kind: "loading" });
    loadView(run.game, summary.data).then(
      (view) => setLoad({ kind: "ready", run: run!, view }),
      () => setLoad({ kind: "error", run: run! })
    );
  }, [games, shared]);
  useEffect(open, [open]);

  if (load.kind === "loading") return <RunSkeleton />;
  if (load.kind === "ready") return <RunScreen key={load.run.id} initial={load.run} view={load.view} readOnly={shared !== null} shareRaw={shared} />;
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 text-center" data-testid={`nz-${load.kind}`}>
      <h1 className="font-display text-[26px] font-bold tracking-tight">{load.kind === "missing" ? t("state.notFound") : load.kind === "broken" ? (brokenText ?? t("state.loadError")) : t("state.loadError")}</h1>
      {load.kind === "missing" && <p className="text-[15px] text-muted-foreground">{t("state.notFoundLead")}</p>}
      <div className="flex flex-wrap justify-center gap-2">
        {load.kind === "error" && (
          <PillButton primary onClick={open}>
            {t("state.retry")}
          </PillButton>
        )}
        <Link href={TRACKER_PATH} className="inline-flex h-11 items-center gap-2 rounded-full bg-foreground/[0.07] px-5 text-sm font-semibold hover:bg-foreground/[0.11]">
          <ArrowLeft className="h-4 w-4" aria-hidden /> {t("state.back")}
        </Link>
      </div>
    </div>
  );
}

function RunScreen({ initial, view, readOnly, shareRaw }: { initial: Run; view: GameView; readOnly: boolean; shareRaw: string | null }) {
  const t = useT(nuz);
  const router = useRouter();
  const [run, setRun] = useState(initial);
  const runRef = useRef(run);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [canSave, setCanSave] = useState(true);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [tab, setTab] = useState<Tab>("routes");
  const [side, setSide] = useState<Side>("team");
  const [justCaught, setJustCaught] = useState<string | null>(null);
  const [importing, setImporting] = useState<Run | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [prefs, setPrefsState] = useState<Prefs>(() => (readOnly ? { onboarded: true } : loadStore().prefs));
  const filter: AreaFilter = prefs.filters?.[run.id] ?? "all";
  const doneToast = useCallback(() => setToast(null), []);

  const areaName = useMemo(() => new Map(allAreas(view).map((a) => [a.id, a.name])), [view]);
  const bossName = useMemo(() => new Map(allBosses(view).map((b) => [b.key, b])), [view]);
  const monName = useCallback((id: string) => {
    const m = getMon(runRef.current, id);
    return m ? displayName(m, view.mons[m.mon]) : "?";
  }, [view]);

  /** Every change goes through here: the run is replaced, saved, and (if asked) a toast offers Undo. */
  const commit = useCallback((next: Run, note?: { text: string; undo?: boolean }) => {
    const prev = runRef.current;
    if (next === prev) return;
    runRef.current = next;
    setRun(next);
    if (note) setToast({ id: Date.now(), text: note.text, ...(note.undo && { undo: () => ((runRef.current = prev), setRun(prev)) }) });
    // A later change can't be undone past: an older toast's Undo goes.
    else setToast((x) => (x?.undo ? null : x));
  }, []);

  useEffect(() => {
    if (!readOnly) setCanSave(saveRun(run));
  }, [run, readOnly]);
  // The same run changed in another tab: its newer copy wins.
  useEffect(() => {
    if (readOnly) return;
    const on = (e: StorageEvent) => {
      if (e.key !== STORE_KEY) return;
      const other = loadStore().runs[runRef.current.id];
      if (other && other.updatedAt > runRef.current.updatedAt) {
        runRef.current = other;
        setRun(other);
      }
    };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, [readOnly]);

  const act = useMemo<Act>(
    () => ({
      pick: (area: string, extra = false) => setDialog({ kind: "pick", area, extra }),
      caught(area: string, mon: string, kind: EncounterKind, shiny: boolean) {
        const { run: next, mon: m } = logCatch(runRef.current, { area, mon, kind, shiny });
        if (!m) return;
        commit(next);
        setJustCaught(m.id);
        setDialog(null);
      },
      failed(area: string, mon?: string) {
        commit(logFailed(runRef.current, area, mon), { text: t("toast.failed", { area: areaName.get(area) ?? area }), undo: true });
        setDialog(null);
      },
      skip(area: string) {
        commit(skipArea(runRef.current, area), { text: t("toast.skipped", { area: areaName.get(area) ?? area }), undo: true });
        setDialog(null);
      },
      reopen(area: string, thenPick = false) {
        commit(clearArea(runRef.current, area), { text: t("toast.reopened", { area: areaName.get(area) ?? area }), undo: true });
        if (thenPick) setDialog({ kind: "pick", area });
      },
      rename: (id: string, nick: string) => commit(rename(runRef.current, id, nick)),
      status(id: string, status: MonStatus) {
        const r = runRef.current;
        const m = getMon(r, id);
        if (!m || m.status === status) return;
        if (status === "dead") return setDialog({ kind: "death", mon: id });
        if (status === "team" && team(r).length >= 6) return setDialog({ kind: "swap", mon: id });
        const name = monName(id);
        commit(setStatus(r, id, status), { text: m.status === "dead" ? t("toast.revived", { name }) : status === "team" ? t("toast.toTeam", { name }) : t("toast.toBox", { name }), undo: true });
      },
      dead(id: string, death: Omit<Death, "at">) {
        const name = monName(id);
        commit(setStatus(runRef.current, id, "dead", death), { text: t("toast.dead", { name }), undo: true });
        setDialog(null);
      },
      swap(into: string, out: string) {
        const a = monName(into);
        const b = monName(out);
        commit(swap(runRef.current, into, out), { text: t("toast.swapped", { in: a, out: b }), undo: true });
        setDialog(null);
      },
      evolve(id: string, to: string) {
        const name = monName(id);
        commit(evolve(runRef.current, id, to), { text: t("toast.evolved", { name, species: view.mons[to]?.name ?? to }), undo: true });
      },
      level: (id: string, level: number | null) => commit(setLevel(runRef.current, id, level)),
      shiny: (id: string, on: boolean) => commit(setShiny(runRef.current, id, on)),
      remove(id: string) {
        const name = monName(id);
        commit(removeMon(runRef.current, id), { text: t("toast.removed", { name }), undo: true });
      },
      move: (id: string, to: number) => commit(moveInTeam(runRef.current, id, to)),
      boss(key: string) {
        const b = bossName.get(key);
        const was = runRef.current.beaten.includes(key);
        commit(toggleBoss(runRef.current, key), { text: was ? t("toast.notBeaten", { boss: b?.name ?? key }) : t("toast.beaten", { boss: b?.name ?? key }), undo: true });
      },
      badge(up: boolean) {
        const { run: next, boss } = (up ? addBadge : removeBadge)(runRef.current, view);
        if (next === runRef.current) return;
        commit(next, { text: boss?.badge ? t(up ? "toast.badge" : "toast.badgeOff", { badge: boss.badge }) : t("toast.badgeCount", { n: next.badges }), undo: true });
      },
      rules(rules: Rules) {
        commit(setRules(runRef.current, rules), { text: t("toast.rules") });
        setDialog(null);
      },
      renameRun: (name: string) => commit(renameRun(runRef.current, name)),
    }),
    [commit, t, areaName, bossName, monName, view]
  );

  const setAreaFilter = (f: AreaFilter) => {
    setPrefsState((p) => ({ ...p, filters: { ...p.filters, [run.id]: f } }));
    if (!readOnly) setFilter(run.id, f);
  };
  const dismissOnboarding = () => {
    setPrefsState((p) => ({ ...p, onboarded: true }));
    savePrefs({ onboarded: true });
  };
  const removeRun = () => {
    stashDeleted(runRef.current);
    deleteRun(runRef.current.id);
    router.push(TRACKER_PATH);
  };
  const saveCopy = () => {
    const copy = { ...runRef.current, id: newId(), updatedAt: Date.now() };
    if (!saveRun(copy)) handOff(copy);
    router.push(runPath(copy.id));
  };
  /** A backup file picked: a run already here (same id) asks first; any other opens. */
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const imported = importRun(await file.text());
    if (!imported) return setToast({ id: Date.now(), text: t("share.importBad") });
    if (loadStore().runs[imported.id]) setImporting(imported);
    else finishImport(imported);
  };
  const finishImport = (r: Run) => {
    setImporting(null);
    if (!saveRun(r)) handOff(r);
    if (r.id === runRef.current.id) {
      runRef.current = r;
      setRun(r);
      setToast({ id: Date.now(), text: t("share.imported", { name: r.name }) });
    } else router.push(runPath(r.id));
  };
  const openTeamBuilder = async () => {
    if (!view.teamFormat) return;
    const [{ createTeam }, { completeSet }] = await Promise.all([import("@/lib/battle/teams"), import("@/lib/battle/sets")]);
    const sets = team(runRef.current).map((m) => completeSet({ species: view.mons[m.mon]?.showdown ?? m.mon, name: m.nickname, ...(m.level && { level: m.level }), ...(m.shiny && { shiny: true }) }));
    const created = createTeam(view.teamFormat as Parameters<typeof createTeam>[0], runRef.current.name, sets);
    router.push(`/battle/teams?team=${encodeURIComponent(created.id)}`);
  };

  const tabs: { id: Tab; label: string; icon: typeof Route; n?: number }[] = [
    { id: "routes", label: t("panel.routes"), icon: Route },
    { id: "team", label: t("panel.team"), icon: Users, n: team(run).length },
    { id: "box", label: t("panel.box"), icon: Package, n: box(run).length },
    { id: "grave", label: t("panel.grave"), icon: Flower2, n: graveyard(run).length },
  ];
  const panelTab: Side = tab === "routes" ? side : tab;
  const picking = dialog?.kind === "pick" ? dialog : null;

  return (
    <div className="mx-auto max-w-[1360px]" data-testid="nz-run" data-run={run.id}>
      {readOnly && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-screen/30 bg-screen/[0.07] px-4 py-3" data-testid="nz-shared">
          <p className="text-[14.5px] font-semibold">{t("shared.banner")}</p>
          <div className="flex flex-wrap gap-2">
            <PillButton onClick={saveCopy} testId="nz-save-copy">
              <Copy className="h-4 w-4" aria-hidden /> {t("shared.saveCopy")}
            </PillButton>
            <Link href={TRACKER_PATH} className="inline-flex h-10 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:brightness-110 max-md:h-11">
              {t("shared.startOwn")}
            </Link>
          </div>
        </div>
      )}
      {!canSave && !readOnly && <p className="mb-4 rounded-2xl border border-[hsl(var(--warning)/0.4)] bg-[hsl(var(--warning)/0.08)] px-4 py-3 text-[14px]">{t("header.storageOff")}</p>}

      <RunHeader
        t={t}
        run={run}
        view={view}
        readOnly={readOnly}
        onRename={act.renameRun}
        onBadge={act.badge}
        onMenu={(id) => {
          if (id === "rules") setDialog({ kind: "rules" });
          else if (id === "share") setDialog({ kind: "share" });
          else if (id === "export") downloadBackup(runRef.current, t("share.exported"), (text) => setToast({ id: Date.now(), text }));
          else if (id === "import") fileRef.current?.click();
          else if (id === "badge-off") act.badge(false);
          else if (id === "delete") setDialog({ kind: "delete" });
        }}
      />

      <div className="mt-5 lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className={cn(tab !== "routes" && "max-lg:hidden")}>
          <RouteList
            t={t}
            run={run}
            view={view}
            readOnly={readOnly}
            filter={filter}
            onFilter={setAreaFilter}
            onboarding={!prefs.onboarded && !readOnly}
            onDismissOnboarding={dismissOnboarding}
            justCaught={justCaught}
            onCaughtShown={() => setJustCaught(null)}
            act={act}
          />
        </div>
        <aside className={cn("lg:sticky lg:top-[72px]", tab === "routes" && "max-lg:hidden")} aria-label={t("panel.label")}>
          <Panel
            t={t}
            run={run}
            view={view}
            readOnly={readOnly}
            tab={panelTab}
            onTab={(s) => {
              setSide(s);
              if (tab !== "routes") setTab(s);
            }}
            act={act}
            onTeamBuilder={view.teamFormat ? openTeamBuilder : undefined}
          />
        </aside>
      </div>

      {/* Phone: Routes, Team, Box and Graveyard along the bottom, above the site's tab bar. */}
      <nav data-nz-dock className="fixed inset-x-0 z-40 px-3 pb-2 lg:hidden" style={{ bottom: "var(--tabbar-h)" }} aria-label={t("panel.label")}>
        <div className="mx-auto grid max-w-lg grid-cols-4 gap-1 rounded-[22px] border border-foreground/[0.08] bg-card/95 p-1 shadow-[0_14px_40px_-12px_rgb(0_0_0/0.45)] backdrop-blur-xl">
          {tabs.map((x) => {
            const on = tab === x.id;
            const Icon = x.icon;
            return (
              <button
                key={x.id}
                type="button"
                onClick={() => {
                  setTab(x.id);
                  if (x.id !== "routes") setSide(x.id);
                  window.scrollTo({ top: 0 });
                }}
                aria-current={on ? "page" : undefined}
                className={cn("relative flex h-[52px] flex-col items-center justify-center gap-0.5 rounded-[18px] text-[11.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "bg-primary/[0.14] text-primary" : "text-muted-foreground")}
                data-testid={`nz-dock-${x.id}`}
              >
                <Icon className="h-5 w-5" strokeWidth={on ? 2.3 : 1.9} aria-hidden />
                {x.label}
                {!!x.n && <span className={cn("absolute right-2 top-1.5 min-w-[18px] rounded-full px-1 text-center text-[10.5px] font-bold leading-[18px]", on ? "bg-primary text-primary-foreground" : "bg-foreground/[0.1] text-foreground")}>{x.n}</span>}
              </button>
            );
          })}
        </div>
      </nav>

      {picking && <Picker key={picking.area} t={t} run={run} view={view} area={picking.area} extra={!!picking.extra} onClose={() => setDialog(null)} act={act} />}
      {dialog?.kind === "death" && getMon(run, dialog.mon) && <DeathDialog t={t} run={run} view={view} mon={getMon(run, dialog.mon)!} onClose={() => setDialog(null)} onConfirm={(d) => act.dead(dialog.mon, d)} />}
      {dialog?.kind === "swap" && getMon(run, dialog.mon) && <SwapDialog t={t} run={run} view={view} mon={getMon(run, dialog.mon)!} onClose={() => setDialog(null)} onSwap={(out) => act.swap(dialog.mon, out)} />}
      {dialog?.kind === "rules" && <RulesDialog t={t} rules={run.rules} readOnly={readOnly} onClose={() => setDialog(null)} onSave={act.rules} />}
      {dialog?.kind === "share" && <ShareDialog t={t} run={run} view={view} shareRaw={shareRaw} readOnly={readOnly} onClose={() => setDialog(null)} onToast={(text) => setToast({ id: Date.now(), text })} />}
      {dialog?.kind === "delete" && <DeleteDialog t={t} name={run.name} onClose={() => setDialog(null)} onDelete={removeRun} />}
      {importing && <ImportDialog t={t} name={importing.name} onClose={() => setImporting(null)} onReplace={() => finishImport(importing)} onKeepBoth={() => finishImport({ ...importing, id: newId() })} />}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
        data-testid="nz-import-file"
      />
      <Toast toast={toast} undoLabel={t("toast.undo")} onDone={doneToast} />
    </div>
  );
}
