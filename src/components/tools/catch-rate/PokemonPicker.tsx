"use client";

/* eslint-disable @next/next/no-img-element -- small static Pokémon pictures, many at once */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, Search } from "lucide-react";
import { useT } from "@/i18n/client";
import msgs from "@/messages/catch-rate";
import { boardArtUrl } from "@/lib/pokemon/art";
import { typeColor } from "@/lib/pokemon/type-colors";
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

/** The wild Pokémon: its picture, name, types and catch rate, and a search to change it (a combobox). */
export function PokemonPicker({ species, rate, names, onPick, newer }: { species: CatchSpecies; rate: number; names: Names; onPick(id: number): void; newer: number | null }) {
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
  const band = rateBand(rate);
  const accent = typeColor(species.types[0]);

  return (
    <div ref={root} className="relative" data-testid="cr-picker">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${t("pokemon.change")}: ${nameOf(species, names)}`}
        className="group relative flex w-full items-center gap-4 overflow-hidden max-sm:gap-3 rounded-[22px] border border-foreground/[0.08] bg-foreground/[0.03] p-3 pr-4 text-left transition-colors hover:border-foreground/[0.16] hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="cr-picker-button"
      >
        <span className="relative flex h-[84px] w-[84px] shrink-0 items-center justify-center rounded-[18px] max-sm:h-[68px] max-sm:w-[68px]" style={{ background: `radial-gradient(circle at 50% 55%, ${accent}55, ${accent}10 70%)` }}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.img
              key={species.id}
              src={boardArtUrl(species.id)}
              alt=""
              width={76}
              height={76}
              className="h-[76px] w-[76px] object-contain drop-shadow-[0_6px_10px_rgb(0_0_0/0.25)] max-sm:h-[62px] max-sm:w-[62px]"
              initial={reduce ? false : { scale: 0.6, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 26 }}
            />
          </AnimatePresence>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{t("pokemon.number", { n: String(species.id).padStart(4, "0") })}</span>
          <span className="mt-0.5 block truncate font-display text-[22px] font-semibold leading-tight tracking-tight max-sm:text-[20px]" data-testid="cr-species-name">
            {nameOf(species, names)}
          </span>
          <span className="mt-1.5 flex flex-wrap gap-1">
            {species.types.map((ty) => (
              <span key={ty} className="rounded-full px-2 py-0.5 text-[11px] max-sm:px-1.5 max-sm:text-[10px] font-bold uppercase tracking-wide text-white [text-shadow:0_1px_1px_rgb(0_0_0/0.35)]" style={{ background: typeColor(ty) }}>
                {t(`typeNames.${ty}` as "typeNames.normal")}
              </span>
            ))}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end text-right">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground max-sm:text-[10px]">{t("pokemon.catchRate")}</span>
          <span className="font-display text-[30px] font-bold leading-none tabular-nums" data-testid="cr-species-rate">
            {rate}
          </span>
          <span className={cn("mt-1 text-[11px] font-semibold", band === "easy" ? "text-[hsl(var(--success))]" : band === "medium" ? "text-[hsl(var(--warning))]" : "text-primary")}>{t(`pokemon.${band}`)}</span>
        </span>
        <ChevronDown className={cn("absolute right-2 top-2 h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {newer && (
        <p className="mt-2 px-1 text-[12.5px] text-[hsl(var(--warning))]" data-testid="cr-newer">
          {t("pokemon.newer", { gen: newer })}
        </p>
      )}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="absolute left-0 right-0 top-full z-30 mt-2 origin-top overflow-hidden rounded-[22px] border border-foreground/[0.1] bg-card shadow-[0_24px_60px_-20px_hsl(var(--shade)/0.6)]"
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
