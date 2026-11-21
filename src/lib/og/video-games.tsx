/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { C, localImage, ogCard } from "@/lib/og/card";
import { KIND_LABEL } from "@/lib/dex/video-games-types";
import { VIDEO_GAMES, type VideoGame } from "@/lib/dex/video-games";
import { typeColor } from "@/lib/pokemon/type-colors";

/**
 * Preview cards for the Games tab: the list's card fans out a few covers;
 * a game's card shows its box art (both versions, fanned, like the page).
 */

const W = 470;
const H = 400;

async function coverImages(g: VideoGame, width: number): Promise<string[]> {
  if (g.cover.kind !== "box") return [];
  return Promise.all(g.cover.files.map((f) => localImage(`public/games/${f}`, width)));
}

/** A game's covers in the right-hand frame: two fanned, or one upright; a phone app's Pokémon on its tile. */
async function CoverVisual({ g }: { g: VideoGame }) {
  if (g.cover.kind === "art") {
    // PNG, not localImage's JPEG: the artwork keeps its transparency on the coloured tile.
    const png = await sharp(await readFile(join(process.cwd(), `public/art/160/${g.cover.id}.webp`))).png().toBuffer();
    const art = `data:image/png;base64,${png.toString("base64")}`;
    const [a, b] = [typeColor(g.cover.types[0]), typeColor(g.cover.types[1] ?? g.cover.types[0])];
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: W, height: H }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 300, height: 300, borderRadius: 66, background: `linear-gradient(145deg, ${a}, ${b})` }}>
          <img src={art} width={240} height={240} style={{ objectFit: "contain" }} />
        </div>
      </div>
    );
  }
  const [front, back] = await coverImages(g, 420);
  if (!back) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: W, height: H }}>
        <img src={front} width={400} height={380} style={{ objectFit: "contain" }} />
      </div>
    );
  }
  return (
    <div style={{ display: "flex", position: "relative", width: W, height: H }}>
      <img src={back} width={280} height={320} style={{ position: "absolute", left: 10, top: 40, objectFit: "contain", transform: "rotate(-6deg)" }} />
      <img src={front} width={280} height={320} style={{ position: "absolute", right: 10, top: 40, objectFit: "contain", transform: "rotate(5deg)" }} />
    </div>
  );
}

const KIND_ACCENT = { mainline: C.pink, remake: C.violet, spinoff: C.green, mobile: C.yellow } as const;

export async function videoGameCard(g: VideoGame | undefined) {
  if (!g) return videoGamesCard();
  const size = g.name.length > 34 ? 40 : g.name.length > 22 ? 48 : 60;
  return ogCard({
    eyebrow: `Gen ${g.gen} · ${KIND_LABEL[g.kind]} · ${g.released.slice(0, 4)}`,
    title: [g.name],
    titleSize: size,
    subtitle: g.platforms.join(" · "),
    accent: KIND_ACCENT[g.kind],
    visual: await CoverVisual({ g }),
    footer: g.starters ? "Box art, starters and more →" : g.cover.kind === "box" ? "Box art and more →" : "Release, platforms and more →",
  });
}

/** The list's card: three main-series covers fanned out. */
export async function videoGamesCard() {
  const picks = ["red-blue", "diamond-pearl", "scarlet-violet"].map((s) => VIDEO_GAMES.find((g) => g.slug === s)!);
  const [a, b, c] = await Promise.all(picks.map(async (g) => (await coverImages(g, 300))[0]));
  return ogCard({
    eyebrow: "Pokédex · Games",
    title: ["Every", ["Pokémon game", C.cyan]],
    subtitle: "The main series, remakes, spin-offs and mobile games, with box art.",
    accent: C.cyan,
    visual: (
      <div style={{ display: "flex", position: "relative", width: W, height: H }}>
        <img src={a} width={220} height={260} style={{ position: "absolute", left: 0, top: 80, objectFit: "contain", transform: "rotate(-8deg)" }} />
        <img src={c} width={220} height={260} style={{ position: "absolute", right: 0, top: 80, objectFit: "contain", transform: "rotate(8deg)" }} />
        <img src={b} width={240} height={290} style={{ position: "absolute", left: 115, top: 40, objectFit: "contain" }} />
      </div>
    ),
    footer: "Filter by generation →",
  });
}
