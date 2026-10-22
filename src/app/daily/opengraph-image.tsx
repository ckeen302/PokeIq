import { C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";
import { TilesVisual } from "@/lib/og/result";

/** Share card for /daily: ten questions, the same for everyone (a made-up board, never a real day's). */

export const alt = "The PokéIQ Daily Challenge: ten Pokémon questions, the same for every trainer";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({
    eyebrow: "Daily Challenge · new every day",
    title: ["Today's", ["Pokémon", C.pink], ["test", C.pink]],
    subtitle: "Ten mixed questions, the same for every trainer. One attempt: keep your streak.",
    accent: C.pink,
    visual: <TilesVisual tiles={[["hit", "hit", "wrong", "hit", "hit"], ["hit", "wrong", "hit", "hit", "hit"]]} accent={C.pink} />,
    footer: "Play today's Daily →",
  });
}
