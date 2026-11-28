"use client";

/* eslint-disable @next/next/no-img-element -- the site's own pre-sized Pokémon pictures, lazy and sized by their box */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { typeColor, typeTextColor } from "@/lib/pokemon/type-colors";
import { artSrc } from "@/lib/nuzlocke/view";
import { versionColor } from "@/lib/nuzlocke/versions";
import type { Translator } from "@/i18n/catalog";
import type nuz from "@/messages/nuzlocke";

/** The tracker's small building blocks, in the site's look (they follow the theme: light and dark). */

export type NuzT = Translator<typeof nuz.en>;

/** A Pokémon's picture; a missing one leaves its box empty rather than a broken image. */
export function Sprite({ art, className, eager, dim }: { art: number | null | undefined; className?: string; eager?: boolean; dim?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (!art || broken) return <span className={cn("block", className)} aria-hidden />;
  return (
    <img
      src={artSrc(art)}
      alt=""
      width={96}
      height={96}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      onError={() => setBroken(true)}
      className={cn("pointer-events-none select-none object-contain", dim && "nz-dim", className)}
    />
  );
}

export function TypeChip({ t, type, size = "md", className }: { t: NuzT; type: string; size?: "sm" | "md"; className?: string }) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center rounded-full font-semibold leading-none", size === "sm" ? "h-[18px] px-1.5 text-[10.5px]" : "h-6 px-2.5 text-[12px]", className)}
      style={{ background: typeColor(type), color: typeTextColor(type) }}
    >
      {t(`types.${type}` as "types.normal")}
    </span>
  );
}

export function VersionDot({ id, className }: { id: string; className?: string }) {
  return <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-foreground/10", className)} style={{ background: versionColor(id) }} aria-hidden />;
}

/** An on/off switch with its label and one line of explanation beside it. */
export function Switch({ checked, onChange, label, text, disabled, testId }: { checked: boolean; onChange?(v: boolean): void; label: string; text: string; disabled?: boolean; testId?: string }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3.5 rounded-2xl px-1 py-2", disabled && "cursor-default")}>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-snug">{label}</span>
        <span className="mt-0.5 block text-[13.5px] leading-snug text-muted-foreground">{text}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        data-testid={testId}
        className={cn(
          "relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 motion-reduce:transition-none",
          checked ? "bg-primary" : "bg-foreground/[0.16]"
        )}
      >
        <span className={cn("absolute left-0.5 h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.35)] transition-transform motion-reduce:transition-none", checked && "translate-x-5")} />
      </button>
    </label>
  );
}

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  href?: string;
  external?: boolean;
}

/** A round "more" button and its list: closes on a pick, a click outside or Escape; arrow keys move through it. */
export function Menu({ label, items, onPick, align = "end", className, testId, trigger }: { label: string; items: MenuItem[]; onPick(id: string): void; align?: "start" | "end"; className?: string; testId?: string; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      const list = [...(box.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([aria-disabled=true])") ?? [])];
      const i = list.indexOf(document.activeElement as HTMLElement);
      if (e.key === "Escape") {
        setOpen(false);
        box.current?.querySelector<HTMLElement>("button")?.focus();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        list[(i + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus();
      }
    };
    document.addEventListener("pointerdown", off);
    document.addEventListener("keydown", key);
    box.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", off);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div ref={box} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid={testId}
        className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-11 max-md:w-11"
      >
        {trigger ?? <MoreHorizontal className="h-5 w-5" aria-hidden />}
      </button>
      {open && (
        <div role="menu" aria-label={label} className={cn("nz-pop absolute top-full z-50 mt-1.5 min-w-[220px] overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card p-1.5 shadow-[0_18px_44px_-12px_hsl(var(--shade)/0.7)]", align === "end" ? "right-0" : "left-0")}>
          {items.map((it) => {
            const cls = cn(
              "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[14.5px] font-medium transition-colors focus-visible:outline-none focus-visible:bg-foreground/[0.07] hover:bg-foreground/[0.06]",
              it.danger && "text-destructive",
              it.disabled && "pointer-events-none opacity-45"
            );
            const inner = (
              <>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground [&>svg]:h-[18px] [&>svg]:w-[18px]" aria-hidden>
                  {it.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
              </>
            );
            return it.href ? (
              <a key={it.id} role="menuitem" href={it.href} target={it.external ? "_blank" : undefined} rel={it.external ? "noopener" : undefined} className={cls} onClick={() => setOpen(false)} data-testid={`menu-${it.id}`}>
                {inner}
              </a>
            ) : (
              <button
                key={it.id}
                type="button"
                role="menuitem"
                aria-disabled={it.disabled || undefined}
                className={cls}
                onClick={() => {
                  setOpen(false);
                  onPick(it.id);
                }}
                data-testid={`menu-${it.id}`}
              >
                {inner}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface ToastState {
  id: number;
  text: string;
  undo?: () => void;
}

/** The toast along the bottom (above the phone's bars), with Undo when the change can be taken back. */
export function Toast({ toast, undoLabel, onDone }: { toast: ToastState | null; undoLabel: string; onDone(): void }) {
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(onDone, toast.undo ? 7000 : 3200);
    return () => window.clearTimeout(id);
  }, [toast, onDone]);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 z-[90] flex justify-center px-4 bottom-[calc(var(--tabbar-h)+5.25rem)] lg:bottom-8">
      {toast && (
        <div key={toast.id} className="nz-rise pointer-events-auto flex max-w-[min(560px,100%)] items-center gap-3 rounded-full bg-foreground py-2 pl-5 pr-2 text-[14px] font-semibold text-background shadow-[0_18px_40px_-12px_rgb(0_0_0/0.55)]" data-testid="nz-toast">
          <span className="min-w-0 truncate py-1.5">{toast.text}</span>
          {toast.undo ? (
            <button
              type="button"
              onClick={() => {
                toast.undo?.();
                onDone();
              }}
              className="h-9 shrink-0 rounded-full bg-background/15 px-4 text-[13.5px] font-bold uppercase tracking-wide transition-colors hover:bg-background/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="nz-undo"
            >
              {undoLabel}
            </button>
          ) : (
            <span className="w-3" />
          )}
        </div>
      )}
    </div>
  );
}

/** "3 hours ago", in the page's language. */
export function relativeTime(ms: number, locale: string, justNow: string, now = Date.now()): string {
  const s = Math.round((ms - now) / 1000);
  if (Math.abs(s) < 60) return justNow;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86400],
    ["week", 604800],
    ["month", 2629800],
    ["year", 31557600],
  ];
  let unit: Intl.RelativeTimeFormatUnit = "minute";
  let size = 60;
  for (const [u, n] of steps) if (Math.abs(s) >= n) [unit, size] = [u, n];
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(Math.round(s / size), unit);
}
