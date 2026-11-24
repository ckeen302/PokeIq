import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** The hub's heading: the "free" line with its light, then the big italic title. */
export function HubHeading({ title, free, className, children }: { title: string; free: string; className?: string; children?: React.ReactNode }) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="space-y-2.5 max-sm:space-y-2">
        <p className="flex items-center gap-2 font-display text-[11px] uppercase leading-none tracking-[0.3em] text-success">
          <span className="led h-1.5 w-1.5 animate-blink motion-reduce:animate-none" aria-hidden /> {free}
        </p>
        <h1 className="th-title pr-2 font-display text-5xl font-bold uppercase italic leading-[0.9] tracking-tight sm:text-6xl lg:text-7xl">{title}</h1>
      </div>
      {children}
    </header>
  );
}

/** The chunky pink "Open" (inside a card that is itself the link). */
export function OpenPill({ label, className, big }: { label: string; className?: string; big?: boolean }) {
  return (
    <span
      className={cn(
        "th-btn relative inline-flex w-fit items-center gap-2 overflow-hidden rounded-lg bg-primary font-display font-bold uppercase tracking-[0.08em] text-primary-foreground",
        big ? "h-12 px-7 text-[15px]" : "h-10 px-5 text-sm",
        className
      )}
    >
      {big && (
        <span
          className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent [transform:translateX(-120%)_skewX(-20deg)] motion-safe:animate-shine motion-reduce:hidden"
          aria-hidden
        />
      )}
      {label} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </span>
  );
}

/** A round arrow in a tile's corner. */
export function CornerArrow({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/35 text-white/80 backdrop-blur transition-colors group-hover:border-transparent group-hover:bg-primary group-hover:text-primary-foreground",
        className
      )}
      aria-hidden
    >
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
    </span>
  );
}
