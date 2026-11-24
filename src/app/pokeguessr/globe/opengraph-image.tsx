/* eslint-disable jsx-a11y/alt-text -- Satori draws plain <img> */
import { C, OG_CONTENT_TYPE, OG_SIZE, hslHex, localImage, ogCard } from "@/lib/og/card";
import { ogLocale, ogT } from "@/lib/og/i18n";
import { getT } from "@/i18n/server";
import lab from "@/messages/lab";

/**
 * Share card for the World Globe (/pokeguessr/globe): its screenshot (the one its card on /lab shows) in the Lab's
 * frame, like the Professor's Lab's. It used to go out with PokéGuessr's card ("Where in the world is this?
 * A new daily game"), which isn't what the link opens.
 */

export const alt = "World Globe: the whole Pokémon world in 3D, on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/** The experience's accent in lib/lab. */
const ACCENT = hslHex("195 92% 64%");

export default async function Image(props: { params?: unknown }) {
  const t = await ogT(props);
  // The words of the Globe's card on /lab, in the page's language.
  const tl = await getT(lab, await ogLocale(props));
  // Two lines like the other Lab cards ("World" / "Globe", the last word in the accent); one word stays one line.
  const words = tl("cards.globe.title").split(" ");
  const shot = await localImage("public/lab/globe.webp", 940);
  const W = 470, H = 264;
  return ogCard({
    eyebrow: "PokéIQ · 3D Lab",
    title: words.length > 1 ? [words.slice(0, -1).join(" "), [words[words.length - 1], ACCENT]] : [[words[0], ACCENT]],
    subtitle: tl("cards.globe.pitch"),
    accent: ACCENT,
    visual: (
      <div style={{ display: "flex", width: W, height: H, borderRadius: 18, overflow: "hidden", border: `3px solid ${ACCENT}`, boxShadow: `0 0 50px ${ACCENT}40, 0 30px 60px rgba(0,0,0,0.55)`, background: C.panel }}>
        <img src={shot} width={W} height={H} style={{ objectFit: "cover" }} />
      </div>
    ),
    t,
  });
}
