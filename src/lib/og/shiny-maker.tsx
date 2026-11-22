/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import sharp from "sharp";
import { C, ogCard } from "@/lib/og/card";
import { hex } from "@/lib/shiny-maker/color";
import type { Species } from "@/lib/shiny-maker/data";
import type { Design } from "@/lib/shiny-maker/design";
import { partSwatch, renderPixels, type View } from "@/lib/shiny-maker/recolor";
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
  return { uri: `data:image/png;base64,${png.toString("base64")}`, w: sp.w * s, h: sp.h * s };
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
  const main = sp.parts.findIndex((p) => !p.o);
  const accent = hex(partSwatch(sp, d, Math.max(0, main)));
  const [yours, normal, official] = await Promise.all([sprite(sp, d, "yours", 300), sprite(sp, d, "normal", 112), sprite(sp, d, "official", 112)]);
  const glow = TYPE_GLOW[sp.types[0]] ?? TYPE_GLOW.normal;
  const title = d.name || `Shiny ${sp.name}`;
  const visual = (
    <div style={{ display: "flex", width: 500, height: 400, alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 22, width: 130 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <img src={normal.uri} width={normal.w} height={normal.h} style={{ imageRendering: "pixelated" }} />
          <Label text="Normal" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <img src={official.uri} width={official.w} height={official.h} style={{ imageRendering: "pixelated" }} />
          <Label text="Official" />
        </div>
      </div>
      <div style={{ display: "flex", position: "relative", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 350, height: 400 }}>
        <div style={{ position: "absolute", left: 0, top: 10, width: 350, height: 350, display: "flex", borderRadius: 175, backgroundImage: `radial-gradient(circle, hsl(${glow} / 0.35) 0%, hsl(${glow} / 0.08) 50%, transparent 70%)` }} />
        <img src={yours.uri} width={yours.w} height={yours.h} style={{ imageRendering: "pixelated" }} />
        <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 20, letterSpacing: 1, color: accent, textTransform: "uppercase", marginTop: 10 }}>Yours</div>
      </div>
    </div>
  );
  return ogCard(
    {
      eyebrow: "Shiny Pokémon Maker",
      title: [title],
      titleSize: title.length > 18 ? 46 : title.length > 12 ? 58 : 70,
      subtitle: d.name ? `A custom shiny ${sp.name}.` : "A custom shiny, made on PokéIQ.",
      accent,
      visual,
      footer: "Make your own shiny →",
    },
    { "cache-control": "public, max-age=86400, s-maxage=31536000, immutable" }
  );
}
