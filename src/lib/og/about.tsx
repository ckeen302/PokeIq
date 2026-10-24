/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import sharp from "sharp";
import type { ImageResponse } from "next/og";
import { GAME_SLOTS, POKEMON_SLOTS, choiceLabel, type AboutData } from "@/lib/about-data";
import { pokemonName } from "@/lib/about-validate";
import { artworkUrl } from "@/lib/pokemon/pokedex";
import { C, ogCard } from "./card";

/**
 * The shareable "About me" card: a trainer's Pokémon picks as a grid of
 * artwork on the site's card, with their name and PokéIQ branding. Drawn from
 * validated data only; sprites come from the same artwork source as the
 * site (a missing one leaves its tile empty rather than failing the card).
 */

const sprites = new Map<number, Promise<string | null>>();

/** Official artwork (or the shiny) as a PNG data URI Satori can draw. */
function sprite(id: number, shiny: boolean): Promise<string | null> {
  const key = id * 2 + (shiny ? 1 : 0);
  let p = sprites.get(key);
  if (!p) {
    const src = artworkUrl(id).replace("/official-artwork/", `/official-artwork/${shiny ? "shiny/" : ""}`);
    p = fetch(src, { signal: AbortSignal.timeout(6000) })
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => sharp(Buffer.from(b)).resize(112, 112, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer())
      .then((png) => `data:image/png;base64,${png.toString("base64")}`)
      .catch(() => {
        sprites.delete(key);
        return null;
      });
    if (sprites.size > 400) sprites.delete(sprites.keys().next().value!);
    sprites.set(key, p);
  }
  return p;
}

export async function aboutCard(username: string, about: AboutData, headers?: Record<string, string>): Promise<ImageResponse> {
  const picks = POKEMON_SLOTS.filter((s) => about.pokemon[s.id]).map((s) => ({ slot: s, pick: about.pokemon[s.id] }));
  const art = await Promise.all(picks.map((p) => sprite(p.pick.id, p.pick.shiny)));
  const games = GAME_SLOTS.filter((s) => about.games[s.id])
    .slice(0, 3)
    .map((s) => `${s.label}:${choiceLabel(s.id, about.games[s.id])}`);
  const cols = picks.length > 10 ? 5 : picks.length > 6 ? 4 : 3;
  const tile = cols === 5 ? 84 : 100;
  const visual = picks.length ? (
    <div style={{ display: "flex", flexWrap: "wrap", width: cols * (tile + 10) + 42, gap: 10, padding: 20, borderRadius: 18, background: C.panel, border: `3px solid ${C.edge}` }}>
      {picks.map((p, i) => (
        <div
          key={p.slot.id}
          style={{ display: "flex", flexDirection: "column", alignItems: "center", width: tile, height: tile, borderRadius: 12, background: C.bg, border: `2px solid ${p.pick.shiny ? C.yellow : C.edge}` }}
        >
          {art[i] ? <img src={art[i]!} width={tile - 8} height={tile - 8} /> : <div style={{ display: "flex", width: tile - 8, height: tile - 8 }} />}
        </div>
      ))}
    </div>
  ) : undefined;
  const names = picks.slice(0, 2).map((p) => `${p.slot.label}: ${pokemonName(p.pick.id)}`);
  return ogCard(
    {
      eyebrow: "My Pokémon",
      title: [username.length > 12 ? [username, C.text] : [username, C.pink]],
      titleSize: username.length > 12 ? 56 : 74,
      subtitle: picks.length ? names.join(" · ") : "Nothing picked yet.",
      accent: C.violet,
      visual,
      chips: games.length ? games : undefined,
      footer: "Make yours on PokéIQ →",
    },
    headers,
  );
}
