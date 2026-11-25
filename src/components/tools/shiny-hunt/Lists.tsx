"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus, Share2, Sparkles, Trash2, Trophy } from "lucide-react";
import { useT } from "@/i18n/client";
import { useLocale } from "@/i18n/navigation";
import { INTL_LOCALE, formatNumber } from "@/i18n/format";
import counter from "@/messages/shiny-counter";
import { shinyChance } from "@/lib/shiny-hunt/odds";
import { clock, oneIn } from "@/lib/shiny-hunt/math";
import { activeHunts, archived, trophies, type Hunt, type HuntsState } from "@/lib/shiny-hunt/store";
import { cn } from "@/lib/utils";
import { MonArt, Twinkles } from "./Art";
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
          <h2 className="font-display text-[20px] font-semibold tracking-tight">{t("hunts.active")}</h2>
          <button type="button" onClick={onNew} className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-[14px] font-semibold text-primary-foreground transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="sh-new-hunt">
            <Plus className="h-4 w-4" aria-hidden /> {t("hunts.new")}
          </button>
        </div>
        {active.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((h) => (
              <HuntCard key={h.id} hunt={h} names={names} current={h.id === state.current} onAction={onAction} />
            ))}
          </ul>
        ) : (
          <p className="sh-panel rounded-[22px] border border-dashed border-foreground/[0.12] px-5 py-8 text-center text-[15px] text-muted-foreground">{t("hunts.empty")}</p>
        )}
      </section>
      {old.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-[20px] font-semibold tracking-tight">{t("hunts.archivedTitle")}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
  const isArchived = hunt.status === "archived";
  return (
    <li className={cn("sh-panel group relative flex items-center gap-3 rounded-[22px] border p-3 pr-2 transition-colors", current ? "border-primary/45" : "border-foreground/[0.08]", isArchived && "opacity-80")} data-testid="sh-hunt-card">
      <button type="button" onClick={() => onAction("open", hunt)} className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="sh-hunt-open">
        <span className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[radial-gradient(closest-side,hsl(var(--warning)/0.18),transparent)]">
          <MonArt id={hunt.species} shiny size="sm" className="h-14 w-14" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[16px] font-semibold" data-testid="sh-hunt-name">{name}</span>
            {current && <span className="shrink-0 rounded-full bg-primary/12 px-2 py-0.5 text-[11.5px] font-semibold text-primary">{t("hunts.current")}</span>}
            {hunt.found && <Sparkles className="h-4 w-4 shrink-0 text-[hsl(var(--warning))]" aria-hidden />}
          </span>
          <span className="sh-num block text-[14px] font-semibold text-foreground/85">{t("hunts.encounters", { n: hunt.count })}</span>
          <span className="block truncate text-[12.5px] text-muted-foreground">
            {t(`games.${hunt.game}`)} · {t("counter.odds", { n: formatNumber(oneIn(p), locale) })}
          </span>
        </span>
      </button>
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

/** Every found shiny, the newest first, on a shelf. */
export function TrophiesView({ state, names, onOpen }: { state: HuntsState; names: Names; onOpen(h: Hunt): void }) {
  const t = useT(counter);
  const locale = useLocale();
  const list = trophies(state);
  const total = list.reduce((s, h) => s + (h.found?.count ?? h.count), 0);
  const dateFmt = new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: "medium" });
  if (!list.length)
    return (
      <div className="sh-stage flex flex-col items-center rounded-[28px] border border-foreground/[0.08] px-6 py-14 text-center" data-testid="sh-trophies">
        <span className="relative flex h-24 w-24 items-center justify-center rounded-full bg-[hsl(var(--warning)/0.12)]">
          <Trophy className="h-10 w-10 text-[hsl(var(--warning))]" aria-hidden />
          <Twinkles scale={0.8} />
        </span>
        <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-muted-foreground">{t("trophies.empty")}</p>
      </div>
    );
  return (
    <div data-testid="sh-trophies">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-display text-[20px] font-semibold tracking-tight">{t("trophies.count", { n: list.length })}</h2>
        <p className="text-[14px] text-muted-foreground">{t("trophies.total", { n: total })}</p>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {list.map((h) => (
          <li key={h.id}>
            <button type="button" onClick={() => onOpen(h)} className="sh-stage group flex w-full flex-col items-center rounded-[24px] border border-foreground/[0.08] px-3 pb-4 pt-3 text-center transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none" data-testid="sh-trophy">
              <span className="relative block aspect-square w-full max-w-[150px]">
                <MonArt id={h.species} shiny className="h-full w-full drop-shadow-[0_10px_14px_hsl(var(--shade)/0.35)]" />
                <Twinkles scale={0.7} />
              </span>
              <span className="mt-1 block w-full truncate font-display text-[16px] font-semibold">{h.name || names.name(h.species)}</span>
              <span className="sh-num block text-[13px] font-semibold text-[hsl(var(--warning))]">{t("trophies.encounters", { n: h.found?.count ?? h.count })}</span>
              <span className="block w-full truncate text-[12px] text-muted-foreground">{t("trophies.found", { date: dateFmt.format(new Date(h.found?.date ?? h.updatedAt)) })}</span>
              <span className="block w-full truncate text-[12px] text-muted-foreground">{t(`games.${h.game}`)} · {clock(h.found?.timeMs ?? h.timeMs)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
