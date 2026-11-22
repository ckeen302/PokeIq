/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { C, HOST, LOGO, OG_SIZE, loadFonts, ogCard } from "@/lib/og/card";
import { SPRITE_HOST } from "@/lib/tier-list/art";
import { resolveBracket } from "@/lib/tier-list/bracket";
import { slotKeys } from "@/lib/tier-list/blind";
import type { ToolState } from "@/lib/tier-list/state";
import type { Template } from "@/lib/tier-list/templates";
import type { Mon } from "@/lib/tier-list/types";

/**
 * The Tier List Maker's preview cards: a template's card (its name and a few of its Pokémon), and a shared result's
 * card drawn from the link alone: the tiers with their Pokémon, a top three, a bracket's champion or a blind ranking.
 */

const cache = new Map<string, Promise<string | null>>();

/** A Pokémon's picture as a small PNG data URI (the site's own render, else PokéAPI's), or null. */
export function picture(art: string, size: number): Promise<string | null> {
  const key = `${art}@${size}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      try {
        const local = join(process.cwd(), "public/sizes/art/256", `${art}.webp`);
        let buf: Buffer;
        if (existsSync(local)) buf = await readFile(local);
        else {
          const r = await fetch(`${SPRITE_HOST}/other/home/${art}.png`, { signal: AbortSignal.timeout(5000) });
          if (!r.ok) return null;
          buf = Buffer.from(await r.arrayBuffer());
        }
        const png = await sharp(buf).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
        return `data:image/png;base64,${png.toString("base64")}`;
      } catch {
        return null;
      }
    })();
    cache.set(key, p);
  }
  return p;
}

function inkOn(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 140 ? "#16131f" : "#ffffff";
}

function Shell({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.text, fontFamily: "Inter", padding: "40px 52px 36px", position: "relative" }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", backgroundImage: `radial-gradient(circle at 90% 0%, ${C.violet}38 0%, ${C.violet}00 50%)` }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 6, display: "flex", background: C.pink }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 860 }}>
          <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 22, color: C.pink, letterSpacing: 2, textTransform: "uppercase" }}>{eyebrow}</div>
          <div style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: 52, lineHeight: 1.05, marginTop: 6 }}>{title.length > 34 ? `${title.slice(0, 33)}…` : title}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <img src={LOGO} width={52} height={52} />
          <div style={{ display: "flex", marginLeft: 12, fontFamily: "Chakra Petch", fontSize: 32, letterSpacing: 2, textTransform: "uppercase" }}>
            Poké<span style={{ color: C.pink }}>IQ</span>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flex: 1, marginTop: 22, minHeight: 0 }}>{children}</div>
      <div style={{ display: "flex", justifyContent: "flex-end", fontFamily: "Silkscreen", fontSize: 18, color: C.muted, marginTop: 12 }}>{`${HOST}/tools/tier-list`}</div>
    </div>
  );
}

export interface CardText {
  maker: string;
  mode: string;
  title: string;
  champion: string;
}

/** A template's card (or the maker's own, without one). */
export async function templateCard(name: string, eyebrow: string, faces: number[]) {
  const images = await Promise.all(faces.slice(0, 6).map((d) => picture(String(d), 180)));
  return ogCard({
    eyebrow,
    title: [name, ["Tier List Maker", C.pink]],
    titleSize: name.length > 18 ? 60 : 70,
    accent: C.violet,
    chips: ["Tier List", "Bracket", "Top 10", "Blind Ranking"],
    visual: (
      <div style={{ display: "flex", flexWrap: "wrap", width: 480, justifyContent: "center" }}>
        {images.map((src, i) => (src ? <img key={i} src={src} width={150} height={150} style={{ margin: 4 }} /> : null))}
      </div>
    ),
  });
}

/** A shared result's card. */
export async function sharedCard(state: ToolState, byKey: ReadonlyMap<string, Mon>, entrants: string[], drawn: string[], text: CardText) {
  const fonts = await loadFonts();
  const pics = (keys: (string | null)[], size: number) => Promise.all(keys.map((k) => { const m = k ? byKey.get(k) : null; return m ? picture(m.a, size) : Promise.resolve(null); }));
  let body: React.ReactNode = null;
  if (state.mode === "tier") {
    const rows = state.tier.rows.filter((r) => r.items.length || r.label).slice(0, 8);
    const rowH = Math.floor((630 - 220) / Math.max(1, rows.length)) - 6;
    const tile = Math.max(24, Math.min(rowH - 8, 78));
    const per = Math.floor((1096 - 110) / (tile + 4));
    const drawnRows = await Promise.all(rows.map((r) => pics(r.items.slice(0, per), tile * 2)));
    body = (
      <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", height: rowH, marginBottom: 6, borderRadius: 14, overflow: "hidden", background: "rgba(255,255,255,0.05)" }}>
            <div style={{ display: "flex", width: 100, alignItems: "center", justifyContent: "center", background: r.color, color: inkOn(r.color), fontFamily: "Chakra Petch", fontSize: r.label.length > 3 ? 20 : Math.min(40, rowH * 0.6) }}>
              {r.label.slice(0, 10)}
            </div>
            <div style={{ display: "flex", alignItems: "center", paddingLeft: 6 }}>
              {drawnRows[i].map((src, j) => (src ? <img key={j} src={src} width={tile} height={tile} style={{ marginRight: 4 }} /> : null))}
            </div>
          </div>
        ))}
      </div>
    );
  } else if (state.mode === "top") {
    const top = await pics(state.top.items.slice(0, 5), 260);
    body = (
      <div style={{ display: "flex", width: "100%", alignItems: "flex-end", justifyContent: "center" }}>
        {[3, 1, 0, 2, 4].map((i) =>
          top[i] ? (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "0 10px" }}>
              <img src={top[i]!} width={i === 0 ? 250 : i < 3 ? 190 : 140} height={i === 0 ? 250 : i < 3 ? 190 : 140} />
              <div style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: i === 0 ? 44 : 32, color: [C.yellow, "#c9d2e0", "#e09a5f", C.muted, C.muted][i] }}>{`#${i + 1}`}</div>
            </div>
          ) : null
        )}
      </div>
    );
  } else if (state.mode === "bracket") {
    const res = resolveBracket(entrants, state.bracket.picks);
    const champ = res.champion ? byKey.get(res.champion) : null;
    const src = champ ? await picture(champ.a, 360) : null;
    body = (
      <div style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "center" }}>
        {src && <img src={src} width={340} height={340} />}
        {champ && (
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 36 }}>
            <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 28, color: C.yellow, letterSpacing: 3 }}>{text.champion.toUpperCase()}</div>
            <div style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: 64, marginTop: 8 }}>{champ.n}</div>
          </div>
        )}
      </div>
    );
  } else {
    const order = slotKeys(state.blind.slots, drawn);
    const images = await pics(order, 120);
    body = (
      <div style={{ display: "flex", flexWrap: "wrap", width: "100%", alignContent: "flex-start" }}>
        {order.map((k, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", width: 216, height: 128, marginRight: 4 }}>
            <div style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: 34, color: i < 3 ? C.yellow : C.muted, width: 52 }}>{String(i + 1)}</div>
            {k && images[i] ? <img src={images[i]!} width={112} height={112} /> : null}
          </div>
        ))}
      </div>
    );
  }
  return new ImageResponse(
    (
      <Shell eyebrow={`${text.maker} · ${text.mode}`} title={text.title}>
        {body}
      </Shell>
    ),
    { ...OG_SIZE, fonts, headers: { "cache-control": "public, max-age=86400, s-maxage=31536000, immutable" } }
  );
}

export type { Template };
