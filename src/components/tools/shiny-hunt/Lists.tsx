"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus, Share2, Sparkles, Trash2, Trophy } from "lucide-react";
import { useT } from "@/i18n/client";
import { useLocale } from "@/i18n/navigation";
import { INTL_LOCALE, formatNumber } from "@/i18n/format";
import counter from "@/messages/shiny-counter";
import { shinyChance } from "@/lib/shiny-hunt/odds";
import { chanceByNow, clock, oneIn } from "@/lib/shiny-hunt/math";
import { activeHunts, archived, trophies, type Hunt, type HuntsState } from "@/lib/shiny-hunt/store";
import { cn } from "@/lib/utils";
import { GameSwatch, Sparkle, Twinkles } from "./Art";
import { ShinyStage } from "./Stage";
import type { Names } from "./names";

export type HuntAction = "open" | "rename" | "archive" | "unarchive" | "delete" | "share";

/** Every hunt: those in progress (the one on the counter marked), then the archived ones. */
export function HuntsView({ state, names, onNew, onAction }: { state: HuntsState; names: Names; onNew(): void; onAction(a: HuntAction, h: Hunt): void }) {
  const t = useT(counter);
  const active = activeHunts(state);
  const old = archived(state);
  return (
    <div className="space-y-8" data-testid="sh-hunts">
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-[22px] font-bold tracking-tight">{t("hunts.active")}</h2>
          <button type="button" onClick={onNew} className="sh-count inline-flex h-11 items-center gap-2 rounded-full px-5 font-display text-[14px] font-bold uppercase italic tracking-wide" style={{ "--lip": "4px" } as React.CSSProperties} data-testid="sh-new-hunt">
            <Plus className="h-4 w-4" aria-hidden /> {t("hunts.new")}
          </button>
        </div>
        {active.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
            {active.map((h) => (
              <HuntCard key={h.id} hunt={h} names={names} current={h.id === state.current} onAction={onAction} />
            ))}
          </ul>
        ) : (
          <p className="rounded-[22px] border border-dashed border-foreground/[0.12] px-5 py-8 text-center text-[15px] text-muted-foreground">{t("hunts.empty")}</p>
        )}
      </section>
      {old.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-[22px] font-bold tracking-tight">{t("hunts.archivedTitle")}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
            {old.map((h) => (
              <HuntCard key={h.id} hunt={h} names={names} current={false} onAction={onAction} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function HuntCard({ hunt, names, current, onAction }: { hunt: Hunt; names: Names; current: boolean; onAction(a: HuntAction, h: Hunt): void }) {
  const t = useT(counter);
  const locale = useLocale();
  const name = hunt.name || names.name(hunt.species);
  const p = shinyChance(hunt.game, hunt.method, hunt);
  const chance = chanceByNow(p, hunt.count);
  const isArchived = hunt.status === "archived";
  return (
    <li className={cn("group relative flex items-stretch overflow-hidden rounded-[24px] border bg-card shadow-[0_16px_40px_-32px_hsl(var(--shade)/0.9)] transition-[border-color,transform] hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0", current ? "border-primary/50 ring-1 ring-primary/30" : "border-foreground/[0.08] hover:border-foreground/[0.16]", isArchived && "opacity-80")} data-testid="sh-hunt-card">
      <button type="button" onClick={() => onAction("open", hunt)} className="flex min-w-0 flex-1 items-stretch text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" data-testid="sh-hunt-open">
        <ShinyStage id={hunt.species} type={names.type(hunt.species)} compact className="flex w-[104px] shrink-0 items-center rounded-none px-1.5" figureClassName="w-full" />
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-3 pl-3.5 pr-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-display text-[17px] font-bold leading-tight" data-testid="sh-hunt-name">{name}</span>
            {current && <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-primary-foreground">{t("hunts.current")}</span>}
            {hunt.found && <Sparkles className="h-4 w-4 shrink-0 text-[hsl(var(--warning))]" aria-hidden />}
          </span>
          <span className="sh-num block font-display text-[15px] font-bold text-foreground/90">{t("hunts.encounters", { n: hunt.count })}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <GameSwatch game={hunt.game} className="h-3.5 w-3.5" />
            <span className="truncate">{t(`games.${hunt.game}`)} · {t("counter.odds", { n: formatNumber(oneIn(p), locale) })}</span>
          </span>
          <span className="mt-1 flex items-center gap-2" title={t("stats.chance")}>
            <span className="relative block h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/[0.08]" aria-hidden>
              <span className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#ffc93c] to-primary" style={{ width: `${Math.max(chance, hunt.count ? 0.02 : 0) * 100}%` }} />
            </span>
            <span className="sh-num shrink-0 text-[11.5px] font-bold text-muted-foreground">
              <span className="sr-only">{t("stats.chance")}: </span>
              {formatNumber(chance, locale, { style: "percent", maximumFractionDigits: 0 })}
            </span>
          </span>
        </span>
      </button>
      <div className="flex items-start pr-1.5 pt-1.5">
        <Menu
          label={t("hunts.more", { name })}
          items={[
            { id: "rename", label: t("hunts.rename"), icon: <Pencil className="h-4 w-4" aria-hidden /> },
            { id: "share", label: t("share.button"), icon: <Share2 className="h-4 w-4" aria-hidden /> },
            isArchived ? { id: "unarchive", label: t("hunts.unarchive"), icon: <ArchiveRestore className="h-4 w-4" aria-hidden /> } : { id: "archive", label: t("hunts.archive"), icon: <Archive className="h-4 w-4" aria-hidden /> },
            { id: "delete", label: t("hunts.delete"), icon: <Trash2 className="h-4 w-4" aria-hidden />, danger: true },
          ]}
          onPick={(a) => onAction(a, hunt)}
        />
      </div>
    </li>
  );
}

/** A small menu: a round button, and a list that closes on a pick, a click outside or Escape. */
function Menu({ label, items, onPick }: { label: string; items: { id: HuntAction; label: string; icon: React.ReactNode; danger?: boolean }[]; onPick(a: HuntAction): void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        box.current?.querySelector<HTMLElement>("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", off);
    document.addEventListener("keydown", esc);
    box.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="sh-hunt-menu">
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label={label} className="absolute right-0 top-12 z-30 min-w-[180px] overflow-hidden rounded-2xl border border-foreground/[0.1] bg-card p-1.5 shadow-[0_20px_50px_-12px_hsl(var(--shade)/0.6)]">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(it.id);
              }}
              className={cn("flex h-11 w-full items-center gap-2.5 rounded-xl px-3 text-left text-[14px] font-medium transition-colors hover:bg-foreground/[0.06] focus-visible:bg-foreground/[0.06] focus-visible:outline-none", it.danger && "text-destructive")}
              data-testid={`sh-menu-${it.id}`}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Every found shiny, the newest first: a case of foil-edged cards, each on its own lit stage. */
export function TrophiesView({ state, names, onOpen }: { state: HuntsState; names: Names; onOpen(h: Hunt): void }) {
  const t = useT(counter);
  const locale = useLocale();
  const list = trophies(state);
  const total = list.reduce((s, h) => s + (h.found?.count ?? h.count), 0);
  const dateFmt = new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: "medium" });
  if (!list.length)
    return (
      <div className="sh-stage dark-scope flex flex-col items-center rounded-[30px] px-6 py-16 text-center" data-testid="sh-trophies">
        <div className="sh-beam" aria-hidden />
        <span className="relative flex h-28 w-28 items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-[radial-gradient(closest-side,rgb(255_201_60/0.35),transparent)]" aria-hidden />
          <Trophy className="relative h-14 w-14 text-[#ffd75e] drop-shadow-[0_6px_14px_rgb(255_190_40/0.5)]" strokeWidth={1.8} aria-hidden />
          <Twinkles scale={0.8} />
        </span>
        <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-white/70">{t("trophies.empty")}</p>
      </div>
    );
  return (
    <div data-testid="sh-trophies">
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-b from-[#ffe27a] to-[#f5a516] text-[#3a2200] shadow-[inset_0_-3px_0_rgb(0_0_0/0.18),0_8px_20px_-8px_rgb(255_190_40/0.6)]" aria-hidden>
          <Trophy className="h-5 w-5" strokeWidth={2.4} />
        </span>
        <div>
          <h2 className="font-display text-[22px] font-bold leading-tight tracking-tight">{t("trophies.count", { n: list.length })}</h2>
          <p className="sh-num text-[13.5px] text-muted-foreground">{t("trophies.total", { n: total })}</p>
        </div>
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4 lg:gap-x-5 lg:gap-y-7">
        {list.map((h) => (
          <li key={h.id}>
            <button type="button" onClick={() => onOpen(h)} className="sh-foil block w-full text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/60" data-testid="sh-trophy">
              <span className="block overflow-hidden rounded-[22px] bg-card">
                <ShinyStage id={h.species} type={names.type(h.species)} compact className="rounded-none px-4 pb-1 pt-5" figureClassName="w-full">
                  <span className="sh-holo pointer-events-none absolute inset-0" aria-hidden />
                  <span className="sh-num absolute left-2.5 top-2.5 rounded-full bg-black/40 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-white/80 ring-1 ring-white/10 backdrop-blur">
                    #{String(h.species).padStart(4, "0")}
                  </span>
                  <Sparkle className="absolute right-3 top-3 h-4 w-4 text-[#ffd75e] drop-shadow-[0_0_6px_rgb(255_215_94/0.8)]" />
                </ShinyStage>
                <span className="block px-3.5 pb-3.5 pt-3">
                  <span className="block truncate font-display text-[16.5px] font-bold leading-tight">{h.name || names.name(h.species)}</span>
                  <span className="sh-num mt-1 block font-display text-[14px] font-bold text-[hsl(var(--warning))]">{t("trophies.encounters", { n: h.found?.count ?? h.count })}</span>
                  <span className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <GameSwatch game={h.game} className="h-3.5 w-3.5" />
                    <span className="truncate">{t(`games.${h.game}`)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                    {t("trophies.found", { date: dateFmt.format(new Date(h.found?.date ?? h.updatedAt)) })}<span className="max-sm:hidden"> · <span className="sh-num">{clock(h.found?.timeMs ?? h.timeMs)}</span></span>
                  </span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
