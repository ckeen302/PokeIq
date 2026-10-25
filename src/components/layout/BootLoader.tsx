/**
 * Animated PokéIQ mark for loading states: the brain-topped Poké Ball
 * wobbles like a catch in progress, its folds trace themselves in, and the
 * psychic core sends out ripples. Pure SVG + CSS, so it renders before any
 * JavaScript loads. `idPrefix` keeps gradient ids unique when two are on
 * the page at once.
 */
export function BootLoader({ idPrefix, label = "Loading" }: { idPrefix: string; label?: string }) {
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <div className="flex flex-col items-center gap-5" role="status" aria-label={`${label}…`}>
      <div className="relative h-28 w-28">
        <span className="boot-ripple" aria-hidden />
        <span className="boot-ripple [animation-delay:0.9s]" aria-hidden />
        <span className="boot-beam" aria-hidden />
        <span className="boot-rays" aria-hidden>
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <i key={a} style={{ transform: `rotate(${a}deg)` }} />
          ))}
        </span>
        <svg viewBox="0 0 100 100" className="boot-ball relative h-full w-full overflow-visible" aria-hidden>
          <defs>
            <linearGradient id={id("brain")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ff8ab4" />
              <stop offset="1" stopColor="#e2306f" />
            </linearGradient>
            <linearGradient id={id("shell")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="1" stopColor="#d9d4f5" />
            </linearGradient>
            <radialGradient id={id("core")} cx="0.5" cy="0.45" r="0.6">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.45" stopColor="#d6c8ff" />
              <stop offset="1" stopColor="#8b5cf6" />
            </radialGradient>
          </defs>
          <g className="boot-bottom">
            <path d="M5 50a45 45 0 0 0 90 0z" fill={`url(#${id("shell")})`} />
            <path d="M5 50a45 45 0 0 0 90 0" fill="none" stroke="#120f24" strokeWidth="6" />
          </g>
          <g className="boot-top">
          <path d="M5 50a45 45 0 0 1 90 0z" fill={`url(#${id("brain")})`} />
          <g className="boot-gyri" fill="none" stroke="#7a0d3a" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.75">
            {GYRI.map((d) => (
              <path key={d} d={d} pathLength={1} />
            ))}
          </g>
          <path d="M20 22c6-8 15-12 24-13" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity="0.45" />
          <path d="M5 50a45 45 0 0 1 90 0" fill="none" stroke="#120f24" strokeWidth="6" />
          <rect x="5" y="45.5" width="90" height="4.5" fill="#120f24" />
          </g>
          <rect x="5" y="50" width="90" height="4.5" fill="#120f24" />
          <circle cx="50" cy="50" r="15" fill="#120f24" />
          <circle className="boot-core" cx="50" cy="50" r="10" fill={`url(#${id("core")})`} />
          <circle cx="50" cy="50" r="10" fill="none" stroke="#a78bfa" strokeWidth="1.5" />
        </svg>
      </div>
      <div className="text-center">
        <div className="font-display text-xl font-bold uppercase tracking-[0.2em]">
          Poké<span className="text-primary">IQ</span>
        </div>
        <div className="hud-label mt-2 text-screen">
          {label}
          <span className="boot-dots" aria-hidden />
        </div>
      </div>
    </div>
  );
}

const GYRI = [
  "M50 8c-4 6 4 11 0 17s3 9 0 15",
  "M42 11c-6 1-7 7-12 8s-9 6-6 11",
  "M17 41c3-5 9-3 12-7s9-3 12 0",
  "M30 26c4 2 8 0 10 4",
  "M58 11c6 1 7 7 12 8s9 6 6 11",
  "M83 41c-3-5-9-3-12-7s-9-3-12 0",
  "M70 26c-4 2-8 0-10 4",
  "M25 33c2-2 5-2 6 0",
  "M75 33c-2-2-5-2-6 0",
  "M37 41c1-3 4-4 6-2",
  "M63 41c-1-3-4-4-6-2",
];
