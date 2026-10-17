/* eslint-disable @next/next/no-img-element -- tiny static SVG */
import { cn } from "@/lib/utils";

/** Brain + Poké Ball mark with the PokéIQ wordmark. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("group flex items-center gap-2.5", className)}>
      <img
        src="/logo.svg"
        alt=""
        width={32}
        height={32}
        className="h-8 w-8 drop-shadow-[0_0_10px_hsl(var(--primary)/0.45)] transition-transform duration-300 group-hover:rotate-[-12deg]"
      />
      <span className="font-display text-lg font-bold uppercase tracking-[0.08em]">
        Poké<span className="text-primary">IQ</span>
      </span>
    </span>
  );
}
