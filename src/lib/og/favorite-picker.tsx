/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { C, HOST, LOGO, OG_SIZE, loadFonts, ogCard } from "@/lib/og/card";
import { SPRITE_HOST } from "@/lib/tier-list/art";
import { typeColor, typeTextColor } from "@/lib/pokemon/type-colors";
import type { ResolvedResult, ResolvedSlot } from "@/lib/favorite-picker/server";
import { TYPES, type TypeName } from "@/lib/tier-list/types";

/**
 * The Favorite Pokémon Picker's preview cards: the tool's own card, and a shared link's card drawn from the link
 * alone: the favorite big with the rest of the top 10 beside it, or the type chart's slots in their type colours.
 */

const cache = new Map<string, Promise<string | null>>();

/** A Pokémon's HOME render as a small PNG data URI (shiny from PokéAPI, normal from the site's own copy where it has one). */
function picture(art: string, size: number, shiny: boolean): Promise<string | null> {
  const key = `${art}@${size}${shiny ? "s" : ""}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      try {
        const local = join(process.cwd(), "public/sizes/art/256", `${art}.webp`);
        let buf: Buffer;
        if (!shiny && existsSync(local)) buf = await readFile(local);
        else {
          const r = await fetch(`${SPRITE_HOST}/other/home/${shiny ? "shiny/" : ""}${art}.png`, { signal: AbortSignal.timeout(5000) });
          if (!r.ok) return shiny ? picture(art, size, false) : null;
          buf = Buffer.from(await r.arrayBuffer());
        }
        const png = await sharp(buf).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
        return `data:image/png;base64,${png.toString("base64")}`;
      } catch {
        return null;
      }
    })();
    cache.set(key, p);
    void p.then((v) => v === null && cache.delete(key));
  }
  return p;
}

const slotPicture = (s: ResolvedSlot, size: number) => picture(s.mon.a, size, s.shiny);
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const HEADERS = { "cache-control": "public, max-age=86400, s-maxage=31536000, immutable" };
const GOLD = "#f6c94a";

export interface ToolCardText {
  eyebrow: string;
  title: [string, string];
  chips: string[];
}

/** The picker's own card: a favorite with a crown between two others. */
export async function toolCard(text: ToolCardText) {
  const [left, mid, right] = await Promise.all([picture("25", 200, false), picture("94", 300, false), picture("448", 200, false)]);
  return ogCard({
    eyebrow: text.eyebrow,
    title: [text.title[0], [text.title[1], C.pink]],
    titleSize: 66,
    accent: GOLD,
    chips: text.chips,
    visual: (
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", width: 480, height: 380, position: "relative" }}>
        {left && <img src={left} width={170} height={170} style={{ marginRight: -20, opacity: 0.85 }} />}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 54, color: GOLD, marginBottom: -6 }}>♛</div>
          {mid && <img src={mid} width={260} height={260} />}
        </div>
        {right && <img src={right} width={170} height={170} style={{ marginLeft: -20, opacity: 0.85 }} />}
      </div>
    ),
  });
}

function Shell({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.text, fontFamily: "Inter", padding: "36px 52px 30px", position: "relative" }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", backgroundImage: `radial-gradient(circle at 18% 40%, ${GOLD}30 0%, ${GOLD}00 45%)` }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", backgroundImage: `radial-gradient(circle at 92% 0%, ${C.violet}38 0%, ${C.violet}00 50%)` }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 6, display: "flex", background: GOLD }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 860 }}>
          <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 22, color: GOLD, letterSpacing: 2, textTransform: "uppercase" }}>{eyebrow}</div>
          <div style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: 46, lineHeight: 1.05, marginTop: 6 }}>{cut(title, 36)}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <img src={LOGO} width={48} height={48} />
          <div style={{ display: "flex", marginLeft: 12, fontFamily: "Chakra Petch", fontSize: 30, letterSpacing: 2, textTransform: "uppercase" }}>
            Poké<span style={{ color: C.pink }}>IQ</span>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flex: 1, marginTop: 16, minHeight: 0 }}>{children}</div>
      <div style={{ display: "flex", justifyContent: "flex-end", fontFamily: "Silkscreen", fontSize: 18, color: C.muted, marginTop: 8 }}>{`${HOST}/tools/favorite-pokemon-picker`}</div>
    </div>
  );
}

export interface SharedCardText {
  /** "My favorite Pokémon" / "Favorite of every type". */
  favorite: string;
  chart: string;
  /** The tool's name, in the eyebrow. */
  tool: string;
  typeName(t: TypeName): string;
}

/** A shared link's card: the top list, or the type chart if that's what was shared. */
export async function sharedCard(r: ResolvedResult, text: SharedCardText, locale?: Parameters<typeof loadFonts>[0]) {
  const fonts = await loadFonts(locale);
  let body: React.ReactNode;
  let title: string;
  if (r.chartFirst && r.chart.length) {
    title = text.chart;
    const pics = await Promise.all(r.chart.map((c) => slotPicture(c.slot, 120)));
    const byType = new Map(r.chart.map((c, i) => [c.type, { ...c, src: pics[i] }]));
    body = (
      <div style={{ display: "flex", flexWrap: "wrap", width: "100%", alignContent: "flex-start" }}>
        {TYPES.map((t, i) => {
          const c = byType.get(t);
          return (
            <div key={t} style={{ display: "flex", flexDirection: "column", width: 176, height: 134, marginRight: i % 6 === 5 ? 0 : 8, marginBottom: 8, borderRadius: 14, overflow: "hidden", background: "rgba(255,255,255,0.05)" }}>
              <div style={{ display: "flex", height: 28, alignItems: "center", justifyContent: "center", background: typeColor(t), color: typeTextColor(t), fontSize: 17, fontWeight: 700 }}>{cut(text.typeName(t), 14)}</div>
              <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>{c?.src ? <img src={c.src} width={100} height={100} /> : null}</div>
            </div>
          );
        })}
      </div>
    );
  } else {
    const [fav, ...rest] = r.top;
    title = fav ? fav.mon.n : text.favorite;
    const [big, ...small] = await Promise.all([fav ? slotPicture(fav, 400) : Promise.resolve(null), ...rest.slice(0, 9).map((s) => slotPicture(s, 140))]);
    body = (
      <div style={{ display: "flex", width: "100%", alignItems: "center" }}>
        <div style={{ display: "flex", width: 420, height: 420, alignItems: "center", justifyContent: "center" }}>{big ? <img src={big} width={400} height={400} /> : null}</div>
        {rest.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", width: 640, marginLeft: 36 }}>
            {rest.slice(0, 9).map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", width: 206, height: 130, marginRight: i % 3 === 2 ? 0 : 6, marginBottom: 6, borderRadius: 14, background: "rgba(255,255,255,0.05)", paddingLeft: 10 }}>
                <div style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: 30, color: i < 2 ? ["#c9d2e0", "#e09a5f"][i] : C.muted, width: 46 }}>{String(i + 2)}</div>
                {small[i] ? <img src={small[i]!} width={118} height={118} /> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  return new ImageResponse(
    (
      <Shell eyebrow={`${text.tool} · ${r.chartFirst && r.chart.length ? text.chart : text.favorite}`} title={title}>
        {body}
      </Shell>
    ),
    { ...OG_SIZE, fonts, headers: HEADERS }
  );
}
