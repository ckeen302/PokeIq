"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronDown, Dices, Minus, RotateCcw, Search } from "lucide-react";
import { DEFAULT_PICK_IDS, PDK_CATALOG, decodePick, encodePick, type PdkCatalogEntry } from "@/lib/pikadoku/catalog";
import { PDK_BANDS, PDK_FAMILIES, type PdkFamily, type PdkSettings } from "@/lib/pikadoku/types";
import { Button } from "@/components/ui/button";
import { FAMILY_ICON, FAMILY_TINT, usePdkLocal } from "./parts";
import { cn } from "@/lib/utils";
import { INTL_LOCALE } from "@/i18n/format";
import { useT } from "@/i18n/client";
import pikadoku from "@/messages/pikadoku";
import board from "@/messages/pikadoku-board";

/**
 * Unlimited's setup: the rules, a difficulty and which categories may appear,
 * then Generate. Controlled: every change goes straight to `onChange` (the
 * page keeps it on this device), and the board is only dealt on Generate.
 */

/** Groups with long lists get a search box and sort A to Z. */
const SEARCHABLE = new Set<PdkFamily>(["moves", "abilities"]);
const groupsOf = (catalog: PdkCatalogEntry[], intl?: string): { family: PdkFamily; cats: PdkCatalogEntry[] }[] =>
  PDK_FAMILIES.map((family) => {
    const cats = catalog.filter((c) => c.family === family);
    return { family, cats: SEARCHABLE.has(family) ? [...cats].sort((a, b) => a.label.localeCompare(b.label, intl)) : cats };
  }).filter((g) => g.cats.length > 0);
const GROUPS = groupsOf(PDK_CATALOG);

/** The ticked categories a device's settings stand for: its own pack, else the classic mix of its families (older devices). */
export function pickedIds(s: PdkSettings): Set<string> {
  const ids = s.pick ? decodePick(s.pick) : null;
  if (ids) return new Set(ids);
  const fam = new Set(PDK_CATALOG.filter((c) => s.families.includes(c.family)).map((c) => c.id));
  return new Set(DEFAULT_PICK_IDS.filter((id) => fam.has(id)));
}

/** Settings carrying an explicit pick (what Generate deals from). */
export function withPick(s: PdkSettings, ids: ReadonlySet<string>): PdkSettings {
  const families = PDK_FAMILIES.filter((f) => PDK_CATALOG.some((c) => c.family === f && ids.has(c.id)));
  return { ...s, pick: encodePick(ids), band: s.band ?? "normal", families: families.length ? families : [...PDK_FAMILIES] };
}

function RuleSwitch({ id, label, description, checked, onChange }: { id: string; label: string; description: string; checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      data-testid={`pdk-rule-${id}`}
      className={cn(
        "flex min-h-16 w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        checked ? "border-primary/60 bg-primary/[0.08]" : "border-foreground/15 bg-card hover:border-foreground/30"
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs leading-snug text-muted-foreground">{description}</span>
      </span>
      <span aria-hidden className={cn("relative h-6 w-11 shrink-0 rounded-full border transition-colors", checked ? "border-primary bg-primary" : "border-foreground/20 bg-shade/30")}>
        <span className={cn("absolute top-0.5 h-[18px] w-[18px] rounded-full transition-[left]", checked ? "left-[1.3rem] bg-primary-foreground" : "left-0.5 bg-foreground")} />
      </span>
    </button>
  );
}

function GroupRow({ family, cats, picked, open, onOpen, onSet }: { family: PdkFamily; cats: PdkCatalogEntry[]; picked: ReadonlySet<string>; open: boolean; onOpen: () => void; onSet: (ids: string[], on: boolean) => void }) {
  const [query, setQuery] = useState("");
  const t = useT(pikadoku);
  const tb = useT(board);
  const on = cats.filter((c) => picked.has(c.id));
  const state: boolean | "mixed" = on.length === cats.length ? true : on.length === 0 ? false : "mixed";
  const Icon = FAMILY_ICON[family];
  const label = tb(`family.${family}`);
  const shown = query.trim() ? cats.filter((c) => c.label.toLowerCase().includes(query.trim().toLowerCase())) : cats;
  // What's ticked, in words: the whole group, nothing, or the first few names.
  const summary = state === true ? t("setup.all") : state === false ? t("setup.none") : on.map((c) => c.label).join(t.locale === "ja" ? "、" : ", ");
  return (
    <div className={cn("rounded-lg border bg-card", open ? "border-foreground/30" : "border-foreground/15")} data-testid={`pdk-setup-group-${family}`}>
      <div className="flex items-center gap-1 p-1.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={state}
          aria-label={t(state === true ? "setup.untickAll" : "setup.tickAll", { label })}
          onClick={() => onSet(cats.map((c) => c.id), state !== true)}
          data-testid={`pdk-setup-toggle-${family}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={cn("flex h-6 w-6 items-center justify-center rounded-md border-2", state === false ? "border-foreground/30" : "border-primary bg-primary text-primary-foreground")}>
            {state === true ? <Check className="h-4 w-4" strokeWidth={3} /> : state === "mixed" ? <Minus className="h-4 w-4" strokeWidth={3} /> : null}
          </span>
        </button>
        <button
          type="button"
          onClick={onOpen}
          aria-expanded={open}
          aria-controls={`pdk-setup-list-${family}`}
          data-testid={`pdk-setup-expand-${family}`}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md border", FAMILY_TINT[family])}>
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-sm font-semibold uppercase tracking-wider">{label}</span>
            <span className={cn("block truncate text-xs", state === false ? "text-muted-foreground/70" : "text-muted-foreground")}>{summary}</span>
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </div>
      {open && (
        <div id={`pdk-setup-list-${family}`} className="space-y-3 border-t border-foreground/10 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onSet(cats.map((c) => c.id), true)} data-testid={`pdk-setup-all-${family}`}>
              {t("setup.all")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onSet(cats.map((c) => c.id), false)} data-testid={`pdk-setup-none-${family}`}>
              {t("setup.none")}
            </Button>
            {SEARCHABLE.has(family) && (
              <label className="relative min-w-0 flex-1 basis-40">
                <span className="sr-only">{t(`setup.find.${family as "moves" | "abilities"}`)}</span>
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t(family === "moves" ? "setup.findOne.moves" : "setup.findOne.abilities")}
                  className="h-10 w-full rounded-md border border-foreground/20 bg-background pl-8 pr-3 text-base sm:text-sm"
                  data-testid={`pdk-setup-search-${family}`}
                />
              </label>
            )}
          </div>
          <div className={cn("flex flex-wrap gap-1.5", SEARCHABLE.has(family) && "max-h-72 overflow-y-auto overscroll-contain pr-1")} role="group" aria-label={label}>
            {shown.map((c) => {
              const ticked = picked.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={ticked}
                  onClick={() => onSet([c.id], !ticked)}
                  data-testid={`pdk-setup-cat-${c.id}`}
                  className={cn(
                    "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    ticked ? cn(FAMILY_TINT[family], "text-foreground") : "border-foreground/15 text-muted-foreground hover:text-foreground"
                  )}
                >
                  {ticked && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />}
                  {c.label}
                </button>
              );
            })}
            {!shown.length && <p className="py-2 text-sm text-muted-foreground">{t("setup.nothing")}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function UnlimitedSetup({
  settings,
  onChange,
  onGenerate,
  onBack,
  problem,
  busy,
}: {
  settings: PdkSettings;
  onChange: (s: PdkSettings) => void;
  onGenerate: (s: PdkSettings) => void;
  /** Back to the board in play, when there is one. */
  onBack?: () => void;
  /** Why the last Generate couldn't deal a board. */
  problem?: string | null;
  busy?: boolean;
}) {
  const picked = useMemo(() => pickedIds(settings), [settings]);
  const [open, setOpen] = useState<PdkFamily | null>(null);
  const t = useT(pikadoku);
  const local = usePdkLocal();
  // A page in another language lists its own labels (moves and abilities sorted as its language sorts).
  const groups = useMemo(() => (local ? groupsOf(PDK_CATALOG.map((c) => ({ ...c, label: local.labels[c.id] ?? c.label })), INTL_LOCALE[t.locale]) : GROUPS), [local, t.locale]);
  const band = settings.band ?? "normal";
  const set = (patch: Partial<PdkSettings>) => onChange(withPick({ ...settings, ...patch }, picked));
  const setCats = (ids: string[], on: boolean) => {
    const next = new Set(picked);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(withPick(settings, next));
  };

  return (
    <section className="mx-auto max-w-2xl space-y-5" aria-labelledby="pdk-setup-title" data-testid="pdk-setup">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="pdk-setup-title" className="font-display text-2xl font-bold uppercase tracking-tight">
            {t("setup.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("setup.intro")}</p>
        </div>
        {onBack && (
          <Button type="button" variant="ghost" size="sm" onClick={onBack} data-testid="pdk-setup-back" className="shrink-0">
            <ArrowLeft className="h-4 w-4" aria-hidden /> {t("setup.back")}
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="hud-label">{t("setup.rules")}</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <RuleSwitch id="pp" label={t("setup.pp")} description={t("setup.ppHint")} checked={settings.unlimitedPP} onChange={() => set({ unlimitedPP: !settings.unlimitedPP })} />
          <RuleSwitch id="guard" label={t("setup.guard")} description={t("setup.guardHint")} checked={settings.softLockGuard} onChange={() => set({ softLockGuard: !settings.softLockGuard })} />
          <RuleSwitch id="single" label={t("setup.single")} description={t("setup.singleHint")} checked={settings.allowSingle} onChange={() => set({ allowSingle: !settings.allowSingle })} />
          <RuleSwitch id="timer" label={t("setup.timer")} description={t("setup.timerHint")} checked={settings.timer} onChange={() => set({ timer: !settings.timer })} />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="hud-label" id="pdk-band-label">
          {t("setup.difficulty")}
        </h3>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-foreground/15 bg-card p-1" role="radiogroup" aria-labelledby="pdk-band-label">
          {PDK_BANDS.map((b) => (
            <button
              key={b}
              type="button"
              role="radio"
              aria-checked={band === b}
              onClick={() => set({ band: b })}
              data-testid={`pdk-band-${b}`}
              className={cn("min-h-11 rounded-md font-display text-sm font-semibold uppercase tracking-wider transition-colors", band === b ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {t(`setup.band.${b}`)}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t(`setup.bandHint.${band}`)}</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="hud-label">{t("setup.categories")}</h3>
          <button
            type="button"
            onClick={() => onChange(withPick({ ...settings }, new Set(DEFAULT_PICK_IDS)))}
            className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
            data-testid="pdk-setup-reset"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> {t("setup.classic")}
          </button>
        </div>
        <div className="space-y-2">
          {groups.map((g) => (
            <GroupRow key={g.family} family={g.family} cats={g.cats} picked={picked} open={open === g.family} onOpen={() => setOpen((o) => (o === g.family ? null : g.family))} onSet={setCats} />
          ))}
        </div>
      </div>

      {/* On a phone the button rides above the tab bar, so it's always in reach while the lists scroll. */}
      <div className="sticky bottom-[var(--tabbar-h)] z-10 -mx-4 space-y-2 border-t border-foreground/10 bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-3">
        {problem && (
          <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm" data-testid="pdk-setup-problem">
            {problem}
          </p>
        )}
        <Button type="button" size="lg" className="w-full" disabled={busy} onClick={() => onGenerate(withPick(settings, picked))} data-testid="pdk-setup-generate">
          <Dices className="h-5 w-5" aria-hidden /> {t("setup.generate")}
        </Button>
      </div>
    </section>
  );
}

