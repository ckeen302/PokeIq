import Link from "next/link";
import { ArrowRight, History } from "lucide-react";
import { ERAS, ROMAN } from "@/lib/timeline/types";

/** Home page feature card for /pokedex/timeline: the eras as a glowing track running into the distance. */
export function TimelineCard() {
  return (
    <Link
      href="/pokedex/timeline"
      className="group relative block overflow-hidden rounded-lg border bg-card transition-[border-color,transform] hover:-translate-y-0.5 hover:border-screen/50 motion-reduce:transition-none"
      data-testid="home-timeline-card"
    >
      <div className="grid items-center gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="flex items-center gap-4 p-5">
          <span className="screen flex h-14 w-14 shrink-0 items-center justify-center rounded-md text-screen">
            <History className="relative z-[3] h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="hud-label mb-1 text-screen">New · 3D</p>
            <h3 className="font-display text-lg font-bold uppercase tracking-wide">Pokémon timeline</h3>
            <p className="text-sm text-muted-foreground">Fly through Pokémon history from Red and Green to today: games, anime, films, cards and milestones.</p>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground md:hidden" aria-hidden />
        </div>
        <div className="screen relative h-32 md:h-full md:min-h-[8.5rem]" aria-hidden>
          <div className="absolute inset-0 [perspective:340px]">
            <div className="absolute inset-x-[-30%] bottom-[-10%] top-[38%] origin-bottom [transform:rotateX(62deg)]">
              <div className="absolute inset-0 opacity-50 [background-image:linear-gradient(hsl(var(--screen)/0.35)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--screen)/0.2)_1px,transparent_1px)] [background-size:28px_28px]" />
              <div className="absolute inset-x-0 top-1/2 flex h-2 -translate-y-1/2">
                {ERAS.map((e) => (
                  <span key={e.id} className="flex-1" style={{ background: `linear-gradient(90deg, ${e.a}, ${e.b})`, boxShadow: `0 0 14px ${e.a}` }} />
                ))}
              </div>
            </div>
          </div>
          <div className="absolute inset-x-4 top-3 flex justify-between font-pixel text-[9px] uppercase tracking-[0.14em]">
            {ERAS.map((e) => (
              <span key={e.id} style={{ color: e.a }} className="transition-transform duration-300 group-hover:-translate-y-0.5">
                {e.gens.map((g) => ROMAN[g]).join("–")}
              </span>
            ))}
          </div>
          <div className="absolute inset-x-4 bottom-2.5 flex justify-between font-display text-xs font-semibold tabular-nums text-foreground/80">
            <span>1996</span>
            <span className="text-muted-foreground">→</span>
            <span>Today</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
