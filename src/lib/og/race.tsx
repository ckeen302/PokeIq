/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { ogCard } from "@/lib/og/card";
import { englishOgT, type OgT } from "@/lib/og/i18n";
import { speciesName } from "@/lib/names/species";
import { homeRenderUrl } from "@/lib/pokemon/art";
import { RACE_ENTRANTS } from "@/lib/race/data";
import { fieldFor, specFor } from "@/lib/race/lineup";
import { motionAt } from "@/lib/race/model";
import { formatTime, makeRace, type Race } from "@/lib/race/race";
import { DEFAULT_PRESET, type RacePreset } from "@/lib/race/presets";
import type { Distance } from "@/lib/race/track";
import type { Entrant } from "@/lib/race/types";

/**
 * Preview cards for /pokedex/race: the race at the moment the winner
 * crosses the line, drawn as a strip of red lanes with each runner's HOME
 * render where it was, so the card itself tells who won and by how much.
 */

const ACCENT = "#ffd84a";
const W = 470, H = 380;

function Track({ race, t }: { race: Race; t: OgT }) {
  const lanes = race.lanes;
  const n = lanes.length;
  // The lanes sit above a strip kept for the caption (it used to print over the last lane and its runner).
  const CAPTION = 30;
  const laneH = Math.min(64, (H - CAPTION - 8) / n);
  const top = (H - CAPTION - laneH * n) / 2;
  const finishX = W - 46;
  return (
    <div style={{ display: "flex", position: "relative", width: W, height: H, borderRadius: 16, overflow: "hidden", background: "#0b1226", border: "3px solid #2a2745" }}>
      {lanes.map((r, i) => {
        const x = Math.min(race.distance, motionAt(r.profile, race.first).x);
        const px = 12 + (finishX - 12) * Math.max(0.04, x / race.distance);
        const size = laneH * 1.25;
        const [bx, by, bw, bh] = r.entrant.box;
        const s = size / Math.max(bw, bh);
        return (
          <div key={r.lane} style={{ display: "flex", position: "absolute", left: 0, top: top + i * laneH, width: W, height: laneH, background: i % 2 ? "#b8402f" : "#c4483a", borderTop: "2px solid rgba(255,255,255,0.85)" }}>
            <div style={{ display: "flex", position: "absolute", left: 6, top: laneH / 2 - 11, fontFamily: "Chakra Petch", fontSize: 18, color: "rgba(255,255,255,0.75)" }}>{r.lane}</div>
            <div style={{ display: "flex", position: "absolute", left: px - (bw * s) / 2, top: laneH - bh * s - 2, width: bw * s, height: bh * s, overflow: "hidden" }}>
              <img src={homeRenderUrl(r.entrant.art)} width={512 * s} height={512 * s} style={{ position: "absolute", left: -bx * s, top: -by * s, transform: "scaleX(-1)" }} />
            </div>
          </div>
        );
      })}
      <div style={{ display: "flex", position: "absolute", left: finishX, top: top, width: 5, height: laneH * n, background: "#ffffff" }} />
      <div style={{ display: "flex", position: "absolute", left: 14, bottom: 8, fontFamily: "Silkscreen", fontSize: 15, color: "#9fd8ff" }}>{t("race.atTheLine")}</div>
    </div>
  );
}

function card(race: Race, eyebrow: string, title: string, t: OgT) {
  const w = race.order[0];
  const second = race.order[1];
  // An entrant's name in the card's language: the species' official name (a form keeps its English one).
  const name = (e: Entrant) => (t.locale === "en" || e.art !== e.species ? e.name : speciesName(e.species, e.name, t.locale));
  return ogCard({
    eyebrow,
    title: [title],
    titleSize: title.length > 34 ? 42 : title.length > 22 ? 52 : 66,
    subtitle: second
      ? t("race.subtitleAhead", { winner: name(w.entrant), time: formatTime(w.time), gap: formatTime(second.gap), second: name(second.entrant) })
      : t("race.subtitle", { winner: name(w.entrant), time: formatTime(w.time) }),
    accent: ACCENT,
    visual: <Track race={race} t={t} />,
    footer: t("race.footer"),
    t,
  });
}

export function racePresetCard(preset: RacePreset = DEFAULT_PRESET, distance?: Distance | null, seed?: number | null, t: OgT = englishOgT()) {
  const spec = specFor(preset.id, [], distance, seed);
  const f = fieldFor(spec, RACE_ENTRANTS);
  return card(makeRace(f.entrants, spec.distance), t("race.eyebrow", { distance: spec.distance }), preset.tournament ? t("race.tournament") : preset.label, t);
}

export function raceVsCard(vs: Entrant[], distance: Distance) {
  const spec = specFor(DEFAULT_PRESET.id, vs.map((e) => e.key), distance);
  const f = fieldFor(spec, RACE_ENTRANTS);
  return card(makeRace(f.entrants, spec.distance), `Pokémon race · ${spec.distance} m`, f.title, englishOgT());
}
