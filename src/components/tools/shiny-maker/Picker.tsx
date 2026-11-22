"use client";

/* eslint-disable @next/next/no-img-element -- small static board pictures, many at once */
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useT } from "@/i18n/client";
import tools from "@/messages/tools";
import { boardArtUrl } from "@/lib/pokemon/art";
import { loadSpeciesList, type SpeciesEntry } from "@/lib/shiny-maker/data";
import { cn } from "@/lib/utils";
import { ShinyLocalContext } from "./local";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Search and a grid of every Pokémon (the list is fetched when the picker first opens). */
export function Picker({ current, onPick }: { current: number; onPick: (id: number) => void }) {
  const t = useT(tools);
  const local = useContext(ShinyLocalContext);
  const [list, setList] = useState<SpeciesEntry[] | null>(null);
  // Another language's page folds names in any script (kana, accents), with code English pages never load.
  const [foldAny, setFoldAny] = useState<((s: string) => string) | null>(null);
  useEffect(() => {
    if (local) void import("@/components/pokedle/search").then((m) => setFoldAny(() => m.normalizeName));
  }, [local]);
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    loadSpeciesList().then((l) => setList(local ? l.map(([id, name, type]) => [id, local.names[id] ?? name, type]) : l), () => setList([]));
    // Focus the search without scrolling the page on phones.
    input.current?.focus({ preventScroll: true });
  }, [local]);
  const shown = useMemo(() => {
    if (!list) return [];
    const norm = local && foldAny ? foldAny : fold;
    const f = norm(q.trim());
    if (!f) return list;
    const num = /^\d+$/.test(f) ? Number(f) : null;
    const hit = (id: number, name: string) => norm(name).includes(f) || (!!local && !!local.alt[id]?.split(" ").some((a) => a.includes(f)));
    return list.filter(([id, name]) => (num !== null ? String(id).startsWith(String(num)) : hit(id, name))).sort((a, b) => (num === null ? Number(!norm(a[1]).startsWith(f)) - Number(!norm(b[1]).startsWith(f)) : 0));
  }, [list, q, local, foldAny]);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <label className="relative block shrink-0">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && shown[0]) onPick(shown[0][0]); }}
          placeholder={t("picker.search")}
          aria-label={t("picker.search")}
          className="h-11 w-full rounded-full border border-white/[0.08] bg-white/[0.05] pl-10 pr-4 text-[15px] outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-white/25"
          data-testid="sm-picker-search"
        />
      </label>
      <ul className="-mx-1 grid min-h-0 flex-1 auto-rows-[84px] grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-1 overflow-y-auto overscroll-contain px-1 pb-1" role="listbox" aria-label={t("picker.title")} data-testid="sm-picker-list">
        {!list && Array.from({ length: 18 }, (_, i) => <li key={i} className="animate-pulse rounded-2xl bg-white/[0.04]" aria-hidden />)}
        {list && !shown.length && <li className="col-span-full py-8 text-center text-[14px] text-muted-foreground">{t("picker.none")}</li>}
        {shown.map(([id, name]) => (
          <li key={id} role="option" aria-selected={id === current} className="[content-visibility:auto] [contain-intrinsic-size:76px_84px]">
            <button
              type="button"
              onClick={() => onPick(id)}
              className={cn(
                "flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-2xl px-1 text-[12px] leading-tight text-foreground/80 transition-colors hover:bg-white/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
                id === current && "bg-white/[0.09] text-foreground"
              )}
              data-testid={`sm-pick-${id}`}
            >
              <img src={boardArtUrl(id)} alt="" width={52} height={52} loading="lazy" decoding="async" className="h-[52px] w-[52px] object-contain" />
              <span className="w-full truncate text-center">{name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
