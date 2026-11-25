"use client";

/* eslint-disable @next/next/no-img-element -- small static Pokémon pictures, many at once */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, Search } from "lucide-react";
import { useT } from "@/i18n/client";
import msgs from "@/messages/catch-rate";
import { boardArtUrl } from "@/lib/pokemon/art";
import { foldLetters, NOT_LETTER } from "@/lib/names/fold";
import { SPECIES, type CatchSpecies } from "@/lib/catch-rate/species";
import { cn } from "@/lib/utils";

const fold = (s: string) => foldLetters(s).replace(NOT_LETTER, "");
const LIMIT = 60;

export interface Names {
  /** Every species' name in the page's language (English pages: none, the data's English names are used). */
  names?: Record<number, string>;
  /** Other names each species answers to, folded and space separated (English, rōmaji). */
  alt?: Record<number, string>;
}

export const nameOf = (s: CatchSpecies, n: Names) => n.names?.[s.id] ?? s.name;

/** How hard a catch rate is, in words (a rough guide shown under the number). */
export function rateBand(rate: number): "easy" | "medium" | "hard" | "legendary" {
  return rate >= 150 ? "easy" : rate >= 75 ? "medium" : rate >= 25 ? "hard" : "legendary";
}

/** The wild Pokémon's name in the battle HUD, and a search to change it (a combobox). */
export function PokemonPicker({ species, names, onPick }: { species: CatchSpecies; names: Names; onPick(id: number): void }) {
  const t = useT(msgs);
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const listId = `${id}-list`;

  const shown = useMemo(() => {
    const f = fold(q.trim());
    if (!f) return SPECIES.slice(0, LIMIT);
    if (/^\d+$/.test(f)) return SPECIES.filter((s) => String(s.id).startsWith(String(Number(f)))).slice(0, LIMIT);
    const hits: [CatchSpecies, number][] = [];
    for (const s of SPECIES) {
      const n = fold(nameOf(s, names));
      const i = n.indexOf(f);
      if (i >= 0) hits.push([s, i === 0 ? 0 : 1]);
      else if (names.alt?.[s.id]?.split(" ").some((a) => a.includes(f))) hits.push([s, 2]);
    }
    return hits.sort((a, b) => a[1] - b[1]).slice(0, LIMIT).map((h) => h[0]);
  }, [q, names]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    if (!open) return;
    input.current?.focus({ preventScroll: true });
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (s: CatchSpecies) => {
    onPick(s.id);
    setOpen(false);
    setQ("");
  };
  return (
    <div ref={root} className="relative min-w-0" data-testid="cr-picker">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${t("pokemon.change")}: ${nameOf(species, names)}`}
        className="group -ml-1.5 flex min-w-0 max-w-full items-center gap-1 rounded-xl px-1.5 py-0.5 text-left transition-colors hover:bg-black/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b7cff]"
        data-testid="cr-picker-button"
      >
        <span className="truncate font-display text-[22px] font-bold uppercase italic leading-tight tracking-wide max-sm:text-[19px]" data-testid="cr-species-name">
          {nameOf(species, names)}
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 opacity-60 transition-transform group-hover:opacity-100", open && "rotate-180")} aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="absolute left-[-10px] top-full z-40 mt-2 w-[min(380px,calc(100vw-40px))] origin-top text-foreground overflow-hidden rounded-[22px] border border-foreground/[0.1] bg-card shadow-[0_24px_60px_-20px_hsl(var(--shade)/0.6)]"
          >
            <label className="relative block border-b border-foreground/[0.07] p-2">
              <Search className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(shown.length - 1, a + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(0, a - 1));
                  } else if (e.key === "Enter" && shown[active]) {
                    e.preventDefault();
                    pick(shown[active]);
                  } else if (e.key === "Escape") {
                    setOpen(false);
                    root.current?.querySelector<HTMLButtonElement>("[data-testid=cr-picker-button]")?.focus();
                  }
                }}
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-activedescendant={shown[active] ? `${id}-o${shown[active].id}` : undefined}
                aria-autocomplete="list"
                aria-label={t("pokemon.search")}
                placeholder={t("pokemon.search")}
                className="h-11 w-full rounded-full bg-foreground/[0.05] pl-10 pr-4 text-[16px] outline-none placeholder:text-muted-foreground/70 focus:bg-foreground/[0.07] sm:text-[15px]"
                data-testid="cr-search"
              />
            </label>
            <ul ref={list} id={listId} role="listbox" aria-label={t("pokemon.label")} className="max-h-[min(360px,50svh)] overflow-y-auto overscroll-contain p-1.5">
              {!shown.length && <li className="px-3 py-6 text-center text-[14px] text-muted-foreground">{t("pokemon.none")}</li>}
              {shown.map((s, i) => (
                <li
                  key={s.id}
                  id={`${id}-o${s.id}`}
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  onPointerMove={() => setActive(i)}
                  onClick={() => pick(s)}
                  className={cn("flex cursor-pointer items-center gap-3 rounded-2xl px-2 py-1.5", i === active && "bg-foreground/[0.07]", s.id === species.id && "text-primary")}
                  data-testid={`cr-option-${s.id}`}
                >
                  <img src={boardArtUrl(s.id)} alt="" width={40} height={40} loading="lazy" decoding="async" className="h-10 w-10 shrink-0 object-contain" />
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{nameOf(s, names)}</span>
                  <span className="text-[12px] tabular-nums text-muted-foreground">#{s.id}</span>
                  <span className="w-12 rounded-full bg-foreground/[0.06] py-0.5 text-center text-[12px] font-semibold tabular-nums" title={t("pokemon.catchRate")}>
                    {s.rate}
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
