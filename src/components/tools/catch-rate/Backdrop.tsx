"use client";

import { memo } from "react";

/**
 * The battle's backdrop, drawn in CSS and SVG (nothing to download): a sky or a cave's rock, the hills on the
 * horizon, the ground, and the two battle platforms (the wild Pokémon's, far right, and yours, near left). It sits in
 * the scene's own coordinates, set by CSS variables on the scene: --hz the horizon, --ex/--ey/--ew the wild
 * Pokémon's platform (centre and width) and --px/--py yours. Motion (drifting clouds, twinkling stars, rolling
 * waves) is CSS only and off for reduced motion.
 */

export type Place = "day" | "night" | "cave" | "sea" | "seaNight";

interface Look {
  sky: string;
  far: string;
  near: string;
  ground: string;
  rim: string;
  top: string;
  inner: string;
}

const LOOKS: Record<Place, Look> = {
  day: {
    sky: "linear-gradient(180deg, #5fb8f2 0%, #9ad6fb 45%, #e4f6ff 100%)",
    far: "#9ccfc0",
    near: "#6cbd62",
    ground: "linear-gradient(180deg, #8fd96c 0%, #6cc456 40%, #4c9f3f 100%)",
    rim: "#3d8a35",
    top: "#8edd6a",
    inner: "#b4f08f",
  },
  night: {
    sky: "linear-gradient(180deg, #070b24 0%, #18205a 55%, #3a3478 100%)",
    far: "#222b5e",
    near: "#18284a",
    ground: "linear-gradient(180deg, #1d3f45 0%, #16303a 45%, #0d1c25 100%)",
    rim: "#0f2a2c",
    top: "#2c5d55",
    inner: "#3d7868",
  },
  cave: {
    sky: "radial-gradient(70% 60% at 62% 30%, #6b5444 0%, #3d2f27 45%, #1d1612 100%)",
    far: "#2f241e",
    near: "#3c2e25",
    ground: "linear-gradient(180deg, #5c4737 0%, #45352a 45%, #241b15 100%)",
    rim: "#33261d",
    top: "#7c6352",
    inner: "#957a66",
  },
  sea: {
    sky: "linear-gradient(180deg, #4aa9ea 0%, #8fd0f7 50%, #dff3ff 100%)",
    far: "#79b6cf",
    near: "#4c9ac0",
    ground: "linear-gradient(180deg, #3ca3e0 0%, #2681c9 45%, #155a9e 100%)",
    rim: "rgb(255 255 255 / 0.28)",
    top: "rgb(190 236 255 / 0.55)",
    inner: "rgb(255 255 255 / 0.35)",
  },
  seaNight: {
    sky: "linear-gradient(180deg, #060a22 0%, #142057 55%, #2c3a7a 100%)",
    far: "#1c2a58",
    near: "#16264b",
    ground: "linear-gradient(180deg, #17407a 0%, #0f2c5c 45%, #081a3a 100%)",
    rim: "rgb(160 200 255 / 0.22)",
    top: "rgb(120 170 255 / 0.32)",
    inner: "rgb(200 225 255 / 0.25)",
  },
};

export const SCENE_CSS = `
@keyframes cr-drift { from { transform: translateX(-30%) } to { transform: translateX(130%) } }
@keyframes cr-twinkle { 0%, 100% { opacity: .25 } 50% { opacity: 1 } }
@keyframes cr-waves { to { background-position: 160px 0, -120px 0 } }
@keyframes cr-bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-3.5%) } }
@keyframes cr-hand { 0%, 100% { transform: translateY(0) rotate(-8deg) } 50% { transform: translateY(-6px) rotate(6deg) } }
@keyframes cr-zzz { 0% { transform: translate(0, 0) scale(.6); opacity: 0 } 25% { opacity: 1 } 100% { transform: translate(18px, -34px) scale(1.1); opacity: 0 } }
@keyframes cr-blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
@keyframes cr-spark { 0%, 100% { opacity: 0 } 10%, 30% { opacity: 1 } 40% { opacity: 0 } }
.cr-cloud { animation: cr-drift linear infinite }
.cr-star { animation: cr-twinkle ease-in-out infinite both }
.cr-waves { animation: cr-waves 9s linear infinite }
.cr-bob { animation: cr-bob 3.4s ease-in-out infinite }
.cr-hand { animation: cr-hand 2.6s ease-in-out infinite }
.cr-zzz { animation: cr-zzz 2.4s ease-out infinite both }
.cr-blink { animation: cr-blink 1s steps(1) infinite }
.cr-spark { animation: cr-spark 1.6s linear infinite both }
@media (prefers-reduced-motion: reduce) {
  [class*="cr-"] { animation: none !important }
}
`;

/** Seeded scatter (the same sky and grass every time, on the server and in the browser alike). */
function scatter(seed: number, n: number) {
  let x = seed;
  const r = () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: n }, () => ({ a: r(), b: r(), c: r(), d: r() }));
}
const STARS = scatter(11, 46);
const TUFTS = scatter(5, 14);
const CLOUDS = [
  { top: 8, w: 150, h: 34, dur: 95, delay: -20, o: 0.9 },
  { top: 20, w: 100, h: 24, dur: 120, delay: -75, o: 0.75 },
  { top: 4, w: 80, h: 20, dur: 140, delay: -110, o: 0.6 },
];

function Platform({ look, sea, className, style }: { look: Look; sea: boolean; className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 400 100" className={className} style={style} aria-hidden>
      {sea ? (
        <>
          <ellipse cx="200" cy="52" rx="196" ry="42" fill={look.top} />
          <ellipse cx="200" cy="52" rx="160" ry="32" fill="none" stroke={look.inner} strokeWidth="5" />
          <ellipse cx="200" cy="52" rx="112" ry="22" fill="none" stroke={look.inner} strokeWidth="4" />
          <ellipse cx="200" cy="52" rx="64" ry="12" fill="none" stroke={look.rim} strokeWidth="3" />
        </>
      ) : (
        <>
          <ellipse cx="200" cy="60" rx="198" ry="38" fill={look.rim} />
          <ellipse cx="200" cy="50" rx="192" ry="38" fill={look.top} />
          <ellipse cx="200" cy="46" rx="150" ry="26" fill={look.inner} opacity="0.7" />
          <ellipse cx="170" cy="40" rx="80" ry="10" fill="#fff" opacity="0.18" />
        </>
      )}
    </svg>
  );
}

export const Backdrop = memo(function Backdrop({ place, darkGrass }: { place: Place; darkGrass: boolean }) {
  const look = LOOKS[place];
  const sea = place === "sea" || place === "seaNight";
  const night = place === "night" || place === "seaNight";
  const cave = place === "cave";
  const day = place === "day" || place === "sea";
  return (
    <div className="absolute inset-0" aria-hidden data-place={place}>
      {/* The sky (or the cave's rock). */}
      <div className="absolute inset-0" style={{ background: look.sky }} />
      {day && (
        <>
          <div className="absolute -right-[8%] -top-[18%] h-[60%] w-[46%] rounded-full bg-[radial-gradient(closest-side,rgb(255_250_220/0.95),rgb(255_240_180/0.35)_45%,transparent)]" />
          {CLOUDS.map((c, i) => (
            <div key={i} className="cr-cloud absolute left-0" style={{ top: `${c.top}%`, animationDuration: `${c.dur}s`, animationDelay: `${c.delay}s` }}>
              <div className="relative" style={{ width: c.w, height: c.h, opacity: c.o }}>
                <div className="absolute inset-x-0 bottom-0 h-[60%] rounded-full bg-white" />
                <div className="absolute bottom-[20%] left-[18%] h-[90%] w-[42%] rounded-full bg-white" />
                <div className="absolute bottom-[25%] left-[46%] h-[70%] w-[34%] rounded-full bg-white" />
              </div>
            </div>
          ))}
        </>
      )}
      {night && (
        <>
          {STARS.map((s, i) => (
            <span
              key={i}
              className="cr-star absolute rounded-full bg-white"
              style={{ left: `${s.a * 100}%`, top: `${s.b * 40}%`, width: 1 + s.c * 2.2, height: 1 + s.c * 2.2, animationDuration: `${2.4 + s.d * 3}s`, animationDelay: `${-s.d * 4}s` }}
            />
          ))}
          <div className="absolute right-[9%] top-[7%] h-[13%] max-h-[64px] min-h-[40px] w-auto rounded-full bg-[#fff6d8] shadow-[0_0_40px_12px_rgb(255_240_190/0.35)] [aspect-ratio:1]" />
        </>
      )}
      {cave && (
        <>
          {/* Light falling through a gap in the roof, and the roof's stalactites. */}
          <div className="absolute left-[48%] top-0 h-[75%] w-[30%] -skew-x-[14deg] bg-[linear-gradient(180deg,rgb(255_226_170/0.28),transparent)] blur-md" />
          <svg viewBox="0 0 400 60" preserveAspectRatio="none" className="absolute inset-x-0 top-0 h-[20%] w-full">
            <path d="M0 0H400V10L388 34 376 12 360 46 344 14 326 28 310 8 292 40 276 12 258 24 240 6 222 44 206 14 188 30 170 10 152 50 136 16 118 26 100 8 84 38 66 12 50 30 34 10 18 42 0 14Z" fill="#170f0b" opacity="0.9" />
          </svg>
          {[18, 34, 77, 88].map((x, i) => (
            <span key={x} className="absolute h-2 w-2 rotate-45 rounded-[2px] bg-[#9fe8ff] shadow-[0_0_14px_4px_rgb(120_220_255/0.55)]" style={{ left: `${x}%`, top: `calc(var(--hz) - ${6 + i * 3}%)`, opacity: 0.8 }} />
          ))}
        </>
      )}
      {/* The horizon: far hills, near hills (or rock, or islands). */}
      <svg viewBox="0 0 400 60" preserveAspectRatio="none" className="absolute inset-x-0 h-[16%] w-full" style={{ bottom: "calc(100% - var(--hz) - 1px)" }}>
        {sea ? (
          <>
            <path d="M40 60 Q70 30 104 44 Q130 22 160 60Z" fill={look.far} />
            <path d="M290 60 Q318 38 352 48 Q370 40 392 60Z" fill={look.far} opacity="0.8" />
          </>
        ) : (
          <>
            <path d="M0 60V34Q40 8 90 28T190 22T300 16T400 30V60Z" fill={look.far} />
            <path d="M0 60V44Q60 26 120 42T250 36T400 44V60Z" fill={look.near} />
          </>
        )}
      </svg>
      {/* The ground (or the sea). */}
      <div className="absolute inset-x-0 bottom-0" style={{ top: "var(--hz)", background: look.ground }}>
        {sea && (
          <div
            className="cr-waves absolute inset-0 opacity-60"
            style={{
              backgroundImage: "repeating-linear-gradient(180deg, transparent 0 22px, rgb(255 255 255 / 0.16) 22px 24px), radial-gradient(60% 8px at 50% 50%, rgb(255 255 255 / 0.22), transparent)",
              backgroundSize: "160px 100%, 120px 40px",
            }}
          />
        )}
        {!sea &&
          TUFTS.map((s, i) => (
            <svg key={i} viewBox="0 0 20 10" className="absolute w-[3%] min-w-[12px]" style={{ left: `${s.a * 96}%`, top: `${10 + s.b * 80}%`, opacity: 0.35 + s.c * 0.3 }}>
              <path d="M2 10 L5 2 L7 10 M8 10 L10 0 L12 10 M13 10 L15 3 L18 10" stroke={cave ? "#2a1f18" : night ? "#0c2224" : "#3f8f34"} strokeWidth="1.6" fill="none" strokeLinecap="round" />
            </svg>
          ))}
      </div>
      {/* The platforms. */}
      <Platform look={look} sea={sea} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: "var(--ex)", top: "var(--ey)", width: "var(--ew)" }} />
      <Platform look={look} sea={sea} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: "var(--px)", top: "var(--py)", width: "calc(var(--ew) * 1.3)" }} />
      {darkGrass && (
        <svg viewBox="0 0 400 60" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-[24%] w-full">
          <path d="M0 60V22L8 40 14 8 22 38 30 14 38 42 46 4 54 36 62 16 70 40 78 6 86 38 94 18 102 42 110 10 118 36 126 2 134 40 142 14 150 38 158 6 166 42 174 16 182 36 190 4 198 40 206 12 214 38 222 6 230 42 238 18 246 36 254 2 262 40 270 14 278 38 286 8 294 42 302 16 310 36 318 4 326 40 334 12 342 38 350 6 358 42 366 18 374 36 382 8 390 40 400 20V60Z" fill="#163f22" />
          <path d="M0 60V40L10 50 18 30 26 52 36 34 46 54 56 30 66 52 76 36 86 54 96 28 106 52 116 34 126 54 136 30 146 52 156 36 166 54 176 32 186 52 196 34 206 54 216 30 226 52 236 36 246 54 256 32 266 52 276 34 286 54 296 30 306 52 316 36 326 54 336 32 346 52 356 34 366 54 376 30 386 52 400 38V60Z" fill="#0d2b16" />
        </svg>
      )}
      {/* A soft vignette, so the HUD and the text box read on any backdrop. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_45%,transparent_55%,rgb(0_0_0/0.28))]" />
    </div>
  );
});
