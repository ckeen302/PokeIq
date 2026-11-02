/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { ogCard } from "@/lib/og/card";
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

function Track({ race }: { race: Race }) {
  const lanes = race.lanes;
  const n = lanes.length;
  const laneH = Math.min(64, (H - 30) / n);
  const top = (H - laneH * n) / 2;
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
      <div style={{ display: "flex", position: "absolute", left: 14, bottom: 8, fontFamily: "Silkscreen", fontSize: 15, color: "#9fd8ff" }}>AS THE WINNER CROSSES THE LINE</div>
    </div>
  );
}

function card(race: Race, eyebrow: string, title: string) {
  const w = race.order[0];
  return ogCard({
    eyebrow,
    title: [title],
    titleSize: title.length > 34 ? 42 : title.length > 22 ? 52 : 66,
    subtitle: `${w.entrant.name} wins in ${formatTime(w.time)} s${race.order[1] ? `, ${formatTime(race.order[1].gap)} s ahead of ${race.order[1].entrant.name}` : ""}.`,
    accent: ACCENT,
    visual: <Track race={race} />,
    footer: "Watch the race in 3D →",
  });
}

export function racePresetCard(preset: RacePreset = DEFAULT_PRESET, distance?: Distance | null, seed?: number | null) {
  const spec = specFor(preset.id, [], distance, seed);
  const f = fieldFor(spec, RACE_ENTRANTS);
  return card(makeRace(f.entrants, spec.distance), `Pokémon race · ${spec.distance} m`, preset.tournament ? "Every Pokémon, one winner" : preset.label);
}

export function raceVsCard(vs: Entrant[], distance: Distance) {
  const spec = specFor(DEFAULT_PRESET.id, vs.map((e) => e.key), distance);
  const f = fieldFor(spec, RACE_ENTRANTS);
  return card(makeRace(f.entrants, spec.distance), `Pokémon race · ${spec.distance} m`, f.title);
}
