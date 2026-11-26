"use client";

import "./tier-list.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Download, Keyboard, Plus, Redo2, RotateCcw, Share2, Sparkles, Undo2, Check, Copy, Type } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { localUrl } from "@/i18n/paths";
import { useRouter } from "@/i18n/navigation";
import tierList from "@/messages/tier-list";
import { getTemplate, type Template } from "@/lib/tier-list/templates";
import type { Mon, Roster } from "@/lib/tier-list/types";
import { decodeShare, encodeShare, makeCodec, type Codec } from "@/lib/tier-list/share";
import {
  MAX_TILE, MIN_TILE, MODES, addRow, blindReset, clearTiers, commit, historyOf, initialState, moveRow, moveToTier, placedInTiers, poolKeys, prune, redo, removeRow, replace, topAdd, topLength, topRemove, undo, updateRow,
  TOP_LENGTHS, type History, type Mode, type ToolState, type TopLength,
} from "@/lib/tier-list/state";
import { seedEntrants, clampPicks } from "@/lib/tier-list/bracket";
import { blindDraw, place as blindPlace, isDone } from "@/lib/tier-list/blind";
import { newSeed } from "@/lib/tier-list/rng";
import { artUrl, isPixelUrl } from "@/lib/tier-list/art";
import { useDragDrop, type DragStart, type DropAt } from "./dnd";
import { Pool, type PoolHandle } from "./Pool";
import { TierBoard } from "./TierBoard";
import { TopMode } from "./TopMode";
import { BracketMode } from "./BracketMode";
import { BlindMode } from "./BlindMode";
import { ExportDialog } from "./ExportDialog";
import { TemplateGrid } from "./TemplateGrid";
import { IconButton, Modal, PillButton, Segmented } from "./ui";
import { modeName, modeNoun, templateName } from "./names";

const STORE = "pokeiq-tier-list:v1:";
export const LAST_KEY = "pokeiq-tier-list:last";

function readSaved(template: string): ToolState | null {
  try {
    const raw = localStorage.getItem(STORE + template);
    if (!raw) return null;
    const s = JSON.parse(raw) as ToolState;
    if (!s || s.template !== template || !s.tier?.rows) return null;
    return { ...initialState(template), ...s };
  } catch {
    return null;
  }
}

function writeSaved(s: ToolState) {
  try {
    localStorage.setItem(STORE + s.template, JSON.stringify(s));
    localStorage.setItem(LAST_KEY, s.template);
  } catch {
    /* storage full or blocked: the work stays on screen */
  }
}

function useMedia(query: string) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    const f = () => setOn(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [query]);
  return on;
}

function useLightTheme() {
  const [light, setLight] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const f = () => setLight(el.classList.contains("light"));
    f();
    const mo = new MutationObserver(f);
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return light;
}

export interface AppProps {
  roster: Roster;
  template: string;
  shared: string | null;
}

/** The Tier List Maker itself, for one template: the four modes over its pool, saved as you go. */
export default function TierListApp({ roster, template, shared }: AppProps) {
  const t = useT(tierList);
  const router = useRouter();
  const tpl = getTemplate(template) as Template;
  const mons = roster.mons;
  const byKey = useMemo(() => new Map(mons.map((m) => [m.k, m])), [mons]);
  const codec = useMemo<Codec>(() => makeCodec(mons), [mons]);
  const phone = useMedia("(max-width: 767px)");
  const coarse = useMedia("(pointer: coarse)");
  const light = useLightTheme();

  // ---- State: the shared link's result, else this template's saved work, else a fresh start.
  const [boot] = useState(() => {
    const fromLink = shared ? decodeShare(shared, codec) : null;
    const saved = readSaved(template);
    let state = fromLink && fromLink.template === template ? fromLink : saved ?? initialState(template);
    let challenge = false;
    // A blind ranking link is a challenge: the sender's run becomes the one to compare with, and the draw is replayed.
    if (fromLink && fromLink.mode === "blind" && isDone(fromLink.blind.slots) && !fromLink.blind.vs) {
      state = { ...fromLink, blind: { ...fromLink.blind, vs: { name: fromLink.blind.name ?? "", slots: fromLink.blind.slots }, slots: fromLink.blind.slots.map(() => -1), name: saved?.blind.name } };
      challenge = true;
    }
    return { state, viaLink: !!fromLink && fromLink.template === template, badLink: !!shared && !fromLink, hadSaved: !!saved, challenge };
  });
  const [hist, setHist] = useState<History>(() => historyOf(boot.state));
  const s = hist.present;
  const [viaLink, setViaLink] = useState(boot.viaLink);
  const [challenge, setChallenge] = useState(boot.challenge);
  const dirty = useRef(!boot.viaLink);
  const [toast, setToast] = useState<string | null>(boot.badLink ? t("share.badLink") : null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);
  useEffect(() => {
    if (boot.badLink) toastTimer.current = setTimeout(() => setToast(null), 3600);
    // The link has done its job: the address goes back to the template's own page.
    if (shared) window.history.replaceState(null, "", window.location.pathname);
  }, [boot.badLink, shared]);

  const pool = useMemo(() => poolKeys(s, mons), [s, mons]);
  // Keep every mode to the pool (a removed Pokémon leaves the tiers too).
  useEffect(() => {
    const next = prune(s, pool);
    if (next.tier !== s.tier || next.top !== s.top) setHist((h) => replace(h, next));
  }, [pool, s]);

  // Typing (a title, a caption, a tier's name) is one undo step: the state from before the typing began.
  const editSnap = useRef<ToolState | null>(null);
  const editStart = useCallback(() => {
    setHist((h) => ((editSnap.current = h.present), h));
  }, []);
  const editEnd = useCallback(() => {
    const before = editSnap.current;
    editSnap.current = null;
    setHist((h) => (before && before !== h.present ? { past: [...h.past, before].slice(-120), present: h.present, future: [] } : h));
  }, []);

  const change = useCallback((fn: (s: ToolState) => ToolState, record = true) => {
    dirty.current = true;
    setHist((h) => (record ? commit(h, fn(h.present)) : replace(h, fn(h.present))));
  }, []);

  // Autosave (after the first change when the page opened from a link: a shared list isn't saved over yours unless you edit it).
  useEffect(() => {
    if (!dirty.current) return;
    const id = setTimeout(() => writeSaved(s), 250);
    return () => clearTimeout(id);
  }, [s]);
  useEffect(() => {
    try {
      localStorage.setItem(LAST_KEY, template);
    } catch {
      /* fine */
    }
  }, [template]);

  // ---- Derived per mode.
  const placed = useMemo(() => placedInTiers(s), [s]);
  const tierPool = useMemo(() => pool.filter((k) => !placed.has(k)).map((k) => byKey.get(k)!).filter(Boolean), [pool, placed, byKey]);
  const topSet = useMemo(() => new Set(s.top.items), [s.top.items]);
  const topPool = useMemo(() => pool.filter((k) => !topSet.has(k)).map((k) => byKey.get(k)!).filter(Boolean), [pool, topSet, byKey]);
  const entrants = useMemo(() => {
    const src = pool.map((k) => byKey.get(k)!).filter(Boolean);
    return seedEntrants(src, s.bracket.size, s.bracket.seeding, s.bracket.seed, s.bracket.manual);
  }, [pool, byKey, s.bracket.size, s.bracket.seeding, s.bracket.seed, s.bracket.manual]);
  const everySpecies = useMemo(() => mons.filter((m) => !m.f).map((m) => m.k), [mons]);
  const drawn = useMemo(() => blindDraw(s.blind.source === "random" ? everySpecies : pool, s.blind.length, s.blind.seed), [s.blind.source, s.blind.length, s.blind.seed, everySpecies, pool]);

  const title = s.title || templateName(t, tpl);
  const subtitle = s.title ? templateName(t, tpl) : "";
  const tile = phone ? Math.max(48, Math.round(s.tileSize * 0.72)) : s.tileSize;
  const poolTile = phone ? Math.min(tile, 60) : Math.min(tile, 84);
  const [names, setNames] = useState(false);

  // ---- Selection (click, shift-click) and tap-then-tap placement.
  const [selected, setSelected] = useState<string[]>([]);
  const selSet = useMemo(() => new Set(selected), [selected]);
  const [moving, setMoving] = useState<ReadonlySet<string>>(new Set());
  const [poolOpen, setPoolOpen] = useState(true);
  useEffect(() => setSelected([]), [s.mode]);

  const orderOf = useCallback(
    (keys: string[]) => {
      const pos = new Map<string, number>();
      s.tier.rows.forEach((r, i) => r.items.forEach((k, j) => pos.set(k, i * 10000 + j)));
      pool.forEach((k, i) => !pos.has(k) && pos.set(k, 1e8 + i));
      return [...keys].sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0));
    },
    [s.tier.rows, pool]
  );

  const sendTo = useCallback(
    (rowId: string | null, keys = selected) => {
      if (!keys.length) return;
      change((st) => moveToTier(st, orderOf(keys), rowId));
      setSelected([]);
    },
    [selected, change, orderOf]
  );

  const dnd = useDragDrop({
    begin(key, from, el): DragStart | null {
      const m = byKey.get(key);
      if (!m) return null;
      const group = s.mode === "tier" && selSet.has(key) && selected.length > 1 ? orderOf(selected) : [key];
      const src = artUrl(m, s.art, s.shiny);
      void from;
      return { keys: group, from, src, pixel: isPixelUrl(src), size: Math.round(el.getBoundingClientRect().width) };
    },
    drop(d, at: DropAt) {
      const { zone, index } = at;
      if (s.mode === "tier") {
        if (zone === "pool") change((st) => moveToTier(st, d.keys, null));
        else if (zone.startsWith("row:")) change((st) => moveToTier(st, d.keys, zone.slice(4), index));
        setSelected([]);
      } else if (s.mode === "top") {
        const key = d.keys[0];
        if (zone === "pool") change((st) => topRemove(st, key));
        else if (zone.startsWith("top@")) {
          const i = Number(zone.slice(4));
          change((st) => {
            const cur = st.top.items;
            const filled = cur.filter((k) => k !== key);
            const at = Math.min(i, filled.length);
            if (!cur.includes(key) && cur.length >= st.top.length) {
              // A full list: the new one takes the slot, the last one drops off.
              const items = filled.slice();
              items.splice(at, 0, key);
              return { ...st, top: { ...st.top, items: items.slice(0, st.top.length) } };
            }
            return topAdd(st, key, at);
          });
        }
      } else if (s.mode === "bracket" && zone === "seeds") {
        const order = entrants.filter((k) => k !== d.keys[0]);
        const from = entrants.indexOf(d.keys[0]);
        const i = index > from ? index - 1 : index;
        order.splice(Math.max(0, Math.min(order.length, i)), 0, d.keys[0]);
        change((st) => ({ ...st, bracket: { ...st.bracket, manual: order, picks: [] } }));
      }
    },
    onActive(d) {
      setMoving(new Set(d?.keys ?? []));
    },
  });

  const onTileClick = useCallback(
    (e: React.MouseEvent<HTMLElement>, key: string, from: string) => {
      if (dnd.wasDrag()) return;
      if (s.mode === "top") {
        if (from === "pool") {
          if (s.top.items.length >= s.top.length) say(t("top.full"));
          else change((st) => topAdd(st, key));
        }
        return;
      }
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        setSelected((sel) => (sel.includes(key) ? sel.filter((k) => k !== key) : [...sel, key]));
        return;
      }
      setSelected((sel) => (sel.length === 1 && sel[0] === key ? [] : coarse && sel.length && !sel.includes(key) && from === "pool" ? [...sel, key] : [key]));
    },
    [dnd, s.mode, s.top.items.length, s.top.length, change, say, t, coarse]
  );
  const onTileDouble = useCallback(
    (key: string, from: string) => {
      if (from.startsWith("row:")) change((st) => moveToTier(st, [key], null));
      setSelected([]);
    },
    [change]
  );

  // ---- Keyboard.
  const poolRef = useRef<PoolHandle>(null);
  const [dialog, setDialog] = useState<null | "templates" | "share" | "export" | "add" | "keys" | "reset">(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && (e.key === "z" || e.key === "Z" || e.key === "y")) {
        if (typing) return;
        e.preventDefault();
        setHist((h) => (e.key === "y" || e.shiftKey ? redo(h) : undo(h)));
        setSelected([]);
        return;
      }
      if (typing || mod || e.altKey || dialog) return;
      if (e.key === "/" && (s.mode === "tier" || s.mode === "top")) {
        e.preventDefault();
        setPoolOpen(true);
        setTimeout(() => poolRef.current?.focusSearch(), 0);
        return;
      }
      if (s.mode !== "tier") return;
      if (e.key === "Escape") setSelected([]);
      else if ((e.key === "Backspace" || e.key === "Delete") && selected.length) {
        e.preventDefault();
        sendTo(null);
      } else if (/^[1-9]$/.test(e.key) && selected.length) {
        const row = s.tier.rows[Number(e.key) - 1];
        if (row) {
          e.preventDefault();
          sendTo(row.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, s.mode, s.tier.rows, selected, sendTo]);

  // ---- Template switch (each template has its own page and its own saved work).
  const goTemplate = (slug: string) => {
    setDialog(null);
    if (slug !== template) router.push(`/tools/tier-list/${slug}`);
  };

  // ---- Share.
  const shareUrl = useCallback((st: ToolState) => `${window.location.origin}${localUrl(`/tools/tier-list/${st.template}?s=${encodeShare(st, codec)}`)}`, [codec]);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  const backToMine = () => {
    const mine = readSaved(template) ?? initialState(template);
    setHist(historyOf(mine));
    setViaLink(false);
    setChallenge(false);
    dirty.current = true;
  };

  // ---- Render.
  const showPool = s.mode === "tier" || s.mode === "top";
  const poolMons = s.mode === "top" ? topPool : tierPool;
  const placingHint = coarse && s.mode === "tier" && selected.length > 0;
  const modeOptions = MODES.map((m) => ({
    value: m,
    label: m === "blind" ? (<><span className="max-sm:hidden">{modeName(t, m, s.top.length)}</span><span className="sm:hidden">{t("modes.blindShort")}</span></>) : modeName(t, m, s.top.length),
    testId: `mode-${m}`,
  }));
  const resetMode = () => {
    change((st) => {
      if (st.mode === "tier") return clearTiers(st);
      if (st.mode === "top") return { ...st, top: { ...st.top, items: [], captions: {} } };
      if (st.mode === "bracket") return { ...st, bracket: { ...st.bracket, picks: [], started: false } };
      return blindReset(st, { seed: newSeed() });
    });
    setDialog(null);
  };

  return (
    <div className="tlm-app" data-testid="tier-list-app" data-mode={s.mode} data-template={template}>
      {/* Header: the title (editable) and the template; the tools; share and download. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <div className="min-w-0 flex-1">
          <input
            value={s.title}
            onFocus={editStart}
            onChange={(e) => change((st) => ({ ...st, title: e.target.value.slice(0, 80) }), false)}
            onBlur={editEnd}
            placeholder={templateName(t, tpl)}
            aria-label={t("bar.titleLabel")}
            className="w-full min-w-0 truncate bg-transparent font-display text-[32px] font-bold leading-tight tracking-tight outline-none placeholder:text-foreground focus:placeholder:text-muted-foreground/60 max-sm:text-[22px]"
            maxLength={80}
            data-testid="tl-title"
          />
          <button type="button" onClick={() => setDialog("templates")} className="mt-0.5 inline-flex items-center gap-1 rounded-full text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground max-sm:text-[13px]" data-testid="tl-template">
            {t("bar.template", { name: templateName(t, tpl) })} <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
        <div className="order-3 flex w-full items-center justify-between gap-1.5 sm:order-2 sm:w-auto sm:justify-end">
          <Segmented size="sm" label={t("bar.art")} value={s.art} onChange={(v) => change((st) => ({ ...st, art: v }), false)} options={[{ value: "hd", label: t("bar.hd"), testId: "art-hd" }, { value: "pixel", label: t("bar.pixel"), testId: "art-pixel" }]} />
          <span className="flex items-center gap-0.5 sm:gap-1.5">
            <IconButton label={t("bar.shiny")} active={s.shiny} aria-pressed={s.shiny} onClick={() => change((st) => ({ ...st, shiny: !st.shiny }), false)} testId="shiny-toggle">
              <Sparkles className={cn("h-[18px] w-[18px]", s.shiny && "text-[hsl(var(--warning))]")} aria-hidden />
            </IconButton>
            <span className="mx-1 h-6 w-px bg-foreground/10 max-sm:hidden" aria-hidden />
            <IconButton label={t("bar.undo")} onClick={() => setHist(undo)} disabled={!hist.past.length} testId="undo">
              <Undo2 className="h-[18px] w-[18px]" aria-hidden />
            </IconButton>
            <IconButton label={t("bar.redo")} onClick={() => setHist(redo)} disabled={!hist.future.length} testId="redo">
              <Redo2 className="h-[18px] w-[18px]" aria-hidden />
            </IconButton>
            <IconButton label={t("bar.reset")} onClick={() => setDialog("reset")} testId="reset">
              <RotateCcw className="h-[17px] w-[17px]" aria-hidden />
            </IconButton>
            <IconButton label={t("bar.shortcuts")} onClick={() => setDialog("keys")} className="max-lg:hidden">
              <Keyboard className="h-[18px] w-[18px]" aria-hidden />
            </IconButton>
          </span>
        </div>
        <div className="order-2 flex gap-1.5 sm:order-3">
          <PillButton onClick={() => setDialog("share")} testId="share" className="max-sm:w-11 max-sm:px-0">
            <Share2 className="h-4 w-4" aria-hidden /> <span className="max-sm:sr-only">{t("bar.share")}</span>
          </PillButton>
          <PillButton primary onClick={() => setDialog("export")} testId="export" className="max-sm:w-11 max-sm:px-0">
            <Download className="h-4 w-4" aria-hidden /> <span className="max-sm:sr-only">{t("bar.export")}</span>
          </PillButton>
        </div>
      </div>

      {/* The mode switch. */}
      <div className="tlm-scroll -mx-1 mt-4 overflow-x-auto px-1 pb-1">
        <Segmented label={t("modes.label")} value={s.mode} onChange={(m: Mode) => change((st) => ({ ...st, mode: m }), false)} options={modeOptions} className="max-sm:flex max-sm:w-full" testId="mode-switch" />
      </div>

      {viaLink && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-screen/[0.08] px-4 py-2.5 text-sm" data-testid="shared-banner">
          <span>{t("share.sharedBanner", { mode: modeNoun(t, s.mode, s.top.length) })}</span>
          {boot.hadSaved && (
            <button type="button" onClick={backToMine} className="font-semibold text-screen hover:underline">
              {t("share.backToMine")}
            </button>
          )}
        </div>
      )}

      {/* The workspace: the mode on the left, the pool on the right (a drawer on phones). */}
      <div
        className={cn(
          "mt-4 grid gap-4",
          showPool ? "lg:h-[calc(100dvh-236px)] lg:min-h-[560px] lg:grid-cols-[minmax(0,1fr)_minmax(300px,400px)] xl:grid-cols-[minmax(0,1fr)_420px]" : ""
        )}
      >
        <section
          className={cn("min-w-0", showPool && "tlm-scroll lg:overflow-y-auto lg:pr-1")}
          data-scroll={showPool ? "" : undefined}
          data-testid="tl-stage"
        >
          {s.mode === "tier" && (
            <>
              <div className="mb-2 flex items-center justify-end gap-3 max-sm:justify-between">
                <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <span className="max-sm:sr-only">{t("bar.tileSize")}</span>
                  <input
                    type="range"
                    min={MIN_TILE}
                    max={MAX_TILE}
                    step={4}
                    value={s.tileSize}
                    onChange={(e) => change((st) => ({ ...st, tileSize: Number(e.target.value) }), false)}
                    aria-label={t("bar.tileSize")}
                    className="w-32 accent-[hsl(var(--primary))]"
                    data-testid="tile-size"
                  />
                </label>
                <button type="button" aria-pressed={names} onClick={() => setNames((v) => !v)} className={cn("flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium max-md:h-10 text-muted-foreground hover:text-foreground", names && "bg-foreground/[0.07] text-foreground")}>
                  <Type className="h-3.5 w-3.5" aria-hidden /> {t("bar.names")}
                </button>
              </div>
              <TierBoard
                rows={s.tier.rows}
                byKey={byKey}
                art={s.art}
                shiny={s.shiny}
                tile={tile}
                names={names}
                selected={selSet}
                moving={moving}
                placing={selected.length > 0}
                onTileDown={dnd.onPointerDown}
                onTileClick={onTileClick}
                onTileDouble={onTileDouble}
                onPlace={(id) => sendTo(id)}
                onRename={(id, v) => change((st) => updateRow(st, id, { label: v }), false)}
                onRenameStart={editStart}
                onRenameEnd={editEnd}
                onColor={(id, c) => change((st) => updateRow(st, id, { color: c }))}
                onMove={(id, d) => change((st) => moveRow(st, id, d))}
                onAdd={(id, before) => change((st) => addRow(st, id, before))}
                onRemove={(id) => change((st) => removeRow(st, id))}
                onClear={(id) => change((st) => moveToTier(st, st.tier.rows.find((r) => r.id === id)?.items ?? [], null))}
              />
              <p className="mt-3 text-center text-[13px] text-muted-foreground max-lg:hidden">{t("pool.dragHint")}</p>
            </>
          )}
          {s.mode === "top" && (
            <>
              <div className="mb-3 flex items-center gap-3">
                <Segmented size="sm" label={t("top.length")} value={s.top.length} onChange={(n: TopLength) => change((st) => topLength(st, n))} options={TOP_LENGTHS.map((n) => ({ value: n, label: t("top.lengthN", { n }), testId: `top-length-${n}` }))} />
              </div>
              <TopMode
                top={s.top}
                byKey={byKey}
                art={s.art}
                shiny={s.shiny}
                moving={moving}
                onTileDown={dnd.onPointerDown}
                onRemove={(k) => change((st) => topRemove(st, k))}
                onMove={(k, to) => change((st) => topAdd(st, k, Math.max(0, to)))}
                onCaption={(k, v) => change((st) => ({ ...st, top: { ...st.top, captions: { ...st.top.captions, [k]: v } } }), false)}
                onCaptionStart={editStart}
                onCaptionDone={editEnd}
              />
            </>
          )}
          {s.mode === "bracket" && (
            <BracketMode
              bracket={s.bracket}
              entrants={entrants}
              poolSize={pool.length}
              byKey={byKey}
              art={s.art}
              shiny={s.shiny}
              title={title}
              moving={moving}
              light={light}
              onTileDown={dnd.onPointerDown}
              onSetup={(patch) => change((st) => ({ ...st, bracket: { ...st.bracket, ...patch, picks: [] } }))}
              onStart={() => change((st) => ({ ...st, bracket: { ...st.bracket, started: true, picks: [] } }))}
              onPick={(side) => change((st) => ({ ...st, bracket: { ...st.bracket, picks: clampPicks(entrants, [...st.bracket.picks, side]) } }))}
              onUndo={() => change((st) => ({ ...st, bracket: { ...st.bracket, picks: st.bracket.picks.slice(0, -1) } }))}
              onRestart={() => change((st) => ({ ...st, bracket: { ...st.bracket, picks: [], started: false, seed: newSeed() } }))}
            />
          )}
          {s.mode === "blind" && (
            <BlindMode
              blind={s.blind}
              drawn={drawn}
              byKey={byKey}
              art={s.art}
              shiny={s.shiny}
              challenge={challenge}
              onSetup={(patch) => change((st) => blindReset(st, patch))}
              onPlace={(slot) => change((st) => ({ ...st, blind: { ...st.blind, slots: blindPlace(st.blind.slots, slot) } }))}
              onNewDraw={() => change((st) => blindReset(st, { seed: newSeed() }))}
              onAccept={() => setChallenge(false)}
              onChallenge={async (name) => {
                const next = { ...s, blind: { ...s.blind, name: name || undefined } };
                change(() => next, false);
                const ok = await copy(shareUrl({ ...next, mode: "blind" }));
                say(ok ? t("share.copied") : shareUrl({ ...next, mode: "blind" }));
                return ok;
              }}
            />
          )}
        </section>

        {showPool && (
          <aside
            className={cn(
              "flex min-h-0 flex-col rounded-[24px] border border-foreground/[0.07] bg-card/60 p-3 lg:h-full",
              phone && "fixed inset-x-0 bottom-[var(--tabbar-h)] z-40 rounded-b-none border-x-0 border-b-0 bg-background/95 px-3 pb-2 pt-0 shadow-[0_-16px_40px_-12px_rgb(0_0_0/0.45)] backdrop-blur-md",
              phone && (poolOpen ? "h-[40svh]" : "h-auto")
            )}
            aria-label={t("pool.label")}
            data-testid="tl-pool-panel"
            // Phones: the page's end (the tiers, the credits, the footer) scrolls clear of the drawer (tier-list.css).
            data-tl-drawer={phone ? (poolOpen ? "open" : "closed") : undefined}
          >
            {phone && (
              <button type="button" onClick={() => setPoolOpen((v) => !v)} className="flex h-11 w-full shrink-0 items-center justify-between text-[14px] font-semibold" aria-expanded={poolOpen} data-testid="pool-toggle">
                <span>{placingHint ? t("pool.hintTap") : t("pool.label")}</span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  {selected.length > 0 && s.mode === "tier" && (
                    <span className="rounded-full bg-screen/15 px-2 py-0.5 text-[12px] text-screen">{t("pool.selectedMany", { n: selected.length })}</span>
                  )}
                  {poolOpen ? <ChevronDown className="h-5 w-5" aria-label={t("pool.close")} /> : <ChevronUp className="h-5 w-5" aria-label={t("pool.open")} />}
                </span>
              </button>
            )}
            {(!phone || poolOpen) && (
              <Pool
                ref={poolRef}
                mons={poolMons}
                art={s.art}
                shiny={s.shiny}
                tile={poolTile}
                names={names}
                selected={selSet}
                moving={moving}
                zone="pool"
                from="pool"
                onTileDown={dnd.onPointerDown}
                onTileClick={onTileClick}
                className="min-h-0 flex-1"
                testId="pool"
                actions={
                  <div className="flex items-center gap-2">
                    <PillButton onClick={() => setDialog("add")} className="h-9 px-3 text-[13px]" testId="pool-add">
                      <Plus className="h-4 w-4" aria-hidden /> {t("pool.add")}
                    </PillButton>
                    {s.mode === "tier" && selected.some((k) => placed.has(k)) && (
                      <PillButton onClick={() => sendTo(null)} className="h-9 px-3 text-[13px]">
                        {t("pool.backToPool")}
                      </PillButton>
                    )}
                  </div>
                }
                empty={<p className="px-4 py-10 text-center text-sm text-muted-foreground">{pool.length ? t("pool.empty") : t("pool.customEmpty")}</p>}
              />
            )}
          </aside>
        )}
      </div>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--tabbar-h)+24px)] z-[90] flex justify-center px-4" role="status" aria-live="polite">
          <p className="tlm-rise max-w-md rounded-full bg-foreground px-5 py-2.5 text-center text-sm font-semibold text-background shadow-xl" data-testid="toast">{toast}</p>
        </div>
      )}

      {dialog === "templates" && (
        <Modal title={t("pick.heading")} onClose={() => setDialog(null)} closeLabel={t("close")} wide testId="template-dialog">
          <TemplateGrid current={template} onPick={goTemplate} compact />
        </Modal>
      )}
      {dialog === "share" && <ShareDialog url={shareUrl(s)} onClose={() => setDialog(null)} copy={copy} title={title} />}
      {dialog === "export" && <ExportDialog input={{ state: s, byKey, title, subtitle, entrants, drawn }} onClose={() => setDialog(null)} />}
      {dialog === "add" && (
        <AddDialog
          mons={mons}
          inPool={new Set(pool)}
          state={s}
          onToggle={(m, on) =>
            change((st) => {
              const inTpl = tpl.filter(m);
              const added = st.added.filter((k) => k !== m.k);
              const removed = st.removed.filter((k) => k !== m.k);
              if (on && !inTpl) added.push(m.k);
              if (!on && inTpl) removed.push(m.k);
              return { ...st, added, removed };
            })
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "keys" && (
        <Modal title={t("keys.title")} onClose={() => setDialog(null)} closeLabel={t("close")}>
          <ul className="space-y-2.5 text-[15px]">
            {(["select", "send", "back", "undo", "search", "bracket", "blind", "escape"] as const).map((k) => (
              <li key={k} className="text-muted-foreground">{t(`keys.${k}`)}</li>
            ))}
          </ul>
        </Modal>
      )}
      {dialog === "reset" && (
        <Modal title={t("bar.reset")} onClose={() => setDialog(null)} closeLabel={t("close")}>
          <p className="text-[15px] text-muted-foreground">{t("bar.resetConfirm", { mode: modeNoun(t, s.mode, s.top.length) })}</p>
          <div className="mt-5 flex justify-end gap-2">
            <PillButton onClick={() => setDialog(null)}>{t("close")}</PillButton>
            <PillButton primary onClick={resetMode} testId="reset-confirm">{t("bar.reset")}</PillButton>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ShareDialog({ url, onClose, copy, title }: { url: string; onClose(): void; copy(text: string): Promise<boolean>; title: string }) {
  const t = useT(tierList);
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && !!navigator.share;
  return (
    <Modal title={t("share.title")} onClose={onClose} closeLabel={t("close")} testId="share-dialog">
      <p className="text-sm text-muted-foreground">{t("share.hint")}</p>
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="mt-4 h-11 w-full rounded-xl bg-foreground/[0.06] px-3 font-mono text-[13px] text-muted-foreground outline-none max-md:text-base focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("share.title")} data-testid="share-url" />
      <div className="mt-4 flex gap-2">
        <PillButton
          primary
          className="flex-1"
          onClick={async () => {
            if (await copy(url)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }
          }}
          testId="share-copy"
        >
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? t("share.copied") : t("share.copy")}
        </PillButton>
        {canShare && (
          <PillButton onClick={() => void navigator.share({ title, url }).catch(() => {})}>
            <Share2 className="h-4 w-4" aria-hidden /> {t("share.native")}
          </PillButton>
        )}
      </div>
    </Modal>
  );
}

function AddDialog({ mons, inPool, state, onToggle, onClose }: { mons: readonly Mon[]; inPool: ReadonlySet<string>; state: ToolState; onToggle(m: Mon, on: boolean): void; onClose(): void }) {
  const t = useT(tierList);
  const byKey = useMemo(() => new Map(mons.map((m) => [m.k, m])), [mons]);
  return (
    <Modal title={t("pool.addTitle")} onClose={onClose} closeLabel={t("close")} wide testId="add-dialog">
      <div className="flex h-[min(64dvh,620px)] flex-col">
        <Pool
          mons={mons}
          art={state.art}
          shiny={state.shiny}
          tile={68}
          names={false}
          selected={inPool}
          moving={new Set()}
          from="add"
          onTileClick={(_, key) => {
            const m = byKey.get(key);
            if (m) onToggle(m, !inPool.has(key));
          }}
          badge={(m) =>
            inPool.has(m.k) ? (
              <span className="pointer-events-none absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-screen text-background" aria-label={t("pool.added")}>
                <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
              </span>
            ) : null
          }
          className="min-h-0 flex-1"
          testId="add-pool"
          empty={null}
        />
        <PillButton primary className="mt-3 w-full shrink-0" onClick={onClose} testId="add-done">
          {t("pool.done")}
        </PillButton>
      </div>
    </Modal>
  );
}

