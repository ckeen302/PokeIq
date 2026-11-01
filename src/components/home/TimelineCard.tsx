import Link from "next/link";
import { ArrowRight, History } from "lucide-react";
import { ERAS, LANES, ROMAN } from "@/lib/timeline/types";

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
        <div className="screen relative h-36 md:h-full md:min-h-[9rem]" aria-hidden>
          <svg viewBox="0 0 600 180" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
            <defs>
              <filter id="tl-card-glow" x="-20%" y="-50%" width="140%" height="200%">
                <feGaussianBlur stdDeviation="2.2" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <linearGradient id="tl-card-fade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fff" stopOpacity="0" />
                <stop offset="1" stopColor="#fff" stopOpacity="0.5" />
              </linearGradient>
            </defs>
            {/* Tracks running to the vanishing point. */}
            {LANES.map((l, i) => (
              <line key={l.id} x1={300 + (i - 2.5) * 6} y1={58} x2={300 + (i - 2.5) * 190} y2={200} stroke={`hsl(${l.color})`} strokeOpacity={0.55} strokeWidth={1.4} filter="url(#tl-card-glow)" />
            ))}
            {/* One ring per era, the first nearest. */}
            <g className="origin-[300px_58px] transition-transform duration-700 group-hover:scale-[1.06] motion-reduce:transition-none">
              {ERAS.map((e, i) => {
                const k = ERAS.length - 1 - i;
                const rx = 26 * Math.pow(1.62, k);
                return <ellipse key={e.id} cx={300} cy={58 + k * 9} rx={rx} ry={rx * 0.34} fill="none" stroke={e.a} strokeOpacity={0.35 + 0.1 * k} strokeWidth={1 + k * 0.35} filter="url(#tl-card-glow)" />;
              })}
            </g>
            <rect x="0" y="120" width="600" height="60" fill="url(#tl-card-fade)" opacity="0.08" />
          </svg>
          <div className="absolute inset-x-4 top-3 flex justify-between font-pixel text-[9px] uppercase tracking-[0.14em]">
            {ERAS.map((e) => (
              <span key={e.id} style={{ color: e.a }}>
                {e.gens.map((g) => ROMAN[g]).join("–")}
              </span>
            ))}
          </div>
          <div className="absolute inset-x-4 bottom-2.5 flex justify-between font-display text-xs font-semibold tabular-nums text-foreground/85">
            <span>1996</span>
            <span>Today</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
