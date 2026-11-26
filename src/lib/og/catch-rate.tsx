/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { C, fitTitle, ogCard } from "@/lib/og/card";
import { Ball } from "@/lib/og/pokeball-maker";
import { ballPreset } from "@/lib/pokeball-maker/presets";
import { typeColor } from "@/lib/pokemon/type-colors";
import { pct } from "@/components/tools/catch-rate/format";
import { DEFAULT_INPUTS, type Inputs } from "@/lib/catch-rate/link";
import { rank } from "@/lib/catch-rate/rank";
import maker from "@/messages/en/pokeball-maker.json";
import calc from "@/messages/en/catch-rate.json";

/**
 * The Catch Rate Calculator's preview cards: the tool's own (a Pokémon with a ball in front of it), and a shared
 * link's, drawn from the link alone: the Pokémon, the best ball and its chance per throw, in that game.
 */

const HEADERS = { "cache-control": "public, max-age=86400, s-maxage=31536000, immutable" };

async function picture(id: number, size: number): Promise<string | null> {
  try {
    const file = join(process.cwd(), "public/sizes/art/256", `${id}.webp`);
    if (!existsSync(file)) return null;
    const png = await sharp(await readFile(file)).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function catchRateCard(i: Inputs | null) {
  const r = rank(i ?? { ...DEFAULT_INPUTS, id: 25, game: "sv", level: 30, hp: 120, status: "sleep" });
  const art = await picture(r.species.id, 300);
  const accent = i ? typeColor(r.species.types[0]) : C.yellow;
  const ballName = (maker.balls as Record<string, string>)[r.best.ball] ?? "Poké Ball";
  const chance = pct(r.best.chance, "en");
  const visual = (
    <div style={{ display: "flex", position: "relative", width: 460, height: 400, alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", left: 30, top: 0, width: 400, height: 400, display: "flex", borderRadius: 200, backgroundImage: `radial-gradient(circle, ${accent}55 0%, ${accent}18 50%, ${accent}00 70%)` }} />
      {art && <img src={art} width={300} height={300} style={{ position: "absolute", left: 40, top: 10 }} />}
      <div style={{ position: "absolute", right: 30, bottom: 20, display: "flex" }}>
        <Ball d={ballPreset(r.best.ball)} size={130} />
      </div>
      {i && (
        <div style={{ position: "absolute", left: 10, bottom: 34, display: "flex", padding: "8px 18px", borderRadius: 999, background: "rgba(8,7,26,0.85)", border: `2px solid ${accent}`, fontFamily: "Chakra Petch", fontSize: 44, color: C.text }}>
          {chance}
        </div>
      )}
    </div>
  );
  if (!i) {
    return ogCard({ eyebrow: "PokéIQ tools", title: ["Catch Rate", ["Calculator", C.yellow]], subtitle: "Your odds with every Poké Ball, ranked, in every game.", accent: C.yellow, visual, footer: "Find the best ball →" }, HEADERS);
  }
  const fitted = fitTitle(`Catching ${r.species.name}`, 600);
  const game = (calc.game.full as Record<string, string>)[r.game.id];
  return ogCard(
    {
      eyebrow: "Catch Rate Calculator",
      title: fitted.lines,
      titleSize: fitted.size,
      subtitle: `Best ball: ${ballName}, ${chance} per throw. ${game}.`,
      accent,
      visual,
      footer: "Find the best ball →",
    },
    HEADERS
  );
}
