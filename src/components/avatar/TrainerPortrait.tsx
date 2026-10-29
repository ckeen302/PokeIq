import { HAIR_BANGS, colorHex, eyeHex, hairHex, skinHex, type TrainerConfig } from "@/lib/trainer/config";

/**
 * A trainer's small portrait: the 3D trainer's head and shoulders drawn as
 * flat SVG (same presets and colours), for names in lists, chats and the
 * header. No three.js, no images to fetch, crisp at any size, and it renders
 * on the server. Clip it to a circle (the <Avatar> frame does).
 */

function mix(hex: string, toward: string, amount: number): string {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(toward.slice(1), 16);
  const ch = (shift: number) => Math.round(((a >> shift) & 255) * (1 - amount) + ((b >> shift) & 255) * amount);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}
const darker = (hex: string, k = 0.18) => mix(hex, "#000000", k);
const lighter = (hex: string, k = 0.75) => mix(hex, "#ffffff", k);

const HEAD = { cx: 32, cy: 30, r: 15.5 };
const INK = "#2a1c18";
const OPEN_TOPS = new Set(["jacket", "vest", "coat", "labcoat", "suit", "shirt", "longcoat"]);

export function TrainerPortrait({ trainer: t, size = 32, className, title }: { trainer: TrainerConfig; size?: number; className?: string; title?: string }) {
  const skin = skinHex(t.skin);
  const hair = hairHex(t.hairColor);
  const top = colorHex(t.topColor);
  const trim = colorHex(t.topTrim);
  const accent = colorHex(t.accent);
  const acc = colorHex(t.accColor);
  const hatted = t.hat !== "none" && t.hat !== "headband";
  const open = OPEN_TOPS.has(t.top) && (!t.closed || t.top === "suit" || t.top === "longcoat");
  const bare = t.top === "tank" || t.top === "croptop" || t.top === "dress";
  const cape = colorHex(t.capeColor);
  const capeTrim = colorHex(t.capeTrim);

  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} data-testid="trainer-portrait">
      {title && <title>{title}</title>}
      <rect width="64" height="64" fill={lighter(top === "#1d1e22" || top === "#363940" ? accent : top, 0.72)} />
      <circle cx="32" cy="70" r="40" fill={lighter(top, 0.6)} />

      {/* Cape and hair behind the head */}
      {t.cape !== "none" && <path d="M3 64 C5 52, 12 45, 22 44 L42 44 C52 45, 59 52, 61 64 Z" fill={t.cape === "royal" ? darker(cape, 0.1) : capeTrim} />}
      {t.cape === "collar" && <path d="M17 50 L19 33 L27 44 Z M47 50 L45 33 L37 44 Z" fill={cape} />}
      <HairBack t={t} color={hair} acc={acc} />

      {/* Shoulders and top */}
      <path d="M7 64 C8 52, 18 46.5, 32 46.5 C46 46.5, 56 52, 57 64 Z" fill={bare ? skin : t.top === "vest" ? accent : top} />
      {bare && <path d="M15 64 C16 54, 22 48, 32 48 C42 48, 48 54, 49 64 Z" fill={top} />}
      {t.top === "hoodie" && <path d="M19 48.5 C22 44, 42 44, 45 48.5 C40 47, 24 47, 19 48.5 Z" fill={darker(top, 0.12)} />}
      {t.top === "vest" && <path d="M14 64 C15 55, 20 49, 26 47.5 L32 60 L38 47.5 C44 49, 49 55, 50 64 Z" fill={top} />}
      {open && <path d="M26 46.8 L32 60 L38 46.8 C36 46.5, 28 46.5, 26 46.8 Z" fill={accent} />}
      {open && t.top !== "vest" && <path d="M26 46.8 L32 60 L29.5 64 L23.5 47.3 Z M38 46.8 L32 60 L34.5 64 L40.5 47.3 Z" fill={t.top === "jacket" ? trim : darker(top, 0.1)} />}
      {(t.top === "shirt" || t.top === "labcoat" || t.top === "suit" || t.top === "uniform") && <path d="M27 46.5 L32 51 L29 53 Z M37 46.5 L32 51 L35 53 Z" fill={t.top === "shirt" || t.top === "uniform" ? lighter(top, 0.1) : accent} />}
      {t.top === "longcoat" && <path d="M20 48 C24 45, 40 45, 44 48 C41 50, 23 50, 20 48 Z" fill={trim} />}
      {t.top === "track" && <path d="M31.2 47 h1.6 V64 h-1.6 Z" fill={accent} />}
      {(t.top === "tee" || t.top === "longtee" || bare) && <path d="M26.5 46.9 C28 50, 36 50, 37.5 46.9" fill="none" stroke={trim} strokeWidth="1.6" />}
      {t.top === "uniform" && t.emblem !== "none" && <circle cx="32" cy="58" r="3.4" fill={trim} />}
      {t.cape === "royal" && <path d="M12 52 C18 45, 46 45, 52 52 C46 49, 18 49, 12 52 Z" fill={capeTrim} stroke={darker(capeTrim, 0.1)} strokeWidth="2" />}
      {(t.pack === "classic" || t.pack === "explorer") && (
        <g fill={darker(colorHex(t.packTrim), 0.15)}>
          <path d="M15.5 50.5 l4 -2.5 l3 16 h-4 Z" />
          <path d="M48.5 50.5 l-4 -2.5 l-3 16 h4 Z" />
        </g>
      )}
      {(t.pack === "satchel" || t.pack === "shoulder") && <path d="M20 48 l3 -1.5 L46 64 h-5 Z" fill={darker(colorHex(t.packTrim), 0.15)} />}
      {(t.bottoms === "suspenders" || t.bottoms === "overalls") && <path d="M22 49 h2.4 v15 h-2.4 Z M39.6 49 h2.4 v15 h-2.4 Z" fill={t.bottoms === "overalls" ? colorHex(t.bottomsColor) : colorHex(t.bottomsTrim)} />}
      <Neck t={t} color={acc} />

      {/* Neck, ears, head */}
      <rect x="28" y="40" width="8" height="8" rx="3" fill={darker(skin, 0.1)} />
      <circle cx="16.3" cy="31.5" r="2.6" fill={skin} />
      <circle cx="47.7" cy="31.5" r="2.6" fill={skin} />
      <circle cx={HEAD.cx} cy={HEAD.cy} r={HEAD.r} fill={skin} />
      {t.ears === "drops" && <path d="M15.2 35.5 a1.8 1.8 0 1 0 0.01 0 Z M48.8 35.5 a1.8 1.8 0 1 0 0.01 0 Z" fill={acc} />}
      {(t.ears === "studs" || t.ears === "hoops") && <path d={t.ears === "studs" ? "M15.4 34 a1 1 0 1 0 .01 0 Z M48.6 34 a1 1 0 1 0 .01 0 Z" : "M14 34.5 a1.6 1.6 0 1 0 3 0 M47 34.5 a1.6 1.6 0 1 0 3 0"} fill={t.ears === "studs" ? acc : "none"} stroke={t.ears === "hoops" ? acc : "none"} strokeWidth="0.8" />}

      <Face t={t} skin={skin} hair={hair} />
      <Hair t={t} color={hair} hatted={hatted} acc={acc} />
      {t.hat !== "none" && <Hat t={t} />}
      {t.eyewear !== "none" && !(t.eyewear === "sunglasses" && t.hat === "sunhat") && <Glasses t={t} y={32.5} scale={1} />}
    </svg>
  );
}

function Face({ t, skin, hair }: { t: TrainerConfig; skin: string; hair: string }) {
  const iris = eyeHex(t.eyeColor);
  const brow = darker(hair, hair === "#ecc76d" || hair === "#f1e8d2" ? 0.3 : 0.08);
  const e = t.expr;
  // Brows: inner and outer heights (up is negative).
  const browY: Record<TrainerConfig["expr"], [number, number]> = { happy: [-0.6, -0.6], determined: [1.4, -0.8], smug: [0, -0.8], calm: [0, 0], sleepy: [-0.4, 0.8], surprised: [-1.8, -1.6] };
  const [bi, bo] = browY[e];
  const sharp = t.eyes === "sharp" ? 0.9 : 0;
  const lid = { determined: 1.2, smug: 1.6, sleepy: 2.4, calm: 0.6, happy: 0, surprised: 0 }[e] + (t.eyes === "focused" ? 0.8 : t.eyes === "sharp" ? 1 : 0);
  return (
    <g>
      {t.eyes === "happy" || t.eyes === "squint" ? (
        <g fill="none" stroke={INK} strokeWidth="1.7" strokeLinecap="round">
          <path d={t.eyes === "happy" ? "M23.4 33 q2.6 -3.2 5.2 0" : "M23.2 32.6 q2.8 -0.8 5.6 0"} />
          <path d={t.eyes === "happy" ? "M35.4 33 q2.6 -3.2 5.2 0" : "M35.2 32.6 q2.8 -0.8 5.6 0"} />
        </g>
      ) : (
        [26, 38].map((cx, i) => {
          const s = i ? 1 : -1;
          return (
            <g key={cx}>
              <ellipse cx={cx} cy="32.5" rx="2.8" ry="3.4" fill="#fff" />
              <ellipse cx={cx - s * 0.2} cy="32.9" rx="2.4" ry={e === "surprised" ? 2.2 : 2.9} fill={iris} />
              <ellipse cx={cx - s * 0.2} cy="32.1" rx="2.4" ry="1.6" fill={darker(iris, 0.5)} opacity="0.8" />
              <circle cx={cx - 0.9} cy="31.4" r="0.9" fill="#fff" />
              <g transform={s < 0 ? `translate(${2 * cx} 0) scale(-1 1)` : undefined}>
                {lid > 0 && <path d={`M${cx - 3.2} 28.6 H${cx + 3.2} V${29.1 + lid - sharp} L${cx - 3.2} ${29.1 + lid} Z`} fill={skin} />}
                <path d={lid > 0 ? `M${cx - 3} ${29.3 + lid} L${cx + 3.2} ${29.1 + lid - sharp}` : `M${cx - 2.9} 31 Q${cx} 28.3 ${cx + 2.9} 31`} stroke={INK} strokeWidth={t.eyes === "lashes" ? 1.5 : 1.2} fill="none" strokeLinecap="round" />
              </g>
              {t.eyes === "lashes" && <path d={`M${cx + s * 2.8} ${30.2 + lid * 0.5} l${s * 1.6} -1.2`} stroke={INK} strokeWidth="1" strokeLinecap="round" />}
            </g>
          );
        })
      )}
      <g stroke={brow} strokeWidth="1.3" strokeLinecap="round" fill="none">
        <path d={`M28.6 ${27.4 + bi} Q26 ${26 + Math.min(bi, bo)} 23.2 ${27.4 + bo}`} />
        <path d={`M35.4 ${27.4 + (e === "smug" ? bi + 0.6 : bi)} Q38 ${26 + Math.min(bi, bo)} 40.8 ${27.4 + (e === "smug" ? bo - 1.2 : bo)}`} />
      </g>
      <ellipse cx="21.5" cy="37" rx="2.6" ry="1.5" fill="#ff8f8f" opacity="0.45" />
      <ellipse cx="42.5" cy="37" rx="2.6" ry="1.5" fill="#ff8f8f" opacity="0.45" />
      <Mouth expr={e} />
    </g>
  );
}

function Mouth({ expr }: { expr: TrainerConfig["expr"] }) {
  switch (expr) {
    case "happy":
      return <path d="M29.6 38.2 Q32 39 34.4 38.2 Q32 42.4 29.6 38.2 Z" fill="#8a3236" />;
    case "determined":
      return (
        <g>
          <path d="M29.3 38.4 L34.8 38 Q33 41.3 29.3 38.4 Z" fill="#8a3236" />
          <path d="M29.7 38.4 L34.4 38.1 L34 38.9 L30.2 39.1 Z" fill="#fff" />
        </g>
      );
    case "smug":
      return <path d="M30 39.2 Q32.6 40 34.6 38" fill="none" stroke="#7a2f2c" strokeWidth="1.1" strokeLinecap="round" />;
    case "surprised":
      return <ellipse cx="32" cy="39.2" rx="1.4" ry="1.8" fill="#8a3236" />;
    case "sleepy":
      return <ellipse cx="32" cy="39" rx="0.9" ry="0.8" fill="#8a3236" />;
    default:
      return <path d="M30.6 38.8 Q32 39.8 33.4 38.8" fill="none" stroke="#7a2f2c" strokeWidth="1.1" strokeLinecap="round" />;
  }
}

function Glasses({ t, y, scale }: { t: TrainerConfig; y: number; scale: number }) {
  const frame = colorHex(t.accColor);
  const sun = t.eyewear === "sunglasses";
  const round = t.eyewear === "round";
  return (
    <g transform={`translate(32 ${y}) scale(${scale}) translate(-32 ${-y})`} stroke={frame} strokeWidth="0.9" fill={sun ? "#1d2230" : "none"}>
      {[26, 38].map((cx) => (round ? <circle key={cx} cx={cx} cy={y} r="3.6" /> : <rect key={cx} x={cx - 4} y={y - 3} width="8" height="6" rx="2" />))}
      <path d={`M${round ? 29.6 : 30} ${y - 0.5} H${round ? 34.4 : 34}`} fill="none" />
    </g>
  );
}

function Neck({ t, color }: { t: TrainerConfig; color: string }) {
  switch (t.neck) {
    case "scarf":
      return <path d="M22 46 C26 49.5, 38 49.5, 42 46 L42 50 C38 53, 26 53, 22 50 Z M36 50 L41 64 H36 L33 51 Z" fill={color} />;
    case "pendant":
      return (
        <g>
          <path d="M26 46.5 L32 58 L38 46.5" fill="none" stroke="#3a3036" strokeWidth="0.6" />
          <circle cx="32" cy="58.5" r="2.4" fill={color} stroke={darker(color, 0.3)} strokeWidth="0.6" />
        </g>
      );
    case "cravat":
      return <path d="M29 47 Q32 45.5 35 47 L34.5 53 Q32 55 29.5 53 Z" fill={color} />;
    case "tie":
      return <path d="M31 47 h2 l1 2 l-1 11 h-2 l-1 -11 Z" fill={color} />;
    case "choker":
      return <path d="M28 45 h8" stroke={color} strokeWidth="1.4" />;
    default:
      return null;
  }
}

/** Hair that falls behind the head and shoulders. */
function HairBack({ t, color, acc }: { t: TrainerConfig; color: string; acc: string }) {
  const c = darker(color, 0.12);
  switch (t.hair) {
    case "bob":
      return <path d="M14.5 27 C13.5 35, 14 41, 16.5 44 L47.5 44 C50 41, 50.5 35, 49.5 27 Z" fill={c} />;
    case "long":
      return <path d="M14.5 27 C13 40, 12 50, 15 58 L49 58 C52 50, 51 40, 49.5 27 Z" fill={c} />;
    case "flowing":
      return <path d="M14.5 26 C11 40, 8 52, 9 64 L55 64 C56 52, 53 40, 49.5 26 Z" fill={c} />;
    case "volume":
      return <path d="M30 12 C46 6, 62 16, 62 34 C62 48, 54 58, 46 56 C40 55, 42 48, 47 49 C54 50, 55 38, 50 30 Z M17 20 C10 26, 10 38, 15 44 L18 30 Z" fill={c} />;
    case "ponytail":
      return (
        <g>
          <ellipse cx="50" cy="37" rx="5.5" ry="10" transform="rotate(-18 50 37)" fill={c} />
          <circle cx="47.5" cy="27.5" r="2.4" fill={acc} />
        </g>
      );
    case "twintails":
      return <path d="M13 26 C6 32, 6 46, 11 52 C13 44, 15 36, 17 30 Z M51 26 C58 32, 58 46, 53 52 C51 44, 49 36, 47 30 Z" fill={c} />;
    default:
      return null;
  }
}

function Hair({ t, color, hatted, acc }: { t: TrainerConfig; color: string; hatted: boolean; acc: string }) {
  const cap = t.hair === "buzz" ? "M16.6 28 C16 18, 23 14.2, 32 14.2 C41 14.2, 48 18, 47.4 28 C46 24, 44 22.5, 40 21.8 C35 21.2, 29 21.2, 24 21.8 C20 22.5, 18 24, 16.6 28 Z" : "M15.6 31 C14 17, 22 12.6, 32 12.6 C42 12.6, 50 17, 48.4 31 C47 26.5, 45.5 24, 42 23 C36 21.5, 28 21.5, 22 23 C18.5 24, 17 26.5, 15.6 31 Z";
  const shine = <path d="M22 17.5 C25 15.2, 29 14.4, 32 14.4" fill="none" stroke={lighter(color, 0.35)} strokeWidth="1.3" strokeLinecap="round" opacity="0.7" />;
  const bangs = t.bangs === "auto" ? HAIR_BANGS[t.hair] : t.bangs;
  const curls: [number, number, number][] = [
    [17, 26, 4.5],
    [16, 19.5, 4.5],
    [20.5, 14.5, 5],
    [27, 11.5, 5],
    [33.5, 11, 5],
    [40, 12.5, 5],
    [45, 16.5, 5],
    [47.5, 22.5, 4.6],
    [47.5, 28, 4],
    [16.5, 31, 3.4],
  ];
  return (
    <g fill={color}>
      {/* Volume above and around the cap */}
      {t.hair === "spiky" && !hatted && <path d="M18 22 L13 9 L24 15 L27 5 L33 13 L41 5 L42 15 L52 10 L47 22 Z" />}
      {t.hair === "spiky" && <path d="M14.8 33 L9.5 27 L15 24 Z M49.2 33 L54.5 27 L49 24 Z" />}
      {t.hair === "spikyup" && !hatted && <path d="M16 24 L10 12 L19 15 L19 3 L26 11 L32 0 L37 10 L45 3 L45 14 L54 11 L48 24 Z" />}
      {t.hair === "quiff" && !hatted && <path d="M17 24 C14 14, 22 6, 34 6 C42 6, 50 8, 55 4 C53 10, 52 14, 49 18 L53 20 L48 25 Z" />}
      {t.hair === "volume" && <path d="M14 30 C10 14, 22 5, 34 6 C44 7, 52 13, 51 24 Z" />}
      {t.hair === "sidetail" && (hatted ? null : <path d="M44 16 L52 3 L50 12 L59 6 L54 15 L61 16 L52 20 Z" />)}
      {t.hair === "buns" && (!hatted || t.hat === "visor") && (
        <>
          <circle cx="19" cy="15" r="6" />
          <circle cx="45" cy="15" r="6" />
          <circle cx="21.5" cy="18" r="2" fill={acc} />
          <circle cx="42.5" cy="18" r="2" fill={acc} />
        </>
      )}
      {t.hair === "curly" && curls.filter(([, y]) => !hatted || y > 22).map(([x, y, r]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={r} />)}
      {t.hairAcc === "ribbons" && (
        <g>
          <path d="M20 17 L16 5 L25 14 Z M44 17 L48 5 L39 14 Z" />
          <path d="M18 15 l-3 -2 v4 Z M18 15 l3 -2 v4 Z M46 15 l-3 -2 v4 Z M46 15 l3 -2 v4 Z" fill={acc} />
        </g>
      )}
      <path d={cap} />
      {/* Side locks */}
      {(t.hair === "bob" || t.hair === "long" || t.hair === "flowing") && <path d="M15.6 30 C15 36, 15.5 40, 17.5 43 L19.5 43 C18.5 38, 18.5 33, 19 28 Z M48.4 30 C49 36, 48.5 40, 46.5 43 L44.5 43 C45.5 38, 45.5 33, 45 28 Z" />}
      <Bangs kind={bangs} curly={t.hair === "curly"} />
      {t.hairAcc === "clips" && <path d="M19 22 l5 -2 v1.6 l-5 2 Z M45 22 l-5 -2 v1.6 l5 2 Z" fill={acc} />}
      {t.hairAcc === "ornaments" && <path d="M12 21 C8 25, 9 32, 13 33 C15 29, 15 25, 12 21 Z M52 21 C56 25, 55 32, 51 33 C49 29, 49 25, 52 21 Z" fill={acc} />}
      {t.hairAcc === "bow" && <path d="M40 13 l6 -4 v8 Z M40 13 l-6 -4 v8 Z" fill={acc} />}
      {t.hairAcc === "flower" && <circle cx="44" cy="19" r="2.6" fill={acc} />}
      {t.hair !== "buzz" && shine}
    </g>
  );
}

function Bangs({ kind, curly }: { kind: string; curly: boolean }) {
  switch (kind) {
    case "tufts":
      return curly ? (
        <>
          <circle cx="23" cy="22.5" r="3.4" />
          <circle cx="29" cy="21.5" r="3.4" />
          <circle cx="35" cy="21.5" r="3.4" />
          <circle cx="41" cy="22.5" r="3.4" />
        </>
      ) : (
        <path d="M19.5 25.5 C20 21.5, 23 20.5, 26 21 C26.5 24, 25 25.5, 24 27 C26.5 25.5, 29 24, 30 21 C33 20.5, 35 21, 36 22 C36.5 24.5, 35.5 26, 35 26.5 C37.5 25.5, 39.5 24, 40 21.5 C43 21.5, 45 23.5, 44.5 26 C42 23.5, 39 23, 32 23 C25 23, 22 23.5, 19.5 25.5 Z" />
      );
    case "blunt":
      return <path d="M17 27.5 C17 19, 22 16, 32 16 C42 16, 47 19, 47 27.5 Z" />;
    case "side":
      return <path d="M18 27 C18 18, 28 14, 42 17 C46 19, 46 24, 46 26 C40 22, 32 23, 26 27 C23 30, 21 35, 20 39 C18 35, 17 31, 18 27 Z" />;
    case "parted":
      return <path d="M16.5 32 C16 22, 24 17, 32 17.5 C40 17, 48 22, 47.5 32 C45 26, 40 22.5, 33 21.5 L32 23 L31 21.5 C24 22.5, 19 26, 16.5 32 Z" />;
    case "spiky":
      return <path d="M20.5 22.5 L24 30 L26.5 22 L30 29 L33 22 L36.5 29 L39 22 L42 28.5 L44 22.5 Z" />;
    default:
      return null;
  }
}

function Hat({ t }: { t: TrainerConfig }) {
  const color = colorHex(t.hatColor);
  const trim = colorHex(t.hatTrim);
  const dome = "M14.6 25.5 C14.6 13, 22.5 8.5, 32 8.5 C41.5 8.5, 49.4 13, 49.4 25.5 Z";
  const brim = "M12 26.5 C14 23.5, 50 23.5, 52 26.5 C50 29, 14 29, 12 26.5 Z";
  const gold = "#e9b526";
  switch (t.hat) {
    case "cap":
    case "ace":
    case "champion":
    case "league":
    case "ballcap":
    case "twotone":
    case "crown": {
      const panel = t.hat === "champion" ? "#1d1e22" : t.hat === "twotone" ? trim : t.hat === "ballcap" || t.hat === "crown" ? null : "#f6f6f2";
      return (
        <g>
          <path d={dome} fill={color} />
          {t.hat === "ace" && <path d="M30.5 8.6 h3 V25.5 h-3 Z" fill={trim} />}
          {panel && <path d="M23 25 C23 17.5, 27 14, 32 14 C37 14, 41 17.5, 41 25 Z" fill={panel} />}
          {t.hat === "league" && <path d="M29.6 21.5 A2.6 2.6 0 1 1 34.4 21.5" fill="none" stroke={trim} strokeWidth="1.6" strokeLinecap="round" />}
          {t.hat === "ballcap" && (
            <g fill="none" stroke={trim} strokeWidth="1.2">
              <circle cx="32" cy="19" r="3.6" />
              <path d="M28.4 19 H35.6" />
            </g>
          )}
          {t.hat === "crown" && <path d="M19 19 L22.5 14 L26 18.5 L32 12.5 L38 18.5 L41.5 14 L45 19" fill="none" stroke={trim} strokeWidth="1.3" strokeLinejoin="round" />}
          {(t.hat === "cap" || t.hat === "ace" || t.hat === "champion" || t.hat === "twotone") && <circle cx="32" cy="20.5" r="2.6" fill={t.hat === "champion" ? gold : t.hat === "twotone" ? color : trim} />}
          <path d={brim} fill={t.hat === "ace" || t.hat === "twotone" ? trim : darker(color, t.hat === "champion" ? 0.15 : 0.08)} />
          {t.hat === "champion" && <path d="M12 26.5 C14 29, 50 29, 52 26.5" fill="none" stroke={gold} strokeWidth="1.2" />}
          <circle cx="32" cy="9" r="1.6" fill={t.hat === "champion" ? gold : darker(color, 0.1)} />
        </g>
      );
    }
    case "backcap":
      return (
        <g>
          <path d={dome} fill={color} />
          <path d="M14.6 25.5 h34.8 v-2.4 h-34.8 Z" fill={darker(color, 0.12)} />
          <path d="M27.5 25.5 C27.5 22, 29.5 21, 32 21 C34.5 21, 36.5 22, 36.5 25.5 Z" fill={lighter(color, 0.2)} />
          <circle cx="32" cy="9" r="1.6" fill={darker(color, 0.1)} />
        </g>
      );
    case "beanie":
      return (
        <g>
          <circle cx="32" cy="6" r="3.6" fill={trim} />
          <path d="M14.8 25 C14.8 11, 22.5 7, 32 7 C41.5 7, 49.2 11, 49.2 25 Z" fill={color} />
          <path d="M40 15 a3.4 3.4 0 1 0 6 3" fill="none" stroke={trim} strokeWidth="1.1" />
          <rect x="14" y="21" width="36" height="6.5" rx="3" fill={darker(color, 0.1)} />
        </g>
      );
    case "beret":
      return <path d="M13 22 C12 13, 24 8, 36 9 C46 10, 54 14, 52 20 C50 24, 40 21, 32 21.5 C24 22, 16 25, 13 22 Z" fill={color} stroke={trim} strokeWidth="1" />;
    case "sunhat":
      return (
        <g>
          <path d="M19 22 L20 9 C24 6, 40 6, 44 9 L45 22 Z" fill={color} />
          <rect x="19.3" y="16.5" width="25.4" height="4" fill={trim} />
          <ellipse cx="32" cy="23" rx="22" ry="4" fill={darker(color, 0.08)} />
          {t.eyewear === "sunglasses" && <Glasses t={t} y={13} scale={0.7} />}
        </g>
      );
    case "bucket":
      return (
        <g>
          <path d="M17 23 C17 12, 24 9.5, 32 9.5 C40 9.5, 47 12, 47 23 Z" fill={color} />
          <rect x="17" y="19.5" width="30" height="3.5" fill={trim} />
          <path d="M17 22.5 L47 22.5 L54 29 C46 31, 18 31, 10 29 Z" fill={darker(color, 0.08)} />
        </g>
      );
    case "visor":
      return (
        <g>
          <rect x="15" y="20.5" width="34" height="4" rx="2" fill={color} />
          <path d="M14 25 C16 22.5, 48 22.5, 50 25 C48 27.5, 16 27.5, 14 25 Z" fill={trim} />
        </g>
      );
    case "headband":
      return (
        <g>
          <path d="M16 21 C20 16, 44 16, 48 21 L48 24 C44 19.5, 20 19.5, 16 24 Z" fill={color} />
          <circle cx="46.5" cy="20" r="1.8" fill={trim} />
        </g>
      );
    case "safari":
      return (
        <g>
          <path d="M19 22 L21 11 C24 8, 40 8, 43 11 L45 22 Z" fill={color} />
          <rect x="19.5" y="17.5" width="25" height="4" fill={trim} />
          <ellipse cx="32" cy="23.5" rx="25" ry="4.2" fill={darker(color, 0.08)} />
        </g>
      );
    default:
      return null;
  }
}
