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
        <h1 className="pr-2 font-display text-5xl font-bold uppercase italic leading-[0.9] tracking-tight [text-shadow:0_0_30px_hsl(var(--screen)/0.35)] sm:text-6xl lg:text-7xl">{title}</h1>
      </div>
      {children}
    </header>
  );
}

/** The chunky pink "Open" (inside a card that is itself the link). */
export function OpenPill({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-10 w-fit items-center gap-2 rounded-lg bg-primary px-5 font-display text-sm font-bold uppercase tracking-[0.08em] text-primary-foreground shadow-[0_4px_0_hsl(var(--primary-shadow)),0_0_26px_hsl(var(--primary)/0.3)] transition-[filter,transform,opacity] group-hover:brightness-110",
        className
      )}
    >
      {label} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </span>
  );
}
