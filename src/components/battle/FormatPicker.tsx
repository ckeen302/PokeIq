"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Info, Loader2, Search, X } from "lucide-react";
import { PLAYABLE_FORMATS, POPULAR_FORMAT_IDS, catalogueFormat, type CatalogueFormat, type FormatRules } from "@/lib/battle/format-catalogue";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import type { Translator } from "@/i18n/catalog";
import rulesNs from "@/messages/battle-rules";

type T = Translator<typeof rulesNs.en>;

/**
 * Every Pokémon Showdown format the engine could start a battle in, grouped
 * by Showdown's own sections: searchable, popular ones first, the last few
 * picked on this device remembered, and a rules drawer per format with
 * Showdown's ruleset and bans.
 */

const RECENT_KEY = "pokeiq:battle:recent-formats";
const RECENT_MAX = 6;

function readRecent(): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string" && !!catalogueFormat(id)?.supported) : [];
  } catch {
    return [];
  }
}

function writeRecent(ids: string[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, RECENT_MAX)));
  } catch {
    // remembered for this visit only
  }
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function tags(t: T, f: CatalogueFormat): string[] {
  const out = [f.random ? t("picker.random") : t("picker.yourTeam")];
  if (f.gameType === "doubles") out.push(t("picker.doubles"));
  if (f.pick && f.pick < f.teamSize) out.push(t("picker.pick", { size: f.teamSize, pick: f.pick }));
  else if (!f.random && f.teamSize < 6) out.push(t("picker.size", { size: f.teamSize }));
  if (f.level && f.level !== 100) out.push(t("picker.level", { level: f.level }));
  return out;
}

/** Showdown's names carry the gen in brackets: "[Gen 9] OU" reads as "OU" under a "Gen 9" tag. */
const shortName = (f: CatalogueFormat) => f.name.replace(/^\[Gen \d+\]\s*/, "");

function FormatRow({ f, selected, onPick, onInfo, t }: { f: CatalogueFormat; selected: boolean; onPick: () => void; onInfo: () => void; t: T }) {
  return (
    <div className={cn("group flex min-w-0 items-stretch rounded-md border bg-card transition-colors hover:border-screen/60", selected && "border-primary ring-1 ring-primary")}>
      <button type="button" onClick={onPick} aria-pressed={selected} className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2 text-left" data-testid={`format-${f.id}`}>
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="hud-label shrink-0 text-screen">{t("picker.gen", { gen: f.gen })}</span>
          <span className="truncate font-display text-sm font-bold uppercase">{shortName(f)}</span>
        </span>
        <span className="truncate text-[11px] text-muted-foreground">{tags(t, f).join(" · ")}</span>
      </button>
      <button
        type="button"
        onClick={onInfo}
        className="flex shrink-0 items-center px-2.5 text-muted-foreground hover:text-foreground"
        aria-label={t("picker.rulesOf", { name: f.name })}
        title={t("picker.rules")}
        data-testid={`format-info-${f.id}`}
      >
        <Info className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

export function FormatPicker({ value, onPick }: { value: string | null | undefined; onPick: (f: CatalogueFormat) => void }) {
  const t = useT(rulesNs);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<CatalogueFormat | null>(null);
  useEffect(() => setRecent(readRecent()), []);

  const pick = (f: CatalogueFormat) => {
    const next = [f.id, ...recent.filter((id) => id !== f.id)].slice(0, RECENT_MAX);
    setRecent(next);
    writeRecent(next);
    onPick(f);
  };

  const q = norm(query);
  const matches = useMemo(() => {
    if (!q) return PLAYABLE_FORMATS;
    const words = q.split(" ");
    return PLAYABLE_FORMATS.filter((f) => {
      const hay = norm(`${f.name} ${f.id} ${f.section} gen ${f.gen} ${f.gameType} ${f.random ? "random" : ""}`);
      return words.every((w) => hay.includes(w));
    });
  }, [q]);

  const popular = useMemo(() => POPULAR_FORMAT_IDS.map(catalogueFormat).filter((f): f is CatalogueFormat => !!f && f.supported && !f.hidden), []);
  const recentFormats = recent.map(catalogueFormat).filter((f): f is CatalogueFormat => !!f);
  const sections = useMemo(() => {
    const out = new Map<string, CatalogueFormat[]>();
    for (const f of matches) out.set(f.section, [...(out.get(f.section) ?? []), f]);
    return [...out];
  }, [matches]);
  const toggle = (s: string) => setOpen((o) => new Set(o.has(s) ? [...o].filter((x) => x !== s) : [...o, s]));

  const grid = "grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3";
  const row = (f: CatalogueFormat, key = f.id) => <FormatRow key={key} f={f} selected={value === f.id} onPick={() => pick(f)} onInfo={() => setDrawer(f)} t={t} />;

  return (
    <div className="space-y-3" data-testid="format-picker">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("picker.search", { n: PLAYABLE_FORMATS.length })}
          className="h-10 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm"
          aria-label={t("picker.searchLabel")}
          data-testid="format-search"
        />
      </label>

      {!q && recentFormats.length > 0 && (
        <div className="space-y-1.5">
          <span className="hud-label">{t("picker.lastUsed")}</span>
          <div className={grid}>{recentFormats.map((f) => row(f, `recent-${f.id}`))}</div>
        </div>
      )}
      {!q && (
        <div className="space-y-1.5">
          <span className="hud-label">{t("picker.popular")}</span>
          <div className={grid}>{popular.map((f) => row(f, `popular-${f.id}`))}</div>
        </div>
      )}

      <div className="space-y-1.5">
        <span className="hud-label">{q ? t("picker.matches", { n: matches.length }) : t("picker.every")}</span>
        {sections.length === 0 && <p className="text-sm text-muted-foreground">{t("picker.noMatch", { query })}</p>}
        <div className="divide-y rounded-md border">
          {sections.map(([section, list]) => {
            const expanded = !!q || open.has(section);
            return (
              <div key={section}>
                <button
                  type="button"
                  onClick={() => toggle(section)}
                  aria-expanded={expanded}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/40"
                  data-testid={`section-${section}`}
                >
                  <span className="font-display text-xs font-bold uppercase tracking-wider">{section}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {list.length}
                    <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} aria-hidden />
                  </span>
                </button>
                {expanded && <div className={cn(grid, "px-3 pb-3")}>{list.map((f) => row(f))}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {drawer && <RulesDrawer format={drawer} selected={value === drawer.id} onClose={() => setDrawer(null)} onPick={() => (pick(drawer), setDrawer(null))} />}
    </div>
  );
}

function RuleList({ title, items }: { title: string; items: string[] }) {
  // Showdown's own rule and ban names, as Showdown writes them.
  if (!items.length) return null;
  return (
    <div className="space-y-1.5">
      <span className="hud-label">
        {title} · {items.length}
      </span>
      <ul className="flex flex-wrap gap-1">
        {items.map((r) => (
          <li key={r} className="rounded border bg-background px-1.5 py-0.5 text-xs">
            {r}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A format's rules as Showdown defines them, from /api/battle/rules. */
export function RulesDrawer({ format, selected, onClose, onPick }: { format: CatalogueFormat; selected: boolean; onClose: () => void; onPick: () => void }) {
  const t = useT(rulesNs);
  const [rules, setRules] = useState<FormatRules | null | "error">(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setRules(null);
    const controller = new AbortController();
    fetch(`/api/battle/rules?format=${encodeURIComponent(format.id)}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: FormatRules) => setRules(body))
      .catch(() => !controller.signal.aborted && setRules("error"));
    return () => controller.abort();
  }, [format.id]);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const facts = [
    { label: t("picker.section"), text: format.section },
    { label: t("picker.generation"), text: t("picker.gen", { gen: format.gen }) },
    {
      label: t("picker.battle"),
      text: format.gameType === "doubles" ? t("picker.doublesBattle") : t("picker.singles"),
    },
    {
      label: t("picker.teams"),
      text: format.random
        ? t("picker.randomDealt")
        : format.pick && format.pick < format.teamSize
          ? t("picker.bringPick", { size: format.teamSize, pick: format.pick })
          : t("picker.upTo", { size: format.teamSize }),
    },
    ...(format.level ? [{ label: t("picker.levelLabel"), text: `${format.level}` }] : []),
  ];

  // Portalled to the body: an animated ancestor would otherwise pin "fixed" to itself, and the phone tab bar sits above z-50.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end" role="dialog" aria-modal="true" aria-label={t("picker.drawerLabel", { name: format.name })} data-testid="rules-drawer">
      <button type="button" className="absolute inset-0 bg-black/50" aria-label={t("picker.close")} onClick={onClose} tabIndex={-1} />
      <div className="relative flex h-full w-full max-w-md flex-col border-l bg-card shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b p-4">
          <div className="min-w-0">
            <p className="hud-label text-screen">{t("picker.showdownFormat")}</p>
            <h2 className="font-display text-xl font-bold uppercase leading-tight">{format.name}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("picker.closeRules")}>
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          {format.desc && <p className="text-muted-foreground">{format.desc}</p>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            {facts.map((f) => (
              <div key={f.label} className="contents">
                <dt className="hud-label pt-0.5">{f.label}</dt>
                <dd>{f.text}</dd>
              </div>
            ))}
          </dl>
          {rules === null && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {t("picker.loading")}
            </p>
          )}
          {rules === "error" && <p className="text-xs text-destructive">{t("picker.error")}</p>}
          {rules && rules !== "error" && (
            <>
              <RuleList title={t("picker.listRules")} items={rules.rules} />
              <RuleList title={t("picker.banned")} items={rules.bans} />
              <RuleList title={t("picker.restricted")} items={rules.restricted} />
              <RuleList title={t("picker.unbans")} items={rules.unbans} />
            </>
          )}
        </div>
        <div className="border-t p-4">
          <button
            type="button"
            onClick={onPick}
            disabled={selected}
            className="h-10 w-full rounded-md bg-primary font-display text-sm font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            data-testid="rules-drawer-pick"
          >
            {selected ? t("picker.selected") : t("picker.pickThis")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
