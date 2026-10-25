"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { ChevronDown, CircleDot, Search, Sparkle, Swords } from "lucide-react";
import type { DexMove } from "@/lib/pokemon/dex-types";
import { TypeBadge } from "../TypeBadge";
import { cn } from "@/lib/utils";

const TABS: { method: DexMove["method"]; label: string }[] = [
  { method: "L", label: "Level up" },
  { method: "M", label: "TM / TR" },
  { method: "E", label: "Egg" },
  { method: "T", label: "Tutor" },
];

const CLASS_META = {
  physical: { icon: Swords, label: "Physical", cls: "text-orange-400" },
  special: { icon: Sparkle, label: "Special", cls: "text-sky-400" },
  status: { icon: CircleDot, label: "Status", cls: "text-zinc-400" },
} as const;

export function MovesSection({ moves, game }: { moves: DexMove[]; game: string }) {
  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.method, moves.filter((m) => m.method === t.method).length])),
    [moves]
  );
  const [tab, setTab] = useState<DexMove["method"]>(TABS.find((t) => counts[t.method] > 0)?.method ?? "L");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  // Rows in the prerendered HTML stay visible; only later tab / filter
  // changes animate rows in.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return moves
      .filter((m) => m.method === tab)
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.type.includes(q))
      .sort((a, b) =>
        tab === "L" ? a.level - b.level || a.name.localeCompare(b.name) : tab === "M" ? (a.tm ?? "ZZ").localeCompare(b.tm ?? "ZZ", undefined, { numeric: true }) : a.name.localeCompare(b.name)
      );
  }, [moves, tab, query]);

  return (
    <div className="space-y-3 hud rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-md border border-foreground/10 bg-shade/30 p-1">
          {TABS.filter((t) => counts[t.method] > 0).map((t) => (
            <button
              key={t.method}
              type="button"
              onClick={() => {
                setTab(t.method);
                setOpen(null);
              }}
              className={cn("relative rounded-sm px-3 py-1.5 font-pixel text-[10px] uppercase tracking-wider transition-colors", tab === t.method ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {tab === t.method && <motion.span layoutId="moves-tab" className="absolute inset-0 rounded-sm bg-primary" transition={{ type: "spring", stiffness: 400, damping: 30 }} />}
              <span className="relative">
                {t.label} <span className="opacity-70">{counts[t.method]}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter moves or types"
            className="h-9 w-48 rounded-full border border-input bg-background pl-8 pr-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Filter moves"
          />
        </div>
      </div>

      <div className="overflow-x-auto" data-hscroll>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="w-14 p-2">{tab === "L" ? "Lv" : tab === "M" ? "TM" : ""}</th>
              <th className="p-2">Move</th>
              <th className="p-2">Type</th>
              <th className="p-2">Cat.</th>
              <th className="p-2 text-right">Pow</th>
              <th className="hidden p-2 text-right sm:table-cell">Acc</th>
              <th className="hidden p-2 text-right sm:table-cell">PP</th>
              <th className="w-6 p-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((m, i) => {
              const meta = CLASS_META[m.cls] ?? CLASS_META.status;
              const Icon = meta.icon;
              const key = m.id * 1000 + m.level;
              const isOpen = open === key;
              return (
                <Fragment key={`${m.id}-${m.level}`}>
                  <motion.tr
                    initial={hydrated ? { opacity: 0, x: -8 } : false}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i, 20) * 0.015 }}
                    onClick={() => setOpen(isOpen ? null : key)}
                    className={cn("cursor-pointer border-b border-foreground/5 transition-colors hover:bg-foreground/[0.03]", isOpen && "bg-foreground/[0.04]")}
                  >
                    <td className="p-2 font-mono text-xs text-muted-foreground">
                      {tab === "L" ? (m.level === 0 ? "Evo" : m.level) : tab === "M" ? m.tm ?? "—" : ""}
                    </td>
                    <td className="p-2 font-semibold">
                      {/* The row handles the click; the button makes it reachable by keyboard. */}
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={isOpen ? `move-${key}` : undefined}
                        className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                      >
                        {m.name}
                      </button>
                      <Link
                        href={`/pokedex/moves/${m.slug}`}
                        onClick={(e) => e.stopPropagation()}
                        className="ml-2 text-[10px] font-normal uppercase tracking-wider text-muted-foreground hover:text-screen"
                        aria-label={`${m.name} move page`}
                      >
                        Page →
                      </Link>
                    </td>
                    <td className="p-2">
                      <TypeBadge type={m.type} size="sm" />
                    </td>
                    <td className="p-2">
                      <Icon className={cn("h-4 w-4", meta.cls)} aria-label={meta.label} />
                    </td>
                    <td className="p-2 text-right font-mono tabular-nums">{m.power ?? "—"}</td>
                    <td className="hidden p-2 text-right font-mono tabular-nums sm:table-cell">{m.accuracy ?? "—"}</td>
                    <td className="hidden p-2 text-right font-mono tabular-nums sm:table-cell">{m.pp ?? "—"}</td>
                    <td className="p-2">
                      <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} aria-hidden />
                    </td>
                  </motion.tr>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <tr id={`move-${key}`}>
                        <td colSpan={8} className="p-0">
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                            <div className="flex flex-wrap gap-x-4 gap-y-1 bg-foreground/[0.02] px-4 py-3 text-xs text-muted-foreground">
                              <span className="w-full text-sm text-foreground/90">{m.effect || "No additional effect."}</span>
                              <span>{meta.label}</span>
                              <span className="sm:hidden">Acc {m.accuracy ?? "—"} · PP {m.pp ?? "—"}</span>
                              {m.priority !== 0 && <span>Priority {m.priority > 0 ? `+${m.priority}` : m.priority}</span>}
                            </div>
                          </motion.div>
                        </td>
                      </tr>
                    )}
                  </AnimatePresence>
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No moves match.</p>}
      </div>
      <p className="text-[11px] text-muted-foreground">Learnset from {game}. Tap a move for its effect.</p>
    </div>
  );
}
