import Link from "next/link";
import { ArrowRight, Flag } from "lucide-react";

/** Runners strung out down the lanes towards the line: a race in miniature. */
const RUNNERS = [
  { lane: 0, x: 448, r: 9, c: "#f2c94c" },
  { lane: 1, x: 392, r: 11, c: "#5aa6f0" },
  { lane: 2, x: 470, r: 10, c: "#e2557a" },
  { lane: 3, x: 330, r: 13, c: "#6fbf73" },
  { lane: 4, x: 418, r: 9, c: "#9b7be8" },
  { lane: 5, x: 254, r: 12, c: "#f0884d" },
];

/** Home page feature card for /pokedex/race. */
export function RaceCard() {
  return (
    <Link
      href="/pokedex/race"
      className="group relative block overflow-hidden rounded-lg border bg-card transition-[border-color,transform] hover:-translate-y-0.5 hover:border-screen/50 motion-reduce:transition-none"
      data-testid="home-race-card"
    >
      <div className="grid items-center gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="flex items-center gap-4 p-5">
          <span className="screen flex h-14 w-14 shrink-0 items-center justify-center rounded-md text-screen">
            <Flag className="relative z-[3] h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="hud-label mb-1 text-screen">New · 3D · Make a video</p>
            <h3 className="font-display text-lg font-bold uppercase tracking-wide">Pokémon race</h3>
            <p className="text-sm text-muted-foreground">Which Pokémon is fastest? Watch them sprint 100, 200 or 400 m in a floodlit stadium, with speeds from their stats. Shuckle vs Regieleki, the fastest eight, or your own race.</p>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground md:hidden" aria-hidden />
        </div>
        <div className="screen relative h-36 md:h-full md:min-h-[9rem]" aria-hidden>
          <svg viewBox="0 0 600 180" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
            <defs>
              <linearGradient id="rc-card-glow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ffd84a" stopOpacity="0.18" />
                <stop offset="1" stopColor="#ffd84a" stopOpacity="0" />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="600" height="60" fill="url(#rc-card-glow)" />
            {/* Floodlight banks. */}
            {[90, 510].map((x) => (
              <g key={x} opacity="0.75">
                <rect x={x - 22} y="8" width="44" height="14" rx="2" fill="#1b2235" />
                {[0, 1, 2, 3].map((i) => <circle key={i} cx={x - 15 + i * 10} cy="15" r="3" fill="#fff6d8" />)}
              </g>
            ))}
            {/* Lanes. */}
            {RUNNERS.map((_, i) => (
              <rect key={i} x="0" y={52 + i * 20} width="600" height="20" fill={i % 2 ? "#a63a2d" : "#b4432f"} opacity="0.85" />
            ))}
            {[0, 1, 2, 3, 4, 5, 6].map((i) => <line key={i} x1="0" y1={52 + i * 20} x2="600" y2={52 + i * 20} stroke="#fff" strokeOpacity="0.6" strokeWidth="1.2" />)}
            <rect x="520" y="52" width="5" height="120" fill="#fff" opacity="0.95" />
            <g className="transition-transform duration-700 group-hover:translate-x-3 motion-reduce:transition-none">
              {RUNNERS.map((r) => (
                <g key={r.lane}>
                  <ellipse cx={r.x - r.r * 1.6} cy={62 + r.lane * 20} rx={r.r * 1.4} ry="2" fill="#fff" opacity="0.18" />
                  <circle cx={r.x} cy={62 + r.lane * 20 - 2} r={r.r * 0.7} fill={r.c} />
                </g>
              ))}
            </g>
          </svg>
          <div className="absolute inset-x-4 bottom-2.5 flex justify-between font-display text-xs font-semibold tabular-nums text-foreground/85">
            <span>100 m</span>
            <span>400 m</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
