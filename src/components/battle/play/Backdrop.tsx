/**
 * The battle field's backdrop, PokéIQ's own: a dusk sky with stars and a
 * moon, mountain silhouettes, a glowing horizon and a perspective grid
 * floor with the two platforms. Drawn in Showdown's 640×360 stage
 * coordinates inside the backdrop layer, which sits 90 px higher than the
 * stage (Earthquake shakes it).
 */

const Y = 90;
const HORIZON = 150;

export function Backdrop({ trickRoom, tint }: { trickRoom: boolean; tint?: string }) {
  const sky = trickRoom
    ? "linear-gradient(180deg, hsl(300 45% 10%) 0%, hsl(305 45% 20%) 60%, hsl(320 55% 34%) 100%)"
    : "linear-gradient(180deg, hsl(246 60% 9%) 0%, hsl(254 56% 17%) 45%, hsl(270 52% 28%) 78%, hsl(305 55% 40%) 100%)";
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden>
      {/* Sky. */}
      <div className="absolute inset-x-0 top-0" style={{ height: Y + HORIZON + 6, background: sky }} />
      {/* Stars, fading toward the horizon. */}
      <div
        className="absolute inset-x-0 top-0 opacity-80"
        style={{
          height: Y + HORIZON - 20,
          backgroundImage:
            "radial-gradient(1px 1px at 12px 18px, #fff, transparent), radial-gradient(1px 1px at 58px 44px, #fff, transparent), radial-gradient(1.5px 1.5px at 96px 12px, #fff, transparent), radial-gradient(1px 1px at 140px 70px, #fff, transparent), radial-gradient(1px 1px at 182px 30px, hsl(300 90% 90%), transparent)",
          backgroundSize: "200px 90px",
          WebkitMaskImage: "linear-gradient(#000 40%, transparent)",
          maskImage: "linear-gradient(#000 40%, transparent)",
        }}
      />
      {/* Moon and its glow. */}
      <div className="absolute rounded-full" style={{ left: 520 - 70, top: Y + 40 - 70, width: 140, height: 140, background: "radial-gradient(closest-side, hsl(300 90% 85% / 0.28), transparent)" }} />
      <div className="absolute rounded-full" style={{ left: 520 - 22, top: Y + 40 - 22, width: 44, height: 44, background: "radial-gradient(circle at 35% 35%, hsl(300 100% 96%), hsl(290 70% 78%) 70%)", boxShadow: "0 0 24px hsl(300 90% 80% / 0.7)" }} />
      {/* Mountains: far, then near. */}
      <svg className="absolute left-0" style={{ top: Y + 92, width: 640, height: 66 }} viewBox="0 0 640 66" preserveAspectRatio="none">
        <path d="M0 66 L0 40 L60 18 L110 36 L170 6 L230 34 L290 20 L340 40 L400 10 L470 38 L520 24 L580 44 L640 22 L640 66 Z" fill="hsl(262 45% 22%)" />
        <path d="M0 66 L0 52 L80 34 L140 50 L210 30 L270 52 L330 40 L390 56 L450 36 L520 54 L590 42 L640 52 L640 66 Z" fill="hsl(258 45% 15%)" />
      </svg>
      {/* Horizon glow. */}
      <div className="absolute inset-x-0" style={{ top: Y + HORIZON - 16, height: 34, background: "radial-gradient(70% 100% at 50% 50%, hsl(var(--screen) / 0.45), transparent 75%)" }} />
      {/* Floor. */}
      <div className="absolute inset-x-0 bottom-0" style={{ top: Y + HORIZON, background: "linear-gradient(180deg, hsl(258 42% 14%) 0%, hsl(250 40% 9%) 100%)" }} />
      {/* Perspective grid on the floor. */}
      <div className="absolute overflow-hidden" style={{ left: -320, right: -320, top: Y + HORIZON, bottom: 0, perspective: 260, perspectiveOrigin: "50% 0%" }}>
        <div
          className="absolute inset-0 origin-top"
          style={{
            transform: "rotateX(62deg)",
            backgroundImage: "linear-gradient(hsl(var(--screen) / 0.35) 1.5px, transparent 1.5px), linear-gradient(90deg, hsl(var(--screen) / 0.35) 1.5px, transparent 1.5px)",
            backgroundSize: "48px 48px",
            backgroundPosition: "center top",
            WebkitMaskImage: "linear-gradient(transparent, #000 25%, #000)",
            maskImage: "linear-gradient(transparent, #000 25%, #000)",
          }}
        />
      </div>
      {tint && <div className="absolute inset-x-0 bottom-0 transition-opacity duration-700" style={{ top: Y + HORIZON, background: `linear-gradient(${tint}, transparent 85%)` }} />}
      {/* Platforms: the opponent's, then yours. */}
      <div className="absolute rounded-[50%]" style={{ left: 430 - 115, top: Y + 168, width: 230, height: 50, background: "radial-gradient(closest-side, hsl(var(--screen) / 0.5), hsl(var(--screen) / 0.14) 72%, transparent)", boxShadow: "inset 0 0 0 1.5px hsl(var(--screen) / 0.35)" }} />
      <div className="absolute rounded-[50%]" style={{ left: 210 - 170, top: Y + 296, width: 340, height: 80, background: "radial-gradient(closest-side, hsl(var(--primary) / 0.45), hsl(var(--primary) / 0.12) 72%, transparent)", boxShadow: "inset 0 0 0 1.5px hsl(var(--primary) / 0.35)" }} />
    </div>
  );
}
