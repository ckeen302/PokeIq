/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { C, fitTitle, hslHex, ogCard } from "@/lib/og/card";
import { hex, lchToRgb, rgbToLch } from "@/lib/shiny-maker/color";
import { homeRenderUrl } from "@/lib/pokemon/art";
import type { Species } from "@/lib/shiny-maker/data";
import type { Design } from "@/lib/shiny-maker/design";
import { finishPixel, finishShade, partSwatch, perPixel, renderPixels, transform, type View } from "@/lib/shiny-maker/recolor";
import { firstDesign, TYPE_GLOW } from "@/lib/shiny-maker/presets";

/**
 * The Shiny Pokémon Maker's preview card: the design big (crisp pixels, a whole-number scale), the normal and the
 * official shiny small beside it, the design's name and PokéIQ's branding. Drawn from the link alone.
 */

async function sprite(sp: Species, d: Design, view: View, box: number) {
  const s = Math.max(1, Math.floor(box / Math.max(sp.w, sp.h)));
  const px = renderPixels(sp, d, view, 0.6);
  const png = await sharp(Buffer.from(px.buffer, px.byteOffset, px.byteLength), { raw: { width: sp.w, height: sp.h, channels: 4 } })
    .resize(sp.w * s, sp.h * s, { kernel: "nearest" })
    .png()
    .toBuffer();
  return { uri: `data:image/png;base64,${png.toString("base64")}`, w: sp.w * s, h: sp.h * s, smooth: false };
}

const ART = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork";
const PAINTED = {
  hd: { size: 512, normal: (id: number) => homeRenderUrl(id), shiny: (id: number) => homeRenderUrl(id, true) },
  art: { size: 475, normal: (id: number) => `${ART}/${id}.png`, shiny: (id: number) => `${ART}/shiny/${id}.png` },
};

async function rgbaOf(url: string, N: number): Promise<Buffer> {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return sharp(Buffer.from(await r.arrayBuffer())).ensureAlpha().resize(N, N, { fit: "fill" }).raw().toBuffer();
}

/**
 * A 3D or Artwork design drawn on the server: the same recolour as the browser's shader, pixel by pixel on the CPU
 * (galaxy's stars fall in slightly different places). Null when anything is missing, so the card falls back to Pixel.
 */
async function painted(kind: "hd" | "art", sp: Species, d: Design, view: View, box: number) {
  const refs = kind === "hd" ? sp.hd : sp.art;
  if (!refs) return null;
  const N = PAINTED[kind].size;
  try {
    const [normal, shiny, mask] = await Promise.all([
      rgbaOf(PAINTED[kind].normal(sp.id), N),
      rgbaOf(PAINTED[kind].shiny(sp.id), N).catch(() => null),
      readFile(join(process.cwd(), "public/shiny-maker", kind, `${sp.id}.png`)).then((b) => sharp(b).extractChannel(0).raw().toBuffer()),
    ]);
    const out = Buffer.alloc(N * N * 4);
    const fin = view === "yours" && d.finish !== "flat";
    const pp = fin && perPixel(d.finish);
    const memo = new Map<number, number>();
    for (let i = 0, o = 0; i < N * N; i++, o += 4) {
      const part = mask[i] - 1;
      const st = part >= 0 ? d.parts[part] : undefined;
      const fromShiny = view === "official" || (view === "yours" && st?.src === 1);
      const src = fromShiny && shiny ? shiny : normal;
      out[o + 3] = normal[o + 3];
      // Without the shiny picture, an official part is moved to the shiny's colour.
      const col = view === "yours" ? st?.col ?? (fromShiny && !shiny && part >= 0 ? { l: refs[part][3], c: refs[part][4], h: refs[part][5], k: 1 } : null) : view === "official" && !shiny && part >= 0 ? { l: refs[part][3], c: refs[part][4], h: refs[part][5], k: 1 } : null;
      const finished = fin && part >= 0 && !sp.parts[part]?.o;
      if (part < 0 || view === "normal" || (!col && !finished)) { out[o] = src[o]; out[o + 1] = src[o + 1]; out[o + 2] = src[o + 2]; continue; }
      const key = ((src[o] << 16) | (src[o + 1] << 8) | src[o + 2]) * 32 + part * 2 + (fromShiny ? 1 : 0);
      let rgb = pp ? undefined : memo.get(key);
      if (rgb === undefined) {
        let c = rgbToLch(src[o], src[o + 1], src[o + 2]);
        if (col) {
          const r = refs[part], useS = fromShiny && !!shiny;
          c = transform(c, { l: r[useS ? 3 : 0], c: r[useS ? 4 : 1], h: r[useS ? 5 : 2] }, col);
        }
        if (finished) c = pp ? finishPixel(c, d.finish, i % N, (i / N) | 0, (i % N) / N, i / N / N, 0.6) : finishShade(c, d.finish);
        const v = lchToRgb(c.l, c.c, c.h);
        rgb = (v[0] << 16) | (v[1] << 8) | v[2];
        if (!pp) memo.set(key, rgb);
      }
      out[o] = (rgb >> 16) & 255; out[o + 1] = (rgb >> 8) & 255; out[o + 2] = rgb & 255;
    }
    const png = await sharp(out, { raw: { width: N, height: N, channels: 4 } }).trim({ threshold: 1 }).resize(box, box, { fit: "inside" }).png().toBuffer({ resolveWithObject: true });
    return { uri: `data:image/png;base64,${png.data.toString("base64")}`, w: png.info.width, h: png.info.height, smooth: true };
  } catch (e) {
    console.error("[og/shiny-maker]", e instanceof Error ? e.message : e);
    return null;
  }
}

function Label({ text }: { text: string }) {
  return <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 18, letterSpacing: 1, color: C.muted, textTransform: "uppercase", marginTop: 8 }}>{text}</div>;
}

export async function shinyMakerCard(sp: Species | null, design: Design | null) {
  const accentFallback = "#fcc33a";
  if (!sp) {
    return ogCard({ eyebrow: "PokéIQ tools", title: ["Shiny Pokémon", ["Maker", accentFallback]], subtitle: "Design your own shiny Pokémon.", accent: accentFallback, footer: "Make your own shiny →" });
  }
  const d = design ?? firstDesign(sp);
  // The card's accent: the design's most colourful part that reads on the dark card.
  const swatches = sp.parts.map((p, i) => (p.o ? null : partSwatch(sp, d, i))).filter((c) => c !== null);
  const vivid = swatches.map((rgb) => ({ rgb, c: rgbToLch(...rgb) })).filter(({ c }) => c.l > 0.55).sort((a, b) => b.c.c - a.c.c)[0];
  const accent = vivid && vivid.c.c > 0.05 ? hex(vivid.rgb) : accentFallback;
  const kind = d.style === "hd" || d.style === "art" ? d.style : null;
  const pick = async (v: View, box: number) => (kind && (await painted(kind, sp, d, v, box))) || sprite(sp, d, v, box);
  const [yours, normal, official] = await Promise.all([pick("yours", 300), pick("normal", 112), pick("official", 112)]);
  const glow = hslHex(TYPE_GLOW[sp.types[0]] ?? TYPE_GLOW.normal);
  const title = d.name || `Shiny ${sp.name}`;
  // The picture beside it is 500 px wide.
  const fitted = fitTitle(title, 560);
  const visual = (
    <div style={{ display: "flex", width: 500, height: 400, alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 22, width: 130 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <img src={normal.uri} width={normal.w} height={normal.h} style={{ imageRendering: normal.smooth ? "auto" : "pixelated" }} />
          <Label text="Normal" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <img src={official.uri} width={official.w} height={official.h} style={{ imageRendering: official.smooth ? "auto" : "pixelated" }} />
          <Label text="Official" />
        </div>
      </div>
      <div style={{ display: "flex", position: "relative", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 350, height: 400 }}>
        <div style={{ position: "absolute", left: 0, top: 10, width: 350, height: 350, display: "flex", borderRadius: 175, backgroundImage: `radial-gradient(circle, ${glow}59 0%, ${glow}14 50%, ${glow}00 70%)` }} />
        <img src={yours.uri} width={yours.w} height={yours.h} style={{ imageRendering: yours.smooth ? "auto" : "pixelated" }} />
        <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 20, letterSpacing: 1, color: accent, textTransform: "uppercase", marginTop: 10 }}>Yours</div>
      </div>
    </div>
  );
  return ogCard(
    {
      eyebrow: "Shiny Pokémon Maker",
      title: fitted.lines,
      titleSize: fitted.size,
      subtitle: d.name ? `A custom shiny ${sp.name}.` : "A custom shiny, made on PokéIQ.",
      accent,
      visual,
      footer: "Make your own shiny →",
    },
    { "cache-control": "public, max-age=86400, s-maxage=31536000, immutable" }
  );
}
