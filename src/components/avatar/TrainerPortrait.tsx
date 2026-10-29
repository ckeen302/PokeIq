import { colorHex, hairHex, skinHex, type TrainerConfig } from "@/lib/trainer/config";

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

export function TrainerPortrait({ trainer: t, size = 32, className, title }: { trainer: TrainerConfig; size?: number; className?: string; title?: string }) {
  const skin = skinHex(t.skin);
  const hair = hairHex(t.hairColor);
  const top = colorHex(t.topColor);
  const accent = colorHex(t.accent);
  const hat = colorHex(t.hatColor);
  const pack = colorHex(t.packColor);
  const hatted = t.hat !== "none";
  const open = t.top === "jacket" || t.top === "vest" || t.top === "coat";

  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} data-testid="trainer-portrait">
      {title && <title>{title}</title>}
      <rect width="64" height="64" fill={lighter(top, 0.72)} />
      <circle cx="32" cy="70" r="40" fill={lighter(top, 0.6)} />

      {/* Hair behind the head */}
      {(t.hair === "bob" || t.hair === "long") && (
        <path d={t.hair === "long" ? "M14.5 27 C13 40, 12 50, 15 58 L49 58 C52 50, 51 40, 49.5 27 Z" : "M14.5 27 C13.5 35, 14 41, 16.5 44 L47.5 44 C50 41, 50.5 35, 49.5 27 Z"} fill={darker(hair, 0.12)} />
      )}
      {t.hair === "ponytail" && (
        <g>
          <ellipse cx="50" cy="37" rx="5.5" ry="10" transform="rotate(-18 50 37)" fill={darker(hair, 0.08)} />
          <circle cx="47.5" cy="27.5" r="2.4" fill={accent} />
        </g>
      )}

      {/* Shoulders and top */}
      <path d="M7 64 C8 52, 18 46.5, 32 46.5 C46 46.5, 56 52, 57 64 Z" fill={open ? top : t.top === "vest" ? accent : top} />
      {t.top === "hoodie" && <path d="M19 48.5 C22 44, 42 44, 45 48.5 C40 47, 24 47, 19 48.5 Z" fill={darker(top, 0.12)} />}
      {open && <path d="M26 46.8 L32 60 L38 46.8 C36 46.5, 28 46.5, 26 46.8 Z" fill={accent} />}
      {open && <path d="M26 46.8 L32 60 L29.5 64 L23.5 47.3 Z M38 46.8 L32 60 L34.5 64 L40.5 47.3 Z" fill={darker(top, 0.1)} />}
      {t.top === "track" && <path d="M31.2 47 h1.6 V64 h-1.6 Z" fill={accent} />}
      {t.top === "tee" && <path d="M26.5 46.9 C28 50, 36 50, 37.5 46.9" fill="none" stroke={accent} strokeWidth="1.6" />}
      {(t.pack === "classic" || t.pack === "explorer") && (
        <g fill={darker(pack, 0.15)}>
          <path d="M15.5 50.5 l4 -2.5 l3 16 h-4 Z" />
          <path d="M48.5 50.5 l-4 -2.5 l-3 16 h4 Z" />
        </g>
      )}
      {t.pack === "satchel" && <path d="M20 48 l3 -1.5 L46 64 h-5 Z" fill={darker(pack, 0.15)} />}

      {/* Neck, ears, head */}
      <rect x="28" y="40" width="8" height="8" rx="3" fill={darker(skin, 0.1)} />
      <circle cx="16.3" cy="31.5" r="2.6" fill={skin} />
      <circle cx="47.7" cy="31.5" r="2.6" fill={skin} />
      <circle cx={HEAD.cx} cy={HEAD.cy} r={HEAD.r} fill={skin} />

      {/* Face */}
      {t.eyes === "happy" ? (
        <g fill="none" stroke="#2a1c18" strokeWidth="1.7" strokeLinecap="round">
          <path d="M23.4 33 q2.6 -3.2 5.2 0" />
          <path d="M35.4 33 q2.6 -3.2 5.2 0" />
        </g>
      ) : (
        <g>
          <ellipse cx="26" cy="32.5" rx="2.3" ry={t.eyes === "focused" ? 2.3 : 3} fill="#2a1c18" />
          <ellipse cx="38" cy="32.5" rx="2.3" ry={t.eyes === "focused" ? 2.3 : 3} fill="#2a1c18" />
          <circle cx="25.3" cy="31.4" r="0.9" fill="#fff" />
          <circle cx="37.3" cy="31.4" r="0.9" fill="#fff" />
        </g>
      )}
      {t.eyes === "focused" && (
        <g stroke={darker(hair, 0.05)} strokeWidth="1.3" strokeLinecap="round">
          <path d="M23.5 27.6 L28.5 29" />
          <path d="M40.5 27.6 L35.5 29" />
        </g>
      )}
      <ellipse cx="21.5" cy="37" rx="2.6" ry="1.5" fill="#ff8f8f" opacity="0.5" />
      <ellipse cx="42.5" cy="37" rx="2.6" ry="1.5" fill="#ff8f8f" opacity="0.5" />
      <path d={t.eyes === "focused" ? "M30.6 39.2 h2.8" : "M30 38.6 q2 2 4 0"} fill="none" stroke="#7a2f2c" strokeWidth="1.2" strokeLinecap="round" />

      <Hair t={t} color={hair} hatted={hatted} accent={accent} />
      {hatted && <Hat t={t} color={hat} accent={accent} />}
    </svg>
  );
}

function Hair({ t, color, hatted, accent }: { t: TrainerConfig; color: string; hatted: boolean; accent: string }) {
  const cap = t.hair === "buzz" ? "M16.6 28 C16 18, 23 14.2, 32 14.2 C41 14.2, 48 18, 47.4 28 C46 24, 44 22.5, 40 21.8 C35 21.2, 29 21.2, 24 21.8 C20 22.5, 18 24, 16.6 28 Z" : "M15.6 31 C14 17, 22 12.6, 32 12.6 C42 12.6, 50 17, 48.4 31 C47 26.5, 45.5 24, 42 23 C36 21.5, 28 21.5, 22 23 C18.5 24, 17 26.5, 15.6 31 Z";
  const shine = <path d="M22 17.5 C25 15.2, 29 14.4, 32 14.4" fill="none" stroke={lighter(color, 0.35)} strokeWidth="1.3" strokeLinecap="round" opacity="0.7" />;
  switch (t.hair) {
    case "spiky":
      return (
        <g fill={color}>
          {!hatted && <path d="M18 22 L13 9 L24 15 L27 5 L33 13 L41 5 L42 15 L52 10 L47 22 Z" />}
          <path d="M14.8 33 L9.5 27 L15 24 Z M49.2 33 L54.5 27 L49 24 Z" />
          <path d={cap} />
          <path d="M20.5 22.5 L24 30 L26.5 22 L30 29 L33 22 L36.5 29 L39 22 L42 28.5 L44 22.5 Z" />
          {shine}
        </g>
      );
    case "swept":
      return (
        <g fill={color}>
          <path d={cap} />
          <path d="M17.5 27 C19 18, 30 15, 46 21 C40 21.5, 30 23, 24 29.5 C22 28, 19 27, 17.5 27 Z" />
          {shine}
        </g>
      );
    case "bob":
    case "long":
      return (
        <g fill={color}>
          <path d={cap} />
          <path d="M18 27 C18 20, 22 18, 32 18 C42 18, 46 20, 46 27 C43 25.5, 40 25, 32 25 C24 25, 21 25.5, 18 27 Z" />
          <path d="M15.6 30 C15 36, 15.5 40, 17.5 43 L19.5 43 C18.5 38, 18.5 33, 19 28 Z M48.4 30 C49 36, 48.5 40, 46.5 43 L44.5 43 C45.5 38, 45.5 33, 45 28 Z" />
          {shine}
        </g>
      );
    case "buns":
      return (
        <g fill={color}>
          {(!hatted || t.hat === "visor") && (
            <>
              <circle cx="19" cy="15" r="6" />
              <circle cx="45" cy="15" r="6" />
              <circle cx="21.5" cy="18" r="2" fill={accent} />
              <circle cx="42.5" cy="18" r="2" fill={accent} />
            </>
          )}
          <path d={cap} />
          <Fringe />
          {shine}
        </g>
      );
    case "curly":
      return (
        <g fill={color}>
          {[
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
          ]
            .filter(([, y]) => !hatted || y > 22)
            .map(([x, y, r]) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r={r} />
            ))}
          <path d={cap} />
          <circle cx="23" cy="22.5" r="3.4" />
          <circle cx="29" cy="21.5" r="3.4" />
          <circle cx="35" cy="21.5" r="3.4" />
          <circle cx="41" cy="22.5" r="3.4" />
        </g>
      );
    case "buzz":
      return (
        <g fill={color}>
          <path d={cap} />
        </g>
      );
    default:
      return (
        <g fill={color}>
          <path d={cap} />
          <Fringe />
          {shine}
        </g>
      );
  }
}

function Fringe() {
  return <path d="M19.5 25.5 C20 21.5, 23 20.5, 26 21 C26.5 24, 25 25.5, 24 27 C26.5 25.5, 29 24, 30 21 C33 20.5, 35 21, 36 22 C36.5 24.5, 35.5 26, 35 26.5 C37.5 25.5, 39.5 24, 40 21.5 C43 21.5, 45 23.5, 44.5 26 C42 23.5, 39 23, 32 23 C25 23, 22 23.5, 19.5 25.5 Z" />;
}

function Hat({ t, color, accent }: { t: TrainerConfig; color: string; accent: string }) {
  const dome = "M14.6 25.5 C14.6 13, 22.5 8.5, 32 8.5 C41.5 8.5, 49.4 13, 49.4 25.5 Z";
  const gold = "#e9b526";
  switch (t.hat) {
    case "cap":
    case "ace":
    case "champion":
      return (
        <g>
          <path d={dome} fill={color} />
          {t.hat === "ace" && <path d="M30.5 8.6 h3 V25.5 h-3 Z" fill={accent} />}
          <path d="M23 25 C23 17.5, 27 14, 32 14 C37 14, 41 17.5, 41 25 Z" fill={t.hat === "champion" ? "#1d1e22" : "#f6f6f2"} />
          <circle cx="32" cy="20.5" r="2.6" fill={t.hat === "champion" ? gold : accent} />
          <path d="M12 26.5 C14 23.5, 50 23.5, 52 26.5 C50 29, 14 29, 12 26.5 Z" fill={t.hat === "ace" ? accent : darker(color, t.hat === "champion" ? 0.15 : 0.08)} />
          {t.hat === "champion" && <path d="M12 26.5 C14 29, 50 29, 52 26.5" fill="none" stroke={gold} strokeWidth="1.2" />}
          <circle cx="32" cy="9" r="1.6" fill={t.hat === "champion" ? gold : darker(color, 0.1)} />
        </g>
      );
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
          <circle cx="32" cy="7" r="3.6" fill={accent} />
          <path d="M14.8 25 C14.8 12, 22.5 8, 32 8 C41.5 8, 49.2 12, 49.2 25 Z" fill={color} />
          <rect x="14" y="21" width="36" height="6.5" rx="3" fill={darker(color, 0.12)} />
        </g>
      );
    case "bucket":
      return (
        <g>
          <path d="M17 23 C17 12, 24 9.5, 32 9.5 C40 9.5, 47 12, 47 23 Z" fill={color} />
          <rect x="17" y="19.5" width="30" height="3.5" fill={accent} />
          <path d="M17 22.5 L47 22.5 L54 29 C46 31, 18 31, 10 29 Z" fill={darker(color, 0.08)} />
        </g>
      );
    case "visor":
      return (
        <g>
          <rect x="15" y="20.5" width="34" height="4" rx="2" fill={color} />
          <path d="M14 25 C16 22.5, 48 22.5, 50 25 C48 27.5, 16 27.5, 14 25 Z" fill={accent} />
        </g>
      );
    case "safari":
      return (
        <g>
          <path d="M19 22 L21 11 C24 8, 40 8, 43 11 L45 22 Z" fill={color} />
          <rect x="19.5" y="17.5" width="25" height="4" fill={accent} />
          <ellipse cx="32" cy="23.5" rx="25" ry="4.2" fill={darker(color, 0.08)} />
        </g>
      );
    default:
      return null;
  }
}
