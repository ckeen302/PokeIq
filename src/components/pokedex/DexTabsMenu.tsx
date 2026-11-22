"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { usePathname } from "@/i18n/navigation";
import { Check, ChevronDown } from "lucide-react";
import Link from "@/components/ui/Link";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import dexTabs from "@/messages/dex-tabs";

/** The Pokémon list and the reference sections. (Timeline, Sizes and Race live in the 3D Lab.) */
const TABS = [
  { id: "pokemon", href: "/pokedex" },
  { id: "moves", href: "/pokedex/moves" },
  { id: "abilities", href: "/pokedex/abilities" },
  { id: "items", href: "/pokedex/items" },
  { id: "places", href: "/pokedex/places" },
  { id: "types", href: "/pokedex/types" },
  { id: "natures", href: "/pokedex/natures" },
  { id: "trainers", href: "/pokedex/trainers" },
  { id: "tcg", href: "/pokedex/tcg" },
] as const;

/** After the divider: the franchise and its lore, beyond the Pokédex itself. */
const MORE_TABS = [
  { id: "games", href: "/pokedex/games" },
  { id: "movies", href: "/pokedex/movies" },
  { id: "theories", href: "/pokedex/theories" },
] as const;

export type DexTabId = (typeof TABS)[number]["id"] | (typeof MORE_TABS)[number]["id"];

const MENU_ID = "dex-sections-menu";

/**
 * Top-level Pokédex sections: one big button naming the current section, which
 * opens the list of them all. Each section is its own static page so no section
 * ships another's data. The links are always in the page (hidden while the menu
 * is closed), so search engines still find every section.
 */
export function DexTabsMenu({ active }: { active: DexTabId }) {
  const t = useT(dexTabs);
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();
  const current = [...TABS, ...MORE_TABS].find((t) => t.id === active) ?? TABS[0];

  // A new page closes the menu.
  useEffect(() => setOpen(false), [pathname]);

  // Escape or a click outside closes it.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = () => [...(menuRef.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]') ?? [])];
  /** Opens the menu and puts the keyboard on an item (the current section unless `at` says otherwise). */
  const openAt = (at: "current" | "first" | "last") => {
    setOpen(true);
    requestAnimationFrame(() => {
      const list = items();
      const target = at === "first" ? list[0] : at === "last" ? list.at(-1) : list.find((a) => a.getAttribute("aria-current") === "page") ?? list[0];
      target?.focus();
    });
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      // Already open (a quick second press before the focus moved): step from the current section.
      if (open) {
        const list = items();
        const at = list.findIndex((a) => a.getAttribute("aria-current") === "page");
        list[(at + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
        return;
      }
      openAt(e.key === "ArrowDown" ? "current" : "last");
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLAnchorElement);
    const go = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Tab") setOpen(false);
  };

  const item = (tab: (typeof TABS)[number] | (typeof MORE_TABS)[number]) => {
    const on = tab.id === active;
    return (
      <Link
        key={tab.id}
        href={tab.href}
        role="menuitem"
        tabIndex={-1}
        aria-current={on ? "page" : undefined}
        data-testid={`dex-tab-${tab.id}`}
        onClick={() => setOpen(false)}
        className={cn(
          "flex h-[42px] shrink-0 items-center justify-between rounded-[5px] border px-4 font-display text-[13px] font-semibold uppercase tracking-[0.1em] outline-none transition-colors motion-reduce:transition-none",
          on
            ? "border-primary/45 bg-primary/[0.14] text-foreground"
            : "border-transparent text-foreground/80 hover:border-border hover:bg-accent/60 hover:text-foreground focus-visible:border-border focus-visible:bg-accent/60 focus-visible:text-foreground"
        )}
      >
        {t(`tabs.${tab.id}`)}
        {on && <Check className="h-3.5 w-3.5 text-primary" strokeWidth={3} aria-hidden />}
      </Link>
    );
  };

  return (
    <nav
      ref={navRef}
      aria-label={t("sections")}
      // Focus leaving the menu (Tab past it) closes it too.
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOpen(false)}
      className="relative z-40 mx-auto w-full max-w-xl"
    >
      <button
        ref={buttonRef}
        type="button"
        data-testid="dex-section-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={MENU_ID}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onButtonKey}
        className="relative flex w-full items-center justify-center rounded-md border border-transparent bg-primary px-16 py-3 font-display text-lg font-bold uppercase tracking-[0.14em] text-primary-foreground transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none sm:text-xl"
      >
        <span className="absolute left-5 font-pixel text-[10px] font-normal tracking-[0.12em] text-primary-foreground/75 max-md:left-4">{t("section")}</span>
        {t(`tabs.${current.id}`)}
        <span className="absolute inset-y-0 right-0 flex w-14 items-center justify-center border-l border-primary-foreground/[0.28]" aria-hidden>
          <ChevronDown className={cn("h-[18px] w-[18px] transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} strokeWidth={2.6} />
        </span>
      </button>
      <div
        ref={menuRef}
        id={MENU_ID}
        role="menu"
        aria-label={t("sections")}
        data-testid="dex-section-menu"
        onKeyDown={onMenuKey}
        className={cn(
          "absolute inset-x-0 top-full mt-2 flex-col gap-1.5 rounded-lg border border-border bg-card p-2 text-left shadow-[0_24px_60px_hsl(var(--shade)/0.65),0_0_0_1px_hsl(var(--shade)/0.4)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-150",
          open ? "flex" : "hidden"
        )}
      >
        <div role="none" className="flex flex-col gap-0.5">{TABS.map(item)}</div>
        <span role="separator" className="mx-2 h-px shrink-0 bg-border" />
        <div role="none" className="flex flex-col gap-0.5">{MORE_TABS.map(item)}</div>
      </div>
    </nav>
  );
}
