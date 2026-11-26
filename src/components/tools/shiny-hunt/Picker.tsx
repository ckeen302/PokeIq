"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useT } from "@/i18n/client";
import counter from "@/messages/shiny-counter";
import { normalizeName } from "@/components/pokedle/search";
import { cn } from "@/lib/utils";
import { MonArt } from "./Art";
import type { Names } from "./names";

/**
 * Search and a grid of every Pokémon: by name in the page's language (and, in another language, the English name and
 * rōmaji too), or by National Dex number. Enter picks the first match.
 */
export function Picker({ names, current, onPick, autoFocus = true, shiny = false, className, testId = "sh-picker" }: { names: Names; current?: number; onPick(id: number): void; autoFocus?: boolean; shiny?: boolean; className?: string; testId?: string }) {
  const t = useT(counter);
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Focus the search without scrolling the page (phones would jump).
    if (autoFocus && window.matchMedia("(pointer: fine)").matches) input.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  const shown = useMemo(() => {
    const f = normalizeName(q.trim());
    if (!f) return names.list;
    if (/^\d+$/.test(f)) {
      const n = String(Number(f));
      return names.list.filter((e) => String(e.id).startsWith(n));
    }
    const hits = names.list.filter((e) => e.key.includes(f) || e.alt.some((a) => a.includes(f)));
    return hits.sort((a, b) => Number(!a.key.startsWith(f)) - Number(!b.key.startsWith(f)));
  }, [names, q]);
  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)} data-testid={testId}>
      <label className="relative block shrink-0">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && shown[0]) {
              e.preventDefault();
              onPick(shown[0].id);
            }
          }}
          placeholder={t("picker.search")}
          aria-label={t("picker.search")}
          enterKeyHint="go"
          autoComplete="off"
          spellCheck={false}
          className="h-12 w-full rounded-full border border-foreground/[0.1] bg-background/60 pl-11 pr-4 text-[16px] outline-none transition-colors placeholder:text-muted-foreground/80 focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
          data-testid="sh-picker-search"
        />
      </label>
      <ul className="-mx-1 grid min-h-0 flex-1 auto-rows-[92px] grid-cols-[repeat(auto-fill,minmax(82px,1fr))] content-start gap-1 overflow-y-auto overscroll-contain px-1 pb-1" role="listbox" aria-label={t("picker.title")}>
        {!names.ready && Array.from({ length: 18 }, (_, i) => <li key={i} className="animate-pulse rounded-2xl bg-foreground/[0.04] motion-reduce:animate-none" aria-hidden />)}
        {names.ready && !shown.length && <li className="col-span-full py-10 text-center text-[15px] text-muted-foreground">{t("picker.none")}</li>}
        {shown.map((e) => (
          <li key={e.id} role="option" aria-selected={e.id === current} className="[contain-intrinsic-size:82px_92px] [content-visibility:auto]">
            <button
              type="button"
              onClick={() => onPick(e.id)}
              className={cn(
                "flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-2xl px-1 text-[12px] leading-tight text-foreground/80 transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                e.id === current && "bg-primary/10 text-foreground ring-1 ring-primary/40"
              )}
              data-testid={`sh-pick-${e.id}`}
            >
              <MonArt id={e.id} shiny={shiny} size="sm" className="h-[54px] w-[54px]" />
              <span className="w-full truncate text-center">{e.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
