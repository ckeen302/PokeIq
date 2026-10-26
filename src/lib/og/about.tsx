/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import sharp from "sharp";
import { ImageResponse } from "next/og";
import { CARD_SLOTS, GAME_SLOTS, POKEMON_SLOTS, choiceLabel, type AboutData } from "@/lib/about-data";
import { pokemonName } from "@/lib/about-validate";
import { artworkUrl } from "@/lib/pokemon/pokedex";
import { C, HOST, LOGO, loadFonts, ogCard } from "./card";

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
      .then((b) => sharp(Buffer.from(b)).resize(160, 160, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer())
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

const scans = new Map<string, Promise<string | null>>();

/** A TCG card scan (its stored, host-checked API image URL) as a PNG data URI. */
function scan(url: string | null): Promise<string | null> {
  if (!url) return Promise.resolve(null);
  let p = scans.get(url);
  if (!p) {
    p = fetch(url, { signal: AbortSignal.timeout(6000) })
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => sharp(Buffer.from(b)).resize(150, 209, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer())
      .then((png) => `data:image/png;base64,${png.toString("base64")}`)
      .catch(() => {
        scans.delete(url);
        return null;
      });
    if (scans.size > 200) scans.delete(scans.keys().next().value!);
    scans.set(url, p);
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

/** The tall "About Me: Pokémon" grid: every filled Pokémon slot as a tile, then the game picks. Sized to its content. */
export async function aboutGrid(username: string, about: AboutData, headers?: Record<string, string>): Promise<ImageResponse> {
  const picks = POKEMON_SLOTS.filter((s) => about.pokemon[s.id]).map((s) => ({ slot: s, pick: about.pokemon[s.id] }));
  const art = await Promise.all(picks.map((p) => sprite(p.pick.id, p.pick.shiny)));
  const games = GAME_SLOTS.filter((s) => about.games[s.id]).map((s) => ({ label: s.label, value: choiceLabel(s.id, about.games[s.id]) ?? "" }));
  const cards = CARD_SLOTS.filter((s) => about.cards?.[s.id]).map((s) => ({ slot: s, card: about.cards![s.id] }));
  const cardArt = await Promise.all(cards.map((c) => scan(c.card.image)));
  const cardH = 330;
  const W = 1200;
  const PAD = 40;
  const GAP = 16;
  const tileW = Math.floor((W - PAD * 2 - GAP * 4) / 5);
  const tileH = 268;
  const chipW = Math.floor((W - PAD * 2 - GAP * 2) / 3);
  const chipH = 92;
  const pokeRows = Math.ceil(picks.length / 5);
  const gameRows = Math.ceil(games.length / 3);
  const head = 150;
  const height =
    PAD + head + (pokeRows ? pokeRows * tileH + (pokeRows - 1) * GAP + 30 : 0) + (cards.length ? 56 + cardH + 30 : 0) + (gameRows ? 56 + gameRows * chipH + (gameRows - 1) * GAP + 20 : 0) + 70 + PAD;
  const h = Math.max(height, 420);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", position: "relative", background: C.bg, color: C.text, fontFamily: "Inter", padding: PAD }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 6, display: "flex", background: C.violet }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: head, flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 22, color: C.violet, letterSpacing: 2, textTransform: "uppercase" }}>About Me: Pokémon</div>
            <div style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: username.length > 14 ? 52 : 70, lineHeight: 1, letterSpacing: -1, textTransform: "uppercase", color: C.pink, marginTop: 12 }}>{username}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <img src={LOGO} width={56} height={56} />
              <div style={{ display: "flex", marginLeft: 14, fontFamily: "Chakra Petch", fontSize: 38, letterSpacing: 2, textTransform: "uppercase" }}>
                Poké<span style={{ color: C.pink }}>IQ</span>
              </div>
            </div>
            <div style={{ display: "flex", marginTop: 8, fontFamily: "Silkscreen", fontSize: 18, color: C.muted }}>{HOST}</div>
          </div>
        </div>
        {picks.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: GAP, marginTop: 30 }}>
            {picks.map((p, i) => (
              <div
                key={p.slot.id}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", width: tileW, height: tileH, padding: "14px 8px", borderRadius: 16, background: C.panel, border: `3px solid ${p.pick.shiny ? C.yellow : C.edge}` }}
              >
                {art[i] ? <img src={art[i]!} width={170} height={170} /> : <div style={{ display: "flex", width: 170, height: 170 }} />}
                <div style={{ display: "flex", justifyContent: "center", fontFamily: "Chakra Petch", fontSize: (pokemonName(p.pick.id) ?? "").length > 16 ? 16 : (pokemonName(p.pick.id) ?? "").length > 11 ? 20 : 24, color: C.text, whiteSpace: "nowrap" }}>
                  {pokemonName(p.pick.id)}
                </div>
                <div style={{ display: "flex", justifyContent: "center", fontFamily: "Silkscreen", fontSize: 14, color: p.pick.shiny ? C.yellow : C.violet, textAlign: "center", textTransform: "uppercase", height: 34 }}>
                  {p.slot.label}
                  {p.pick.shiny ? " · Shiny" : ""}
                </div>
              </div>
            ))}
          </div>
        )}
        {cards.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 30 }}>
            <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 22, color: C.violet, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>My TCG Cards</div>
            <div style={{ display: "flex", gap: GAP }}>
              {cards.map((c, i) => (
                <div
                  key={c.slot.id}
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", width: tileW, height: cardH, padding: "14px 8px", borderRadius: 16, background: C.panel, border: `3px solid ${C.edge}` }}
                >
                  {cardArt[i] ? <img src={cardArt[i]!} width={150} height={209} /> : <div style={{ display: "flex", width: 150, height: 209 }} />}
                  <div style={{ display: "flex", justifyContent: "center", fontFamily: "Chakra Petch", fontSize: c.card.name.length > 16 ? 16 : c.card.name.length > 11 ? 20 : 24, color: C.text, whiteSpace: "nowrap" }}>{c.card.name}</div>
                  <div style={{ display: "flex", justifyContent: "center", fontFamily: "Silkscreen", fontSize: 14, color: C.violet, textAlign: "center", textTransform: "uppercase", height: 34 }}>{c.slot.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {games.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 30 }}>
            <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 22, color: C.violet, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>My Pokémon Games</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: GAP }}>
              {games.map((g) => (
                <div key={g.label} style={{ display: "flex", flexDirection: "column", justifyContent: "center", width: chipW, height: chipH, padding: "0 20px", borderRadius: 14, background: C.panel, border: `2px solid ${C.edge}` }}>
                  <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 15, color: C.muted, textTransform: "uppercase" }}>{g.label}</div>
                  <div style={{ display: "flex", marginTop: 6, fontFamily: "Chakra Petch", fontSize: 28, color: C.text }}>{g.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {picks.length === 0 && games.length === 0 && cards.length === 0 && <div style={{ display: "flex", marginTop: 40, fontSize: 28, color: C.muted }}>Nothing picked yet.</div>}
        <div style={{ display: "flex", marginTop: "auto", paddingTop: 24, fontFamily: "Chakra Petch", fontSize: 28, color: C.violet, letterSpacing: 1, textTransform: "uppercase" }}>Make yours on PokéIQ →</div>
      </div>
    ),
    { width: W, height: h, fonts: await loadFonts(), headers },
  );
}
