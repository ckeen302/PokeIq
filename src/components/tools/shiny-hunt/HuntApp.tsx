"use client";

import "../tier-list/tier-list.css";
import "./hunt.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Sparkles } from "lucide-react";
import { useT } from "@/i18n/client";
import counter from "@/messages/shiny-counter";
import {
  STORAGE_KEY,
  activeHunts,
  addPhase,
  archive,
  createHunt,
  loadState,
  markFound,
  removeHunt,
  rename,
  reopen,
  saveState,
  trophies,
  unarchive,
  upsert,
  type Hunt,
  type HuntsState,
} from "@/lib/shiny-hunt/store";
import { cn } from "@/lib/utils";
import { Modal, PillButton } from "../tier-list/ui";
import { MonArt, Twinkles } from "./Art";
import { Celebrate } from "./Celebrate";
import { Counter } from "./Counter";
import { HuntsView, TrophiesView, type HuntAction } from "./Lists";
import { useNames, type Names } from "./names";
import { Picker } from "./Picker";
import { ShareDialog } from "./ShareDialog";

type Tab = "counter" | "hunts" | "trophies";
type Dialog =
  | { kind: "pick"; purpose: "new" | "change" }
  | { kind: "found"; step: "ask" | "which" }
  | { kind: "rename"; id: string }
  | { kind: "delete"; id: string }
  | { kind: "share"; id: string }
  | { kind: "celebrate"; id: string }
  | null;

/**
 * The Shiny Hunt Counter: the hunts saved in this browser, the counter for the current one, the hunts list and the
 * trophy case, and the dialogs between them. Every change goes through lib/shiny-hunt/store and is saved at once.
 */
export default function HuntApp() {
  const t = useT(counter);
  const names = useNames();
  const [state, setState] = useState<HuntsState>(() => loadState());
  const [canSave, setCanSave] = useState(true);
  const [tab, setTab] = useState<Tab>("counter");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [visit, setVisit] = useState<Record<string, number>>({});
  const fromStorage = useRef(false);

  // Saved on every change; another tab's changes come in through the storage event.
  useEffect(() => {
    if (fromStorage.current) {
      fromStorage.current = false;
      return;
    }
    setCanSave(saveState(state));
  }, [state]);
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      fromStorage.current = true;
      setState(loadState());
    };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);

  const active = activeHunts(state);
  const current = state.hunts.find((h) => h.id === state.current && h.status === "active") ?? active[0] ?? null;
  const huntById = (id: string) => state.hunts.find((h) => h.id === id) ?? null;

  const stateRef = useRef(state);
  stateRef.current = state;
  const put = useCallback((h: Hunt, makeCurrent = false) => {
    const prev = stateRef.current.hunts.find((x) => x.id === h.id);
    if (prev && prev.count !== h.count) setVisit((v) => ({ ...v, [h.id]: Math.max(0, (v[h.id] ?? 0) + h.count - prev.count) }));
    setState((s) => {
      const next = upsert(s, h);
      return makeCurrent ? { ...next, current: h.id } : next;
    });
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((m) => (m === msg ? null : m)), 2600);
  };

  const startHunt = (species: number) => {
    const last = current ?? state.hunts[0];
    const h = createHunt(species, last?.game ?? "sv", Date.now(), last ? { charm: last.charm, method: last.method } : undefined);
    setState((s) => ({ ...upsert(s, h), current: h.id }));
    setTab("counter");
    setDialog(null);
  };

  const onPick = (id: number) => {
    if (dialog?.kind === "pick" && dialog.purpose === "change" && current) {
      put({ ...current, species: id, updatedAt: Date.now() });
      setDialog(null);
    } else startHunt(id);
  };

  const onAction = (a: HuntAction, h: Hunt) => {
    if (a === "open") {
      if (h.status === "found") return setDialog({ kind: "celebrate", id: h.id });
      const next = h.status === "archived" ? unarchive(h) : h;
      put(next, true);
      setTab("counter");
    } else if (a === "rename") setDialog({ kind: "rename", id: h.id });
    else if (a === "delete") setDialog({ kind: "delete", id: h.id });
    else if (a === "share") setDialog({ kind: "share", id: h.id });
    else if (a === "archive") put(archive(h));
    else if (a === "unarchive") put(unarchive(h));
  };

  const found = (target: boolean, other: number | null = null) => {
    if (!current) return;
    if (target) {
      put(markFound(current));
      setDialog({ kind: "celebrate", id: current.id });
    } else {
      put(addPhase(current, other));
      setDialog(null);
      showToast(t("found.phaseSaved", { n: current.phases.length + 1 }));
    }
  };

  const setPref = (k: "sound" | "haptics", v: boolean) => setState((s) => ({ ...s, prefs: { ...s.prefs, [k]: v } }));

  const nTrophies = trophies(state).length;
  const tabs: { id: Tab; label: string; n?: number }[] = [
    { id: "counter", label: t("tabs.counter") },
    { id: "hunts", label: t("tabs.hunts"), n: active.length },
    { id: "trophies", label: t("tabs.trophies"), n: nTrophies },
  ];

  const celebrated = dialog?.kind === "celebrate" ? huntById(dialog.id) : null;
  const sharing = dialog?.kind === "share" ? huntById(dialog.id) : null;
  const renaming = dialog?.kind === "rename" ? huntById(dialog.id) : null;
  const deleting = dialog?.kind === "delete" ? huntById(dialog.id) : null;

  return (
    <div className="mt-6 max-sm:mt-4" data-testid="sh-app" data-ready={names.ready ? "1" : "0"}>
      {/* Tabs and the tap preferences */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <div role="tablist" aria-label={t("tabs.label")} className="sh-noscroll -mx-1 flex min-w-0 gap-1 overflow-x-auto px-1">
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={tab === x.id}
              aria-controls={`sh-panel-${x.id}`}
              id={`sh-tab-${x.id}`}
              onClick={() => setTab(x.id)}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:px-3.5",
                tab === x.id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
              )}
              data-testid={`sh-tab-${x.id}`}
            >
              {x.label}
              {!!x.n && <span className={cn("sh-num rounded-full px-1.5 text-[12px]", tab === x.id ? "bg-background/20" : "bg-foreground/[0.08]")}>{x.n}</span>}
            </button>
          ))}
        </div>
      </div>

      {!canSave && <p className="mb-4 rounded-2xl border border-[hsl(var(--warning)/0.4)] bg-[hsl(var(--warning)/0.08)] px-4 py-3 text-[14px]">{t("storageOff")}</p>}

      <div role="tabpanel" id={`sh-panel-${tab}`} aria-labelledby={`sh-tab-${tab}`}>
        {tab === "counter" &&
          (current ? (
            <Counter
              hunt={current}
              names={names}
              prefs={state.prefs}
              visit={visit[current.id] ?? 0}
              onChange={(h) => put(h)}
              onFound={() => setDialog({ kind: "found", step: "ask" })}
              onShare={() => setDialog({ kind: "share", id: current.id })}
              onChangeTarget={() => setDialog({ kind: "pick", purpose: "change" })}
              onPref={setPref}
            />
          ) : (
            <Start names={names} onPick={startHunt} />
          ))}
        {tab === "hunts" && <HuntsView state={state} names={names} onNew={() => setDialog({ kind: "pick", purpose: "new" })} onAction={onAction} />}
        {tab === "trophies" && <TrophiesView state={state} names={names} onOpen={(h) => setDialog({ kind: "celebrate", id: h.id })} />}
      </div>

      {dialog?.kind === "pick" && (
        <Modal title={dialog.purpose === "new" ? t("hunts.pickTitle") : t("picker.title")} onClose={() => setDialog(null)} closeLabel={t("close")} wide testId="sh-pick-dialog">
          <Picker names={names} current={dialog.purpose === "change" ? current?.species : undefined} onPick={onPick} className="h-[min(560px,64dvh)]" />
        </Modal>
      )}

      {dialog?.kind === "found" && current && (
        <Modal title={dialog.step === "ask" ? t("found.title") : t("found.which")} onClose={() => setDialog(null)} closeLabel={t("close")} wide={dialog.step === "which"} testId="sh-found-dialog">
          {dialog.step === "ask" ? (
            <div className="grid gap-3">
              <button type="button" onClick={() => found(true)} className="flex items-center gap-4 rounded-[22px] border border-[hsl(var(--warning)/0.45)] bg-[hsl(var(--warning)/0.08)] p-4 text-left transition-colors hover:bg-[hsl(var(--warning)/0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--warning))]" data-testid="sh-found-target">
                <span className="relative h-16 w-16 shrink-0">
                  <MonArt id={current.species} shiny size="sm" className="h-full w-full" />
                </span>
                <span>
                  <span className="block text-[16px] font-bold">{t("found.target")}</span>
                  <span className="mt-0.5 block text-[14px] text-muted-foreground">{t("found.targetHint", { name: names.name(current.species) })}</span>
                </span>
              </button>
              <button type="button" onClick={() => setDialog({ kind: "found", step: "which" })} className="flex items-center gap-4 rounded-[22px] border border-foreground/[0.1] p-4 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="sh-found-other">
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                  <Sparkles className="h-7 w-7 text-primary" aria-hidden />
                </span>
                <span>
                  <span className="block text-[16px] font-bold">{t("found.other")}</span>
                  <span className="mt-0.5 block text-[14px] text-muted-foreground">{t("found.otherHint")}</span>
                </span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <PillButton onClick={() => setDialog({ kind: "found", step: "ask" })}>
                  <ArrowLeft className="h-4 w-4" aria-hidden /> {t("found.back")}
                </PillButton>
                <PillButton onClick={() => found(false)} testId="sh-phase-skip">
                  {t("found.skip")}
                </PillButton>
              </div>
              <Picker names={names} shiny onPick={(id) => found(false, id)} className="h-[min(520px,58dvh)]" testId="sh-phase-picker" />
            </div>
          )}
        </Modal>
      )}

      {renaming && <RenameDialog hunt={renaming} placeholder={t("hunts.renamePlaceholder", { name: names.name(renaming.species) })} onClose={() => setDialog(null)} onSave={(name) => { put(rename(renaming, name)); setDialog(null); }} />}

      {deleting && (
        <Modal title={t("hunts.deleteTitle")} onClose={() => setDialog(null)} closeLabel={t("close")} testId="sh-delete-dialog">
          <p className="text-[15px] leading-relaxed text-muted-foreground">{t("hunts.deleteBody", { name: deleting.name || names.name(deleting.species), n: deleting.count })}</p>
          <div className="mt-6 flex justify-end gap-2">
            <PillButton onClick={() => setDialog(null)}>{t("hunts.cancel")}</PillButton>
            <button type="button" onClick={() => { setState((s) => removeHunt(s, deleting.id)); setDialog(null); }} className="inline-flex h-10 items-center rounded-full bg-destructive px-5 text-sm font-semibold text-destructive-foreground hover:brightness-110 max-md:h-11" data-testid="sh-delete-confirm">
              {t("hunts.delete")}
            </button>
          </div>
        </Modal>
      )}

      {sharing && <ShareDialog hunt={sharing} names={names} onClose={() => setDialog(null)} />}

      {celebrated && (
        <Celebrate
          hunt={celebrated}
          names={names}
          sound={state.prefs.sound}
          onClose={() => setDialog(null)}
          onShare={() => setDialog({ kind: "share", id: celebrated.id })}
          onTrophies={() => {
            setTab("trophies");
            setDialog(null);
          }}
          onNew={() => {
            setTab("counter");
            setDialog({ kind: "pick", purpose: "new" });
          }}
          onUndo={() => {
            put(reopen(celebrated), true);
            setTab("counter");
            setDialog(null);
          }}
        />
      )}

      <Toast message={toast} />
    </div>
  );
}

/** No hunt yet: the target picker, front and centre. */
function Start({ names, onPick }: { names: Names; onPick(id: number): void }) {
  const t = useT(counter);
  return (
    <section className="sh-stage overflow-hidden rounded-[28px] border border-foreground/[0.08] p-5 sm:p-8" data-testid="sh-start">
      <div className="flex items-center gap-5 max-sm:flex-col max-sm:items-start max-sm:gap-3">
        <span className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--warning)/0.12)] max-sm:h-16 max-sm:w-16">
          <Sparkles className="h-9 w-9 text-[hsl(var(--warning))] max-sm:h-7 max-sm:w-7" aria-hidden />
          <Twinkles scale={0.8} />
        </span>
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.2em] text-[hsl(var(--warning))]">{t("start.eyebrow")}</p>
          <h2 className="mt-1 font-display text-[26px] font-semibold leading-tight tracking-tight sm:text-[30px]">{t("start.title")}</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">{t("start.subtitle")}</p>
        </div>
      </div>
      <Picker names={names} onPick={onPick} autoFocus={false} className="mt-6 h-[min(520px,60svh)]" />
    </section>
  );
}

function RenameDialog({ hunt, placeholder, onClose, onSave }: { hunt: Hunt; placeholder: string; onClose(): void; onSave(name: string): void }) {
  const t = useT(counter);
  const [name, setName] = useState(hunt.name);
  return (
    <Modal title={t("hunts.renameTitle")} onClose={onClose} closeLabel={t("close")} testId="sh-rename-dialog">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(name);
        }}
      >
        <label className="block space-y-2">
          <span className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{t("hunts.renameLabel")}</span>
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} placeholder={placeholder} maxLength={40} className="h-12 w-full rounded-xl border border-foreground/[0.1] bg-background px-3 text-[16px] outline-none focus:border-primary/60" data-testid="sh-rename-input" />
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <PillButton onClick={onClose}>{t("hunts.cancel")}</PillButton>
          <PillButton primary type="submit" testId="sh-rename-save">
            {t("hunts.save")}
          </PillButton>
        </div>
      </form>
    </Modal>
  );
}

function Toast({ message }: { message: string | null }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const el = useMemo(
    () => (
      <div className="pointer-events-none fixed inset-x-0 z-[85] flex justify-center px-4 max-lg:bottom-[calc(var(--tabbar-h)+108px)] lg:bottom-8" role="status" aria-live="polite">
        {message && <div className="tlm-rise rounded-full bg-foreground px-5 py-3 text-[14px] font-semibold text-background shadow-xl" data-testid="sh-toast">{message}</div>}
      </div>
    ),
    [message]
  );
  return mounted ? createPortal(el, document.body) : null;
}
