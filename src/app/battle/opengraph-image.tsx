import { BattleVisual, C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";

/** Share card for the battle hub (and its team builder, calc and setup pages). */

export const alt = "Pokémon battles on Pokémon Showdown's engine";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({
    eyebrow: "Battle · Pokémon Showdown rules",
    title: ["Build. Calc.", ["Battle.", C.pink]],
    subtitle: "Showdown-accurate battles against the computer or a friend, live. Team builder and damage calc included.",
    accent: C.pink,
    visual: <BattleVisual />,
    footer: "Random Battle, OU, Doubles and more →",
  });
}
