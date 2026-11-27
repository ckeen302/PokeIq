import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Every section's page header, one shape: a kicker on a violet tab, the title in bold italic display capitals with
 * the PokéGuessr wordmark's hard shadow (its last words in the site's pink, as "Poké<Guessr>"), an optional line under
 * it, and actions on the right (under it on a phone). Works by night and by day from the theme's tokens.
 */
export function PageHeader({
  kicker,
  live,
  title,
  accent,
  subtitle,
  actions,
  align = "left",
  as: Tag = "h1",
  id,
  className,
}: {
  kicker?: React.ReactNode;
  /** A small light before the kicker (green: open now, free). */
  live?: boolean;
  title: React.ReactNode;
  /** The title's last words, in the accent. */
  accent?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  align?: "left" | "center";
  as?: "h1" | "h2";
  id?: string;
  className?: string;
}) {
  const center = align === "center";
  return (
    <header
      className={cn(
        "flex flex-wrap gap-x-6 gap-y-4",
        center ? "flex-col items-center text-center" : "items-end justify-between",
        className
      )}
      data-testid="page-header"
    >
      <div className={cn("min-w-0 space-y-3 max-sm:space-y-2.5", center && "flex flex-col items-center")}>
        {kicker && (
          <p className="kit-tab">
            {live && <span className="led h-1.5 w-1.5 text-success" aria-hidden />}
            {kicker}
          </p>
        )}
        <Tag id={id} className="kit-title pr-1 text-[2.6rem] sm:text-[3.4rem] lg:text-6xl">
          {title}
          {accent && <span className="text-primary">{accent}</span>}
        </Tag>
        {subtitle && <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground sm:text-base">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * A section's heading inside a page: the same italic display face, smaller, over a hairline. `index` keeps a
 * section's own numbering ("01 //" in Battle); `aside` sits on the right.
 */
export function SectionHeader({
  title,
  index,
  icon,
  aside,
  id,
  as: Tag = "h2",
  className,
}: {
  title: React.ReactNode;
  index?: number;
  icon?: React.ReactNode;
  aside?: React.ReactNode;
  id?: string;
  as?: "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-surface-line pb-2.5", className)}>
      <Tag id={id} className="flex items-center gap-2.5 font-display text-xl font-bold uppercase italic leading-none tracking-tight sm:text-2xl">
        {index !== undefined && (
          <span className="shrink-0 font-pixel text-[11px] not-italic tracking-widest text-select" aria-hidden>{`${String(index).padStart(2, "0")} //`}</span>
        )}
        {icon}
        {title}
      </Tag>
      {aside && <div className="text-sm text-muted-foreground">{aside}</div>}
    </div>
  );
}
