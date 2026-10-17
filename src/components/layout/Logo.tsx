import { cn } from "@/lib/utils";

/** Device-style wordmark: a glowing Pokédex lens with status LEDs. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span className="relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-foreground/90 bg-[radial-gradient(circle_at_35%_35%,hsl(186_95%_80%),hsl(var(--screen))_45%,hsl(200_90%_25%))] shadow-[0_0_12px_hsl(var(--screen)/0.6)]">
        <span className="absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-white/80" aria-hidden />
      </span>
      <span className="flex gap-1" aria-hidden>
        <span className="led h-1.5 w-1.5 text-primary" />
        <span className="led h-1.5 w-1.5 text-warning" />
        <span className="led h-1.5 w-1.5 text-success" />
      </span>
      <span className="font-display text-lg font-bold uppercase tracking-[0.08em]">
        Poké<span className="text-primary">IQ</span>
      </span>
    </span>
  );
}
