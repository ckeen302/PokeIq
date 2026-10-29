import { cn } from "@/lib/utils";

/**
 * The PokéGuessr hub's building blocks: a section heading (Play,
 * Multiplayer, Maps, You) and the menu tile each entry point sits on, a
 * picture or a tinted banner above its name, a line on it, and its action.
 */

export function HubSection({
  id,
  eyebrow,
  title,
  aside,
  children,
  className,
}: {
  id: string;
  eyebrow: string;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-24 space-y-4", className)} data-testid={`geo-hub-${id}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-border/70 pb-2">
        <div className="space-y-1">
          <p className="hud-label text-screen">{eyebrow}</p>
          <h2 id={`${id}-title`} className="font-display text-2xl font-bold uppercase tracking-tight sm:text-3xl">
            {title}
          </h2>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export type TileTone = "primary" | "warning" | "success" | "screen" | "muted";
const TONE: Record<TileTone, { label: string; ring: string; wash: string }> = {
  primary: { label: "text-primary", ring: "hover:border-primary/60", wash: "from-primary/35" },
  warning: { label: "text-warning", ring: "hover:border-warning/60", wash: "from-warning/30" },
  success: { label: "text-success", ring: "hover:border-success/60", wash: "from-success/30" },
  screen: { label: "text-screen", ring: "hover:border-screen/60", wash: "from-screen/30" },
  muted: { label: "text-muted-foreground", ring: "", wash: "from-muted/40" },
};

export function HubTile({
  tone = "screen",
  image,
  icon,
  label,
  title,
  blurb,
  stat,
  action,
  disabled,
  className,
  testId,
  badge,
}: {
  tone?: TileTone;
  /** A picture for the banner (a CDN-cached preview); a tinted banner with the icon without one. */
  image?: string | null;
  icon: React.ReactNode;
  label: string;
  title: string;
  blurb: React.ReactNode;
  stat?: React.ReactNode;
  action?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  testId?: string;
  /** A corner flag on the banner ("Coming soon", "Done"). */
  badge?: React.ReactNode;
}) {
  const t = TONE[tone];
  return (
    <div
      className={cn(
        "group flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm transition-colors",
        !disabled && t.ring,
        disabled && "opacity-70",
        className
      )}
      data-testid={testId}
      aria-disabled={disabled || undefined}
    >
      <div className={cn("relative aspect-[16/7] overflow-hidden bg-gradient-to-br to-transparent", t.wash)}>
        {image && (
          // eslint-disable-next-line @next/next/no-img-element -- CDN-cached preview
          <img src={image} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover opacity-80 transition-[opacity,transform] duration-300 group-hover:scale-[1.03] group-hover:opacity-100" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/30 to-transparent" aria-hidden />
        <span className={cn("absolute bottom-2 left-3 flex h-9 w-9 items-center justify-center rounded-md border bg-card/90 backdrop-blur", t.label)} aria-hidden>
          {icon}
        </span>
        {badge && <span className="absolute right-2 top-2">{badge}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4 pt-3">
        <p className={cn("hud-label", t.label)}>{label}</p>
        <p className="font-display text-xl font-bold uppercase leading-tight">{title}</p>
        <div className="text-sm text-muted-foreground">{blurb}</div>
        {stat && <div className="hud-label text-warning">{stat}</div>}
        {action && <div className="mt-auto pt-2">{action}</div>}
      </div>
    </div>
  );
}

/** The little flag on a tile's banner. */
export function TileFlag({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "success" | "warning" }) {
  return (
    <span
      className={cn(
        "rounded-sm border px-1.5 py-1 font-pixel text-[9px] uppercase leading-none tracking-wider backdrop-blur",
        tone === "success" ? "border-success/60 bg-success/20 text-success" : tone === "warning" ? "border-warning/60 bg-warning/20 text-warning" : "border-border bg-card/85 text-muted-foreground"
      )}
    >
      {children}
    </span>
  );
}
