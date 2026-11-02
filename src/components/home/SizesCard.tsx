import Link from "next/link";
import { ArrowRight, Ruler } from "lucide-react";

/** Silhouettes growing along a ground line, in type colours: a size chart in miniature. */
const FIGURES = [
  { h: 8, w: 9, c: "#f2c94c" },
  { h: 14, w: 12, c: "#6fbf73" },
  { h: 22, w: 17, c: "#5aa6f0" },
  { h: 34, w: 26, c: "#f0884d" },
  { h: 52, w: 36, c: "#9b7be8" },
  { h: 80, w: 60, c: "#4fb4c8" },
  { h: 124, w: 96, c: "#e2557a" },
];

/** Home page feature card for /pokedex/sizes. */
export function SizesCard() {
  let x = 70;
  return (
    <Link
      href="/pokedex/sizes"
      className="group relative block overflow-hidden rounded-lg border bg-card transition-[border-color,transform] hover:-translate-y-0.5 hover:border-screen/50 motion-reduce:transition-none"
      data-testid="home-sizes-card"
    >
      <div className="grid items-center gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="flex items-center gap-4 p-5">
          <span className="screen flex h-14 w-14 shrink-0 items-center justify-center rounded-md text-screen">
            <Ruler className="relative z-[3] h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="hud-label mb-1 text-screen">New · 3D · Make a video</p>
            <h3 className="font-display text-lg font-bold uppercase tracking-wide">Pokémon sizes</h3>
            <p className="text-sm text-muted-foreground">Every Pokémon to scale in a sunny Lumiose City, from 0.1 m to Eternamax Eternatus. Compare any of them and make a size video.</p>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground md:hidden" aria-hidden />
        </div>
        <div className="screen relative h-36 md:h-full md:min-h-[9rem]" aria-hidden>
          <svg viewBox="0 0 600 180" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
            <defs>
              <linearGradient id="sz-card-sky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#5fa8ff" stopOpacity="0.28" />
                <stop offset="1" stopColor="#5fa8ff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="600" height="160" fill="url(#sz-card-sky)" />
            {/* A lattice tower far behind. */}
            <path d="M520 160 L540 40 L548 18 L556 40 L576 160 M528 112 L568 112 M534 76 L562 76" stroke="#9fd8ff" strokeOpacity="0.35" strokeWidth="2" fill="none" />
            <circle cx="548" cy="16" r="4" fill="#9fe8ff" opacity="0.7" />
            <g className="origin-[70px_160px] transition-transform duration-700 group-hover:scale-[1.04] motion-reduce:transition-none">
              {FIGURES.map((f, i) => {
                const fx = x;
                x += f.w + 12;
                return <rect key={i} x={fx} y={160 - f.h} width={f.w} height={f.h} rx={Math.min(f.w, f.h) * 0.45} fill={f.c} opacity={0.88} />;
              })}
            </g>
            <line x1="40" y1="161" x2="600" y2="161" stroke="#ffd84a" strokeOpacity="0.7" strokeWidth="2" />
          </svg>
          <div className="absolute inset-x-4 bottom-2.5 flex justify-between font-display text-xs font-semibold tabular-nums text-foreground/85">
            <span>0.1 m</span>
            <span>100 m</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
