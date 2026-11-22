"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** The maker's small building blocks, in the site's look: segmented switches, round icon buttons and a modal sheet. */

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className,
  size = "md",
  testId,
}: {
  value: T;
  options: readonly { value: T; label: ReactNode; disabled?: boolean; testId?: string }[];
  onChange(v: T): void;
  label: string;
  className?: string;
  size?: "sm" | "md";
  testId?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-full bg-foreground/[0.06] p-1", className)} data-testid={testId}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            data-testid={o.testId}
            className={cn(
              "flex-1 whitespace-nowrap rounded-full font-semibold transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35 motion-reduce:transition-none",
              size === "sm" ? "h-8 px-3 text-[13px] max-md:h-10" : "h-9 px-4 text-sm max-md:h-10",
              on ? "bg-card text-foreground shadow-[0_1px_3px_hsl(var(--shade)/0.35),0_0_0_1px_hsl(var(--foreground)/0.06)]" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function IconButton({ label, onClick, children, disabled, active, className, testId, ...rest }: { label: string; onClick?(): void; children: ReactNode; disabled?: boolean; active?: boolean; className?: string; testId?: string } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      data-testid={testId}
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35 max-md:h-11 max-md:w-11",
        active && "bg-foreground/[0.08] text-foreground",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function PillButton({ children, onClick, primary, className, disabled, testId, type = "button" }: { children: ReactNode; onClick?(): void; primary?: boolean; className?: string; disabled?: boolean; testId?: string; type?: "button" | "submit" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-[filter,background-color,transform] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px disabled:pointer-events-none disabled:opacity-40 max-md:h-11",
        primary ? "bg-primary text-primary-foreground hover:brightness-110" : "bg-foreground/[0.07] text-foreground hover:bg-foreground/[0.11]",
        className
      )}
    >
      {children}
    </button>
  );
}

/**
 * A modal: a centred card on wide screens and a sheet from the bottom on phones. Escape and the backdrop close it,
 * the focus moves in and goes back where it was.
 */
export function Modal({ title, onClose, children, wide, testId, closeLabel }: { title: string; onClose(): void; children: ReactNode; wide?: boolean; testId?: string; closeLabel: string }) {
  const close = useRef(onClose);
  close.current = onClose;
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>("input, select, textarea, [data-autofocus]") ?? panel.current?.querySelector<HTMLElement>("button");
    first?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
      }
      if (e.key === "Tab" && panel.current) {
        const f = [...panel.current.querySelectorAll<HTMLElement>("button:not([disabled]), input, select, textarea, a[href], [tabindex='0']")];
        if (!f.length) return;
        const i = f.indexOf(document.activeElement as HTMLElement);
        const to = e.shiftKey && i <= 0 ? f[f.length - 1] : !e.shiftKey && i === f.length - 1 ? f[0] : null;
        if (to) {
          e.preventDefault();
          to.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      before?.focus?.({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div className="tlm-app fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-6" data-testid={testId}>
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={() => close.current()} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "tlm-rise relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-foreground/[0.08] bg-card text-card-foreground shadow-[0_30px_80px_-20px_rgb(0_0_0/0.6)] sm:rounded-[28px]",
          wide ? "sm:max-w-3xl" : "sm:max-w-md"
        )}
      >
        <div className="flex items-center justify-between gap-3 px-6 pb-2 pt-5 max-sm:px-5">
          <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
          <IconButton label={closeLabel} onClick={() => close.current()} className="-mr-2">
            <X className="h-5 w-5" aria-hidden />
          </IconButton>
        </div>
        <div className="tlm-scroll min-h-0 overflow-y-auto px-6 pb-6 pt-1 max-sm:px-5 max-sm:pb-[max(20px,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>,
    document.body
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
