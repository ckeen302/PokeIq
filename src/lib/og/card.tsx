/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { LOGO_SVG } from "@/lib/brand/logo-svg";
import { SITE_URL } from "@/lib/site";

/**
 * Link-preview cards (Open Graph / X), 1200 × 630, in the site's own look:
 * the dark shell, Chakra Petch headlines, Silkscreen HUD labels, one accent
 * colour per game. Every `opengraph-image` route draws through `ogCard`, so
 * a shared PokéIQ link looks the same on Discord, Reddit, X and iMessage.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

export const C = {
  bg: "#08071a",
  panel: "#110f22",
  edge: "#2a2745",
  text: "#f6f5fc",
  muted: "#a4a0ba",
  pink: "#f1417c",
  violet: "#a47efb",
  green: "#25c580",
  yellow: "#fcc33a",
  cyan: "#4fc3f7",
  red: "#ef4444",
};

/** "340 86% 60%" (the HSL triplets in lib/modes) as #rrggbb. */
export function hslHex(triplet: string): string {
  const [h, s, l] = triplet.replace(/%/g, "").split(/\s+/).map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Shorter cache for cards drawn from live data (an invite's names change when the guest joins). */
export const LIVE_CARD_HEADERS = { "cache-control": "public, max-age=300, s-maxage=300" };

const LOGO = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString("base64")}`;
const HOST = new URL(SITE_URL).host;

type Font = { name: string; data: Buffer; weight: 400 | 600 | 700; style: "normal" };
let fonts: Promise<Font[]> | null = null;
function loadFonts(): Promise<Font[]> {
  const file = (name: string) => readFile(join(process.cwd(), "src/assets/fonts", name));
  fonts ??= Promise.all([file("ChakraPetch-Bold.ttf"), file("Inter-SemiBold.ttf"), file("Silkscreen-Regular.ttf")]).then(([display, body, pixel]) => [
    { name: "Chakra Petch", data: display, weight: 700, style: "normal" },
    { name: "Inter", data: body, weight: 600, style: "normal" },
    { name: "Silkscreen", data: pixel, weight: 400, style: "normal" },
  ]);
  return fonts;
}

const images = new Map<string, Promise<string>>();
/** A picture from the repo (WebP and all) as a JPEG data URI Satori can draw, cached per process. */
export function localImage(path: string, width: number): Promise<string> {
  const key = `${path}@${width}`;
  let uri = images.get(key);
  if (!uri) {
    uri = readFile(join(process.cwd(), path))
      .then((buf) => sharp(buf).resize({ width, withoutEnlargement: true }).jpeg({ quality: 84 }).toBuffer())
      .then((jpeg) => `data:image/jpeg;base64,${jpeg.toString("base64")}`);
    images.set(key, uri);
  }
  return uri;
}

/** Any title line can be [text, colour]. */
export type TitleLine = string | [string, string];

export interface CardProps {
  /** Small HUD label above the title ("PokéGuessr · daily game"). */
  eyebrow: string;
  title: TitleLine[];
  /** Title size: big for two or three words a line, smaller for names. */
  titleSize?: number;
  subtitle?: string;
  /** Hex colour for the eyebrow, glow and footer. */
  accent: string;
  /** Right-hand picture (about 470 × 400). */
  visual?: React.ReactNode;
  /** Bottom row: a call to action, or chips. */
  footer?: string;
  chips?: string[];
}

export async function ogCard(props: CardProps, headers?: Record<string, string>): Promise<ImageResponse> {
  return new ImageResponse(<Card {...props} />, { ...OG_SIZE, fonts: await loadFonts(), headers });
}

function Card({ eyebrow, title, titleSize, subtitle, accent, visual, footer, chips }: CardProps) {
  const size = titleSize ?? (visual ? 74 : 88);
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: C.bg, color: C.text, fontFamily: "Inter" }}>
      {/* Glow in the game's colour, a pink counter-glow and the faint grid of the site's background. */}
      <div style={{ position: "absolute", inset: 0, display: "flex", backgroundImage: `radial-gradient(circle at 88% 8%, ${accent}40 0%, ${accent}00 52%)` }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", backgroundImage: `radial-gradient(circle at 4% 104%, ${C.pink}26 0%, ${C.pink}00 46%)` }} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          backgroundImage: "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 6, display: "flex", background: accent }} />

      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", padding: "48px 60px 50px" }}>
        {/* Brand bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <img src={LOGO} width={64} height={64} />
            <div style={{ display: "flex", marginLeft: 18, fontFamily: "Chakra Petch", fontSize: 40, letterSpacing: 2, textTransform: "uppercase" }}>
              Poké<span style={{ color: C.pink }}>IQ</span>
            </div>
          </div>
          <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 22, color: C.muted, letterSpacing: 1 }}>{HOST}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: visual ? 600 : 1080 }}>
            <div style={{ display: "flex", alignItems: "center", fontFamily: "Silkscreen", fontSize: 24, color: accent, letterSpacing: 2, textTransform: "uppercase" }}>
              <div style={{ display: "flex", width: 14, height: 14, borderRadius: 7, background: accent, boxShadow: `0 0 12px ${accent}`, marginRight: 14 }} />
              {eyebrow}
            </div>
            <div style={{ display: "flex", flexDirection: "column", marginTop: 18 }}>
              {title.map((line, i) => {
                const [text, color] = typeof line === "string" ? [line, C.text] : line;
                return (
                  <div
                    key={i}
                    style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: size, lineHeight: 1, letterSpacing: -1, textTransform: "uppercase", color, marginTop: i ? 6 : 0 }}
                  >
                    {text}
                  </div>
                );
              })}
            </div>
            {subtitle && <div style={{ display: "flex", marginTop: 22, fontSize: 28, lineHeight: 1.35, color: C.muted }}>{subtitle}</div>}
          </div>
          {visual}
        </div>

        {chips ? (
          <div style={{ display: "flex", gap: 12 }}>
            {chips.map((chip) => (
              <div key={chip} style={{ display: "flex", padding: "10px 18px", borderRadius: 10, border: `2px solid ${C.edge}`, background: C.panel, fontSize: 24, color: C.text }}>
                {chip}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: 30, color: accent, letterSpacing: 1, textTransform: "uppercase" }}>{footer ?? "Free · no sign-up →"}</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pictures for the right-hand side
// ---------------------------------------------------------------------------

/** An in-game view in a device frame, with a pin on a little world map. */
export function ScreenshotVisual({ src, map, pin, width = 470 }: { src: string; map?: string; pin?: [number, number] | null; width?: number }) {
  const height = Math.round((width * 9) / 16);
  return (
    <div style={{ display: "flex", position: "relative", width, height, borderRadius: 18, border: `3px solid ${C.edge}`, overflow: "hidden", boxShadow: "0 30px 60px rgba(0,0,0,0.55)" }}>
      <img src={src} width={width} height={height} style={{ objectFit: "cover" }} />
      {map && (
        <div style={{ display: "flex", position: "absolute", right: 12, bottom: 12, width: 168, height: 74, borderRadius: 8, border: "2px solid rgba(255,255,255,0.4)", overflow: "hidden" }}>
          <img src={map} width={168} height={74} />
          {pin && (
            <div style={{ display: "flex", position: "absolute", left: pin[0] * 168 - 7, top: pin[1] * 74 - 7, width: 14, height: 14, borderRadius: 7, background: C.pink, border: "2px solid #fff" }} />
          )}
        </div>
      )}
      <div style={{ display: "flex", position: "absolute", left: 12, top: 12, padding: "6px 12px", borderRadius: 8, background: "rgba(0,0,0,0.65)", fontFamily: "Silkscreen", fontSize: 18, color: "#fff" }}>
        Where is this?
      </div>
    </div>
  );
}

/** Pokédle's clue board, spoiler-free: colours only. */
export function ClueTilesVisual() {
  const rows = [
    [C.edge, C.yellow, C.edge, C.green, C.edge, C.yellow],
    [C.green, C.yellow, C.green, C.green, C.edge, C.green],
    [C.green, C.green, C.green, C.green, C.green, C.green],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 26, borderRadius: 18, background: C.panel, border: `3px solid ${C.edge}` }}>
      {rows.map((row, r) => (
        <div key={r} style={{ display: "flex", gap: 12 }}>
          {row.map((color, i) => (
            <div key={i} style={{ display: "flex", width: 58, height: 58, borderRadius: 10, background: color, alignItems: "center", justifyContent: "center", fontSize: 30, color: "#08071a" }}>
              {color === C.yellow ? (i % 2 ? "↑" : "↓") : ""}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Two battle HP boxes, the way the battle screen draws them. */
export function BattleVisual({ foe = "HEATRAN", you = "GARCHOMP", foeHp = 0.18, youHp = 0.86, caption }: { foe?: string; you?: string; foeHp?: number; youHp?: number; caption?: string }) {
  const box = (name: string, hp: number) => (
    <div style={{ display: "flex", flexDirection: "column", width: 330, padding: "14px 18px", borderRadius: 12, background: "rgba(0,0,0,0.5)", border: "2px solid rgba(255,255,255,0.2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "Silkscreen", fontSize: 22, color: "#fff" }}>
        <span>{name}</span>
        <span style={{ color: "rgba(255,255,255,0.7)" }}>Lv100</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", marginTop: 10 }}>
        <span style={{ fontFamily: "Silkscreen", fontSize: 18, color: C.yellow, marginRight: 10 }}>HP</span>
        <div style={{ display: "flex", flex: 1, height: 14, borderRadius: 4, background: "rgba(0,0,0,0.6)", overflow: "hidden" }}>
          <div style={{ display: "flex", width: `${hp * 100}%`, height: "100%", background: hp > 0.5 ? C.green : hp > 0.22 ? C.yellow : C.red }} />
        </div>
      </div>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 470, height: 380, padding: 24, borderRadius: 18, border: `3px solid ${C.edge}`, background: "linear-gradient(180deg, #2c1a5c 0%, #1a1238 55%, #0e0b22 100%)", justifyContent: "space-between" }}>
      <div style={{ display: "flex" }}>{box(foe, foeHp)}</div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>{box(you, youHp)}</div>
      <div style={{ display: "flex", padding: "10px 16px", borderRadius: 10, border: "2px solid rgba(255,255,255,0.7)", background: "rgba(10,8,26,0.9)", fontFamily: "Silkscreen", fontSize: 18, color: "#fff" }}>
        {caption ?? "What will GARCHOMP do?"}
      </div>
    </div>
  );
}

/** Battle Lab's result bar. */
export function WinOddsVisual() {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 470, padding: 30, borderRadius: 18, background: C.panel, border: `3px solid ${C.edge}` }}>
      <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 20, color: C.muted }}>10,000 battles simulated</div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 22, fontFamily: "Chakra Petch", fontSize: 56 }}>
        <span style={{ color: "#f1417c" }}>61.8%</span>
        <span style={{ color: "#9a74f8" }}>38.2%</span>
      </div>
      <div style={{ display: "flex", height: 30, marginTop: 12, borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "flex", width: "61.8%", background: "#f1417c" }} />
        <div style={{ display: "flex", flex: 1, background: "#9a74f8" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, fontSize: 22, color: C.muted }}>
        <span>Side A wins</span>
        <span>± 1.0% (95% CI)</span>
      </div>
    </div>
  );
}

/** A quiz question with four answers, one marked right. */
export function QuizVisual({ label, question, answers, right, accent }: { label: string; question: string; answers: string[]; right: number; accent: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 470, padding: 26, borderRadius: 18, background: C.panel, border: `3px solid ${C.edge}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "Silkscreen", fontSize: 20, color: C.muted }}>
        <span>{label}</span>
        <span style={{ color: accent }}>0:12</span>
      </div>
      <div style={{ display: "flex", marginTop: 14, fontFamily: "Chakra Petch", fontSize: 34, textTransform: "uppercase" }}>{question}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 20 }}>
        {answers.map((a, i) => (
          <div
            key={a}
            style={{
              display: "flex",
              width: 197,
              padding: "14px 16px",
              borderRadius: 10,
              border: `2px solid ${i === right ? C.green : C.edge}`,
              background: i === right ? `${C.green}33` : "rgba(255,255,255,0.03)",
              fontSize: 24,
              color: C.text,
            }}
          >
            {a}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The 18 type plates. */
export function TypesVisual({ colors }: { colors: [string, string, string][] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, width: 470 }}>
      {colors.map(([name, bg, fg]) => (
        <div key={name} style={{ display: "flex", width: 148, justifyContent: "center", padding: "12px 0", borderRadius: 8, background: bg, color: fg, fontFamily: "Chakra Petch", fontSize: 24, textTransform: "uppercase" }}>
          {name}
        </div>
      ))}
    </div>
  );
}

/** "Host vs guest" for duel and battle invites. */
export function VersusVisual({ host, guest }: { host: string; guest?: string }) {
  const longest = Math.max(host.length, guest?.length ?? 1);
  const size = longest > 16 ? 48 : longest > 10 ? 60 : 76;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 440, padding: "28px 30px", borderRadius: 18, background: C.panel, border: `3px solid ${C.edge}` }}>
      <div style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: size, color: C.pink, lineHeight: 1.05 }}>{host}</div>
      <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 28, color: C.muted, margin: "14px 0" }}>vs</div>
      <div style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: size, color: guest ? C.cyan : C.muted, lineHeight: 1.05 }}>{guest ?? "You?"}</div>
    </div>
  );
}
