import { C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";

/** Share card for /iq-test: the adaptive test and the number it gives you. */

export const alt = "The PokéIQ Test: 20 adaptive questions that measure your Pokémon knowledge";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({
    eyebrow: "The PokéIQ Test",
    title: ["What's your", ["PokéIQ?", C.violet]],
    subtitle: "20 adaptive questions that home in on how much you really know about Pokémon.",
    accent: C.violet,
    visual: (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 420, padding: "34px 30px", borderRadius: 18, background: C.panel, border: `3px solid ${C.edge}` }}>
        <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 22, color: C.muted }}>Your PokéIQ</div>
        <div style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: 150, lineHeight: 1, color: C.violet, marginTop: 10 }}>128</div>
        <div style={{ display: "flex", fontSize: 24, color: C.muted, marginTop: 10 }}>± 6 · 95% confidence</div>
      </div>
    ),
    footer: "Take the test, free →",
  });
}
