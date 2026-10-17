import { cn } from "@/lib/utils";

/** "01 // BASE STATS" — HUD-style section heading. */
export function HudHeading({
  index,
  title,
  aside,
  className,
  as: Tag = "h2",
}: {
  index?: string | number;
  title: string;
  aside?: React.ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-2 border-b border-white/[0.07] pb-2", className)}>
      <Tag className="flex items-baseline gap-3 font-display text-xl font-bold uppercase tracking-[0.06em] sm:text-2xl">
        {index !== undefined && (
          <span className="font-pixel text-[11px] tracking-widest text-primary">{`${String(index).padStart(2, "0")} //`}</span>
        )}
        {title}
      </Tag>
      {aside && <div className="hud-label normal-case tracking-wider">{aside}</div>}
    </div>
  );
}
