/* eslint-disable jsx-a11y/alt-text -- Satori draws plain <img> */
import { C, OG_CONTENT_TYPE, OG_SIZE, localImage, ogCard } from "@/lib/og/card";
import { liveLabExperiences } from "@/lib/lab";

/** Share card for the 3D Lab: its experiences' screenshots, stacked. */

export const alt = "PokéIQ 3D Lab: the Pokémon Timeline, Pokémon Sizes and the World Globe in 3D";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  const shots = await Promise.all(
    liveLabExperiences()
      .filter((e) => e.image)
      .slice(0, 3)
      .map((e) => localImage(`public${e.image}`, 640))
  );
  const W = 400, H = 225;
  // Satori stacks in document order: the back picture first.
  const poses = [
    { left: 0, top: 150 },
    { left: 60, top: 75 },
    { left: 110, top: 0 },
  ];
  return ogCard({
    eyebrow: "PokéIQ · 3D Lab",
    title: [["3D", C.pink], "Lab"],
    subtitle: "Pokémon history, Pokémon sizes and the whole Pokémon world, in cinematic 3D.",
    accent: C.violet,
    visual: (
      <div style={{ display: "flex", position: "relative", width: 510, height: 380 }}>
        {shots.map((src, i) => ({ src, i })).reverse().map(({ src, i }) => (
          <div
            key={i}
            style={{
              display: "flex",
              position: "absolute",
              left: poses[i].left,
              top: poses[i].top,
              width: W,
              height: H,
              borderRadius: 14,
              overflow: "hidden",
              border: `3px solid ${i === 0 ? C.violet : C.edge}`,
              boxShadow: "0 24px 48px rgba(0,0,0,0.6)",
            }}
          >
            <img src={src} width={W} height={H} style={{ objectFit: "cover" }} />
          </div>
        ))}
      </div>
    ),
    footer: "Step inside →",
  });
}
