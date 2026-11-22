import type { SceneItem } from "@/components/sizes/scene/figures";
import type { LabMon } from "@/lib/lab-dex/types";

/**
 * A Pokémon as a figure for the lab, at display size rather than real size:
 * a pod holds anything from Joltik to Eternatus, so heights are compressed
 * (bigger Pokémon still stand taller) and wide ones are fitted to the glass.
 * On the holo-table everyone is magnified to about the same height.
 */
export function labItem(m: LabMon, hero: boolean): SceneItem {
  const [, , bw, bh] = m.box;
  const aspect = bw / bh;
  const metres = Math.max(0.2, m.heightM);
  const h = hero
    ? Math.min(2.05 + 0.32 * Math.log2(metres / 0.6), 3.1 / aspect, 2.9)
    : Math.min(0.78 + 0.26 * Math.log2(Math.max(0.3, metres) / 0.4), 1.12 / aspect, 1.42);
  const hh = Math.max(hero ? 1.2 : 0.45, h);
  return {
    key: `lab-${m.id}${hero ? "-hero" : ""}`,
    name: m.name,
    kind: "pokemon",
    art: m.id,
    species: m.species,
    m: m.heightM,
    length: false,
    min: false,
    w: hh * aspect,
    h: hh,
    box: m.box,
    types: m.types,
  };
}
