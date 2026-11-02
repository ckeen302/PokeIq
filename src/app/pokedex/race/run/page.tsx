import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { RACE_BY_KEY } from "@/lib/race/data";
import { DEFAULT_PRESET, PRESET_BY_ID } from "@/lib/race/presets";
import { RUN_PATH, parseDistance, parseSeed, parseVs, vsQuery } from "@/lib/race/deeplink";
import { fieldFor, specFor } from "@/lib/race/lineup";
import { RACE_ENTRANTS } from "@/lib/race/data";
import { formatTime, makeRace } from "@/lib/race/race";
import { RacePage } from "@/components/race/RacePage";

/**
 * A shared race: /pokedex/race/run?vs=regieleki,shuckle&d=200 (any 1 to 8
 * runners; one runner races its heat) or ?run=<preset>&d=400 (a preset
 * over another distance, ?seed= for a knockout's draw), with its own
 * title and preview card.
 */

type Search = Promise<{ vs?: string | string[]; run?: string; d?: string; seed?: string }>;

function read(sp: Awaited<Search>) {
  const raw = Array.isArray(sp.vs) ? sp.vs.join(",") : sp.vs;
  const vs = parseVs(raw, (k) => RACE_BY_KEY.has(k)).map((k) => RACE_BY_KEY.get(k)!);
  const preset = (sp.run && PRESET_BY_ID.get(sp.run)) || DEFAULT_PRESET;
  return { vs, preset, d: parseDistance(sp.d), seed: parseSeed(sp.seed) };
}

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const sp = await searchParams;
  const { vs, preset, d, seed } = read(sp);
  const spec = specFor(preset.id, vs.map((e) => e.key), d, seed);
  const field = fieldFor(spec, RACE_ENTRANTS);
  const race = makeRace(field.entrants, spec.distance);
  const w = race.order[0];
  const q = new URLSearchParams();
  if (vs.length) q.set("vs", vsQuery(vs.map((e) => e.key)));
  else q.set("run", preset.id);
  if (spec.distance !== 100) q.set("d", String(spec.distance));
  if (seed != null) q.set("seed", String(seed));
  const qs = q.toString().replace(/%2C/g, ",");
  return pageMetadata({
    title: `${field.title}: ${spec.distance} m race`,
    description: `${w.entrant.name} wins the ${spec.distance} m in ${formatTime(w.time)} s. ${race.order.map((r) => `${r.entrant.name} ${formatTime(r.time)}`).join(", ")}. Speeds from their base stats, in 3D on PokéIQ.`,
    path: `${RUN_PATH}?${qs}`,
    image: { url: `${RUN_PATH}/og?${qs}`, alt: `${field.title}: a ${spec.distance} m Pokémon race` },
  });
}

export default async function Page({ searchParams }: { searchParams: Search }) {
  const { vs, preset, d, seed } = read(await searchParams);
  return <RacePage preset={preset} vs={vs.length ? vs : undefined} distance={d} seed={seed} />;
}
