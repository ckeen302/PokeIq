import { C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";
import { TilesVisual } from "@/lib/og/result";

/** Share card for /connections (spoiler-free: a made-up board's colours only). */

export const alt = "PokéConnections: find the four groups of Pokémon";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({
    eyebrow: "PokéConnections · new puzzle daily",
    title: ["Find the", ["four", C.violet], ["groups", C.violet]],
    subtitle: "Sixteen Pokémon, four hidden links, four mistakes to spare.",
    accent: C.violet,
    visual: (
      <TilesVisual
        accent={C.violet}
        tiles={[
          ["conn-green", "conn-blue", "conn-green", "conn-green"],
          ["conn-yellow", "conn-yellow", "conn-yellow", "conn-yellow"],
          ["conn-green", "conn-green", "conn-green", "conn-green"],
          ["conn-blue", "conn-purple", "conn-blue", "conn-blue"],
          ["conn-blue", "conn-blue", "conn-blue", "conn-blue"],
          ["conn-purple", "conn-purple", "conn-purple", "conn-purple"],
        ]}
      />
    ),
    footer: "Play today's, with a “Why?” for every answer →",
  });
}
