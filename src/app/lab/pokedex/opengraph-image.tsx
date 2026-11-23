/* eslint-disable jsx-a11y/alt-text -- Satori draws plain <img> */
import { C, OG_CONTENT_TYPE, OG_SIZE, hslHex, localImage, ogCard } from "@/lib/og/card";
import { ogT } from "@/lib/og/i18n";

/**
 * Share card for the Professor's Lab (/lab/pokedex): its screenshot (the one its card on /lab shows) in the Lab's frame.
 * Without a card of its own the page went out with no picture at all: Next doesn't hand /lab's card down to it.
 */

export const alt = "Professor's Lab: a 3D Pokédex of every Pokémon, on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/** The experience's accent in lib/lab. */
const ACCENT = hslHex("190 95% 62%");

export default async function Image(props: { params?: unknown }) {
  const t = await ogT(props);
  const shot = await localImage("public/lab/pokedex.webp", 940);
  const W = 470, H = 264;
  return ogCard({
    eyebrow: "PokéIQ · 3D Lab",
    title: ["Professor's", ["Lab", ACCENT]],
    subtitle: "A 3D Pokédex: any Pokémon on the holo-table, with its stats, battle roles and type matchups.",
    accent: ACCENT,
    visual: (
      <div style={{ display: "flex", width: W, height: H, borderRadius: 18, overflow: "hidden", border: `3px solid ${ACCENT}`, boxShadow: `0 0 50px ${ACCENT}40, 0 30px 60px rgba(0,0,0,0.55)`, background: C.panel }}>
        <img src={shot} width={W} height={H} style={{ objectFit: "cover" }} />
      </div>
    ),
    footer: "Every Pokémon in 3D →",
    t,
  });
}
