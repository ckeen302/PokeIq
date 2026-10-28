/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { ImageResponse } from "next/og";
import { artworkUrl } from "@/lib/pokemon/pokedex";
import { typeColor, typeTextColor } from "@/lib/pokemon/type-colors";
import { AXES, AXIS_INFO, type PooledPokemon, type Profile } from "@/lib/which-pokemon/types";
import { matchProfile, nameOf, typesOf } from "@/lib/which-pokemon/match";
import { C, HOST, LOGO, loadFonts } from "./card";

/**
 * "Which Pokémon Are You?" cards in the site's card style: the 1,200 × 630
 * link preview for a result page, and the 1,080 × 1,920 story card a player
 * saves to their camera roll, drawn from the scores in their link.
 */

export const STORY_SIZE = { width: 1080, height: 1920 };

function TypeRow({ types, size = 26 }: { types: string[]; size?: number }) {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      {types.map((t) => (
        <div key={t} style={{ display: "flex", padding: `${size / 3}px ${size}px`, borderRadius: 10, background: typeColor(t), color: typeTextColor(t), fontFamily: "Chakra Petch", fontSize: size, textTransform: "uppercase" }}>
          {t}
        </div>
      ))}
    </div>
  );
}

/** The right-hand picture of a result's link preview: artwork and types. */
export function ResultVisual({ pokemon }: { pokemon: PooledPokemon }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <img src={artworkUrl(pokemon.id)} width={360} height={360} />
      <TypeRow types={typesOf(pokemon)} />
    </div>
  );
}

/** The story card for a player's scores. */
export async function storyCard(scores: Profile): Promise<ImageResponse> {
  const result = matchProfile(scores);
  const { top, runnersUp } = result;
  const types = typesOf(top.pokemon);
  const accent = typeColor(types[0] ?? "normal");
  const name = nameOf(top.pokemon);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", position: "relative", background: C.bg, color: C.text, fontFamily: "Inter", padding: "72px 72px 64px" }}>
        <div style={{ position: "absolute", inset: 0, display: "flex", backgroundImage: `radial-gradient(circle at 50% 28%, ${accent}55 0%, ${accent}00 46%)` }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", backgroundImage: `radial-gradient(circle at 0% 100%, ${C.pink}2a 0%, ${C.pink}00 40%)` }} />
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            backgroundImage: "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 10, display: "flex", background: accent }} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <img src={LOGO} width={72} height={72} />
            <div style={{ display: "flex", marginLeft: 18, fontFamily: "Chakra Petch", fontSize: 44, letterSpacing: 2, textTransform: "uppercase" }}>
              Poké<span style={{ color: C.pink }}>IQ</span>
            </div>
          </div>
          <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 24, color: C.muted }}>{HOST}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 48 }}>
          <div style={{ display: "flex", alignItems: "center", fontFamily: "Silkscreen", fontSize: 28, color: accent, letterSpacing: 2, textTransform: "uppercase" }}>
            <div style={{ display: "flex", width: 16, height: 16, borderRadius: 8, background: accent, boxShadow: `0 0 14px ${accent}`, marginRight: 16 }} />
            Which Pokémon are you?
          </div>
          <img src={artworkUrl(top.pokemon.id)} width={560} height={560} style={{ marginTop: 28 }} />
          <div style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: 40, color: C.muted, textTransform: "uppercase", marginTop: 12 }}>I&apos;m</div>
          <div style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: name.length > 10 ? 100 : 128, lineHeight: 1, letterSpacing: -2, textTransform: "uppercase", color: accent, textAlign: "center" }}>
            {name}
          </div>
          <div style={{ display: "flex", fontSize: 40, color: C.text, marginTop: 18, textAlign: "center" }}>{top.pokemon.title}</div>
          <div style={{ display: "flex", marginTop: 22 }}>
            <TypeRow types={types} size={30} />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 44, padding: "30px 34px", borderRadius: 22, background: C.panel, border: `3px solid ${C.edge}` }}>
          {AXES.map((axis, i) => (
            <div key={axis} style={{ display: "flex", alignItems: "center", fontSize: 26 }}>
              <div style={{ display: "flex", width: 330, color: C.muted }}>{AXIS_INFO[axis].label}</div>
              <div style={{ display: "flex", flex: 1, height: 18, borderRadius: 9, background: C.edge }}>
                <div style={{ display: "flex", width: `${Math.max(2, scores[i])}%`, height: 18, borderRadius: 9, background: accent }} />
              </div>
              <div style={{ display: "flex", width: 70, justifyContent: "flex-end", fontFamily: "Silkscreen", fontSize: 22, color: C.text }}>{scores[i]}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 34 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 22, color: C.muted, letterSpacing: 1, textTransform: "uppercase" }}>Runners-up</div>
            <div style={{ display: "flex", gap: 24, marginTop: 10 }}>
              {runnersUp.map((m) => (
                <div key={m.pokemon.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <img src={artworkUrl(m.pokemon.id)} width={88} height={88} />
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: 30, textTransform: "uppercase" }}>{nameOf(m.pokemon)}</div>
                    <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 22, color: accent }}>{m.similarity}% match</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", marginTop: "auto", fontFamily: "Chakra Petch", fontSize: 34, color: accent, letterSpacing: 1, textTransform: "uppercase" }}>
          Find yours → {HOST}/quiz/which-pokemon
        </div>
      </div>
    ),
    { ...STORY_SIZE, fonts: await loadFonts(), headers: { "cache-control": "public, max-age=31536000, immutable" } }
  );
}
