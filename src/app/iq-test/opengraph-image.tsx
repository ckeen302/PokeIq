import { C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";

/** Share card for /iq-test: the five-section test and the number it gives you. */

export const alt = "The PokéIQ Test: a cognitive test made of Pokémon, in five timed sections";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({
    eyebrow: "The PokéIQ Test",
    title: ["What's your", ["PokéIQ?", C.violet]],
    subtitle: "Five timed sections: reasoning, memory, speed, spatial skills and Pokémon knowledge. About 20 minutes.",
    accent: C.violet,
    visual: (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 420, padding: "34px 30px", borderRadius: 18, background: C.panel, border: `3px solid ${C.edge}` }}>
        <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 22, color: C.muted }}>Your PokéIQ</div>
        <div style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: 150, lineHeight: 1, color: C.violet, marginTop: 10 }}>128</div>
        <div style={{ display: "flex", fontSize: 24, color: C.muted, marginTop: 10 }}>scored against other trainers</div>
      </div>
    ),
    footer: "Take the test, free →",
  });
}
