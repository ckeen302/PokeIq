/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { C, localImage, ogCard } from "@/lib/og/card";
import { movieKicker, movieYears, type Movie } from "@/lib/movies/data";

/**
 * Share card for a film's page in the Pokédex's Movies tab: its title, years
 * and setting beside its poster (public/movies), on the site's 1200 × 630 card.
 */
export async function movieCard(m: Movie | undefined) {
  if (!m) {
    return ogCard({ eyebrow: "Pokédex · Movies", title: ["Pokémon", ["Movies", C.yellow]], subtitle: "Every Pokémon film, from the first to what's coming next.", accent: C.yellow, footer: "See every film →" });
  }
  const poster = await localImage(`public${m.poster}`, 300).catch(() => null);
  const len = m.title.length;
  return ogCard({
    eyebrow: `Pokémon movies · ${movieKicker(m)}`,
    title: [m.title],
    titleSize: len > 44 ? 40 : len > 28 ? 50 : len > 16 ? 60 : 74,
    subtitle: [movieYears(m), m.setting].filter(Boolean).join(" · "),
    accent: C.yellow,
    visual: poster ? (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 420, height: 420 }}>
        <img src={poster} width={260} height={390} style={{ borderRadius: 14, border: "3px solid rgba(255,255,255,0.18)", boxShadow: "0 30px 60px rgba(0,0,0,0.6)", objectFit: "cover" }} />
      </div>
    ) : undefined,
    footer: "Featured Pokémon · characters →",
  });
}
