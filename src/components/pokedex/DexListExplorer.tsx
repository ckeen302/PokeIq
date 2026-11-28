"use client";

/* eslint-disable @next/next/no-img-element -- item sprites are tiny remote PNGs */
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "@/components/ui/Link";
import { Search, Swords, Sparkle, CircleDot, X } from "lucide-react";
import { TYPES, capitalize } from "@/lib/pokemon/type-matrix";
import { typeColor } from "@/lib/pokemon/type-colors";
import { itemSpriteUrl } from "@/lib/dex/build";
import { TypeBadge } from "./TypeBadge";
import { CrawlLinks } from "./CrawlLinks";
import { cn } from "@/lib/utils";
import { usePlaceholder } from "@/lib/phone";
import { NOT_LETTER, foldLetters } from "@/lib/names/fold";
import { useT } from "@/i18n/client";
import dexLists from "@/messages/dex-lists";

/** In another language: the other names an entry answers to in the search box (its English name, rōmaji). */
interface Aliased {
  aliases?: string[];
}

export interface MoveListItem extends Aliased {
  slug: string;
  name: string;
  type: string;
  cls: string;
  power: number | null;
  accuracy: number | null;
  pp: number | null;
}
export interface AbilityListItem extends Aliased {
  slug: string;
  name: string;
  effect: string;
  count: number;
}
export interface ItemListItem extends Aliased {
  slug: string;
  name: string;
  category: string;
}

export interface PlaceListItem extends Aliased {
  slug: string;
  name: string;
  region: string;
  type: string;
  parent?: string;
}

export type DexListKind = "moves" | "abilities" | "items" | "places";

const PAGE = 60;
const CLASSES = ["physical", "special", "status"] as const;
const CLASS_ICON = { physical: Swords, special: Sparkle, status: CircleDot } as const;
const CLASS_CLS = { physical: "text-orange-400", special: "text-sky-400", status: "text-zinc-400" } as const;

/** Letters and digits only, without accents or case, in any script (katakana as hiragana). */
const normalize = (s: string) => foldLetters(s).replace(NOT_LETTER, "");

type Item = MoveListItem | AbilityListItem | ItemListItem | PlaceListItem;

/**
 * `typeNames`: the types' names in the page's language (other languages only; English capitalises the ids).
 */
export function DexListExplorer({
  kind,
  items,
  typeNames,
  placeLabels,
}: {
  kind: DexListKind;
  items: Item[];
  typeNames?: Record<string, string>;
  /** Places' regions and kinds as the page's language shows them (other languages only); the filters keep the English values. */
  placeLabels?: { regions: Record<string, string>; types: Record<string, string> };
}) {
  const t = useT(dexLists);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<string | null>(null);
  const [cls, setCls] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [region, setRegion] = useState("");
  const [placeType, setPlaceType] = useState("");
  const [visible, setVisible] = useState(PAGE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const categories = useMemo(
    () => (kind === "items" ? [...new Set((items as ItemListItem[]).map((i) => i.category))].sort() : []),
    [kind, items]
  );
  // /pokedex/places?region=Kanto (linked from the timeline) opens filtered to that region.
  useEffect(() => {
    if (kind !== "places") return;
    try {
      const r = new URLSearchParams(window.location.search).get("region");
      if (r && (items as PlaceListItem[]).some((i) => i.region === r)) setRegion(r);
    } catch {
      // No URL access: keep every region.
    }
  }, [kind, items]);
  const regions = useMemo(() => (kind === "places" ? [...new Set((items as PlaceListItem[]).map((i) => i.region))].sort() : []), [kind, items]);
  const placeTypes = useMemo(() => (kind === "places" ? [...new Set((items as PlaceListItem[]).map((i) => i.type))].sort() : []), [kind, items]);

  // The box shows each key at once; the list follows at a lower priority.
  const shownQuery = useDeferredValue(query);
  const filtered = useMemo(() => {
    const q = normalize(shownQuery);
    return items.filter((it) => {
      if (q && !normalize(it.name).includes(q) && !it.aliases?.some((a) => normalize(a).includes(q)) && !(kind === "abilities" && normalize((it as AbilityListItem).effect).includes(q))) return false;
      if (kind === "moves") {
        const m = it as MoveListItem;
        if (type && m.type !== type) return false;
        if (cls && m.cls !== cls) return false;
      }
      if (kind === "items" && category && (it as ItemListItem).category !== category) return false;
      if (kind === "places" && region && (it as PlaceListItem).region !== region) return false;
      if (kind === "places" && placeType && (it as PlaceListItem).type !== placeType) return false;
      return true;
    });
  }, [items, kind, shownQuery, type, cls, category, region, placeType]);

  useEffect(() => setVisible(PAGE), [shownQuery, type, cls, category, region, placeType]);
  // Every entry the list isn't showing, as links in the HTML for crawlers (the list itself grows as you scroll).
  const crawlLinks = useMemo(() => {
    const shown = new Set(filtered.slice(0, visible));
    return items.filter((it) => !shown.has(it)).map((it) => ({ href: `/pokedex/${kind}/${it.slug}`, name: it.name }));
  }, [items, filtered, visible, kind]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && setVisible((v) => Math.min(v + PAGE, filtered.length)),
      { rootMargin: "800px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const searchHint = usePlaceholder(t(`search.${kind}`));
  const hasFilters = query || type || cls || category || region || placeType;
  const reset = () => {
    setQuery("");
    setType(null);
    setCls(null);
    setCategory("");
    setRegion("");
    setPlaceType("");
  };

  return (
    <div className="space-y-6">
      <div className="sticky top-14 z-30 -mx-4 space-y-3 border-b border-foreground/5 bg-background/80 px-4 py-3 backdrop-blur-xl min-[1264px]:-mx-8 min-[1264px]:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchHint}
              aria-label={t(`searchLabel.${kind}`)}
              className="h-11 w-full rounded-md border border-input bg-shade/40 pl-9 pr-9 font-display text-sm tracking-wide focus-visible:border-screen/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={t("clear")}>
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {kind === "items" && (
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label={t("itemCategory")}
              className="h-11 max-w-[220px] rounded-md border border-input bg-shade/40 px-3 font-display text-sm"
            >
              <option value="">{t("allCategories")}</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
          {kind === "places" && (
            <>
              <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label={t("region")} className="h-11 max-w-[200px] rounded-md border border-input bg-shade/40 px-3 font-display text-sm">
                <option value="">{t("allRegions")}</option>
                {regions.map((c) => (
                  <option key={c} value={c}>{placeLabels?.regions[c] ?? c}</option>
                ))}
              </select>
              <select value={placeType} onChange={(e) => setPlaceType(e.target.value)} aria-label={t("placeType")} className="h-11 max-w-[200px] rounded-md border border-input bg-shade/40 px-3 font-display text-sm">
                <option value="">{t("allTypes")}</option>
                {placeTypes.map((c) => (
                  <option key={c} value={c}>{placeLabels?.types[c] ?? c}</option>
                ))}
              </select>
            </>
          )}
        </div>

        {kind === "moves" && (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
            {TYPES.map((ty) => {
              const active = type === ty;
              return (
                <button
                  key={ty}
                  type="button"
                  onClick={() => setType(active ? null : ty)}
                  aria-pressed={active}
                  className={cn(
                    "shrink-0 rounded-[4px] border px-2.5 py-1 font-display text-[11px] font-bold uppercase tracking-wider transition-all",
                    active ? "border-transparent text-white" : "border-foreground/10 bg-shade/20 text-muted-foreground hover:text-foreground"
                  )}
                  style={active ? { background: typeColor(ty), boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.35), inset 0 -2px 0 rgb(0 0 0 / 0.25)" } : { borderColor: `${typeColor(ty)}66` }}
                >
                  {typeNames?.[ty] ?? capitalize(ty)}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {kind === "moves" &&
            CLASSES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCls(cls === c ? null : c)}
                aria-pressed={cls === c}
                className={cn(
                  "rounded-sm border px-2.5 py-1.5 font-pixel text-[10px] uppercase tracking-wider transition-colors",
                  cls === c ? "border-screen/70 bg-screen/10 text-foreground" : "border-foreground/10 bg-shade/20 text-muted-foreground hover:text-foreground"
                )}
              >
                {t(`cls.${c}`)}
              </button>
            ))}
          {hasFilters ? (
            <button type="button" onClick={reset} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              {t("reset")}
            </button>
          ) : null}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground">{t(`empty.${kind}`)}</div>
      ) : kind === "moves" ? (
        <div className="hud overflow-x-auto rounded-lg border bg-card p-2" data-hscroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="p-2">{t("col.move")}</th>
                <th className="p-2">{t("col.type")}</th>
                <th className="p-2">{t("col.cat")}</th>
                <th className="p-2 text-right">{t("col.pow")}</th>
                <th className="hidden p-2 text-right sm:table-cell">{t("col.acc")}</th>
                <th className="hidden p-2 text-right sm:table-cell">{t("col.pp")}</th>
              </tr>
            </thead>
            <tbody>
              {(filtered.slice(0, visible) as MoveListItem[]).map((m) => {
                const Icon = CLASS_ICON[m.cls as keyof typeof CLASS_ICON] ?? CircleDot;
                return (
                  <tr key={m.slug} className="border-b border-foreground/5 transition-colors hover:bg-foreground/[0.03]">
                    <td className="p-2 font-semibold">
                      <Link href={`/pokedex/moves/${m.slug}`} className="hover:text-screen">{m.name}</Link>
                    </td>
                    <td className="p-2"><TypeBadge type={m.type} size="sm" label={typeNames?.[m.type]} /></td>
                    <td className="p-2"><Icon className={cn("h-4 w-4", CLASS_CLS[m.cls as keyof typeof CLASS_CLS])} aria-label={t(`cls.${m.cls as (typeof CLASSES)[number]}`)} /></td>
                    <td className="p-2 text-right font-mono tabular-nums">{m.power ?? "—"}</td>
                    <td className="hidden p-2 text-right font-mono tabular-nums sm:table-cell">{m.accuracy ?? "—"}</td>
                    <td className="hidden p-2 text-right font-mono tabular-nums sm:table-cell">{m.pp ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : kind === "abilities" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(filtered.slice(0, visible) as AbilityListItem[]).map((a) => (
            <Link key={a.slug} href={`/pokedex/abilities/${a.slug}`} className="group block space-y-1.5 rounded-lg border bg-card p-4 transition-colors hover:border-screen/60">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-[15px] font-bold uppercase tracking-wide group-hover:text-screen">{a.name}</span>
                <span className="font-pixel text-[10px] tabular-nums text-muted-foreground">{t("holders", { n: a.count })}</span>
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">{a.effect}</p>
            </Link>
          ))}
        </div>
      ) : kind === "places" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {(filtered.slice(0, visible) as PlaceListItem[]).map((it) => (
            <Link key={it.slug} href={`/pokedex/places/${it.slug}`} data-testid="place-card" className="group rounded-lg border bg-card p-3 transition-colors hover:border-screen/60">
              <span className="block font-display text-sm font-bold uppercase leading-tight tracking-wide group-hover:text-screen">{it.name}</span>
              {/* Blueberry Academy's places sit in the Blueberry Academy "region": the parent isn't said twice. */}
              <span className="mt-1 block font-pixel text-[9px] uppercase leading-snug tracking-wider text-muted-foreground">
                {placeLabels?.types[it.type] ?? it.type} · {it.parent && it.parent !== it.region ? `${it.parent}, ` : ""}{placeLabels?.regions[it.region] ?? it.region}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {(filtered.slice(0, visible) as ItemListItem[]).map((it) => (
            <Link key={it.slug} href={`/pokedex/items/${it.slug}`} className="group flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-screen/60">
              <span className="screen art-well flex h-11 w-11 shrink-0 items-center justify-center rounded-md">
                <img src={itemSpriteUrl(it.slug)} alt="" loading="lazy" decoding="async" width={32} height={32} className="relative z-[1] h-8 w-8 object-contain [image-rendering:pixelated]" />
              </span>
              <span className="min-w-0">
                {/* A long name wraps onto a second line, so "Fossilized Bird" and "Fossilized Dino" (or "Ability Capsule" in six columns) can be told apart. */}
                <span className="line-clamp-2 hyphens-auto break-words font-display text-sm font-bold uppercase leading-tight tracking-wide group-hover:text-screen">{it.name}</span>
                <span className="mt-0.5 block font-pixel text-[9px] uppercase leading-snug tracking-wider text-muted-foreground">{it.category}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
      <div ref={sentinelRef} aria-hidden className="h-4" />
      <CrawlLinks links={crawlLinks} />
    </div>
  );
}
