import "server-only";
import presetsJson from "@/data/mass-battle-presets.json";
import { buildRoster } from "./roster-data";
import { PRESETS, PRESET_BY_ID, resolvePreset } from "./presets";
import { decodeBattle, decodePlayback, decodeQuestion, MAX_SPECIES, type SlugIndex } from "./share";
import type { PresetsFile } from "./preset-results";
import type { BattleSpec, MBSpecies, PlaybackSpec, Question } from "./types";

/**
 * What the Mass Battle pages need on the server: the picker's list, the
 * presets with their precomputed results, and the battle or question a
 * link asks for.
 */

export const PRESET_RESULTS = presetsJson as unknown as PresetsFile;

/** One Pokémon in the pickers (enough to search, filter and draw it). */
export interface PickerRow {
  id: number;
  slug: string;
  name: string;
  types: string[];
  /** Has attacking moves by default. */
  attacks: boolean;
  gen: number;
  /** "L" legendary, "M" mythical, "" neither. */
  rank: "" | "L" | "M";
  fe: boolean;
  /** "mega", a region, or "" for a default form. */
  form: string;
}

export function pickerList(): PickerRow[] {
  return buildRoster().species.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    types: s.types,
    attacks: !!s.randbats || s.levelUp.length > 0,
    gen: s.gen,
    rank: s.mythical ? "M" : s.legendary ? "L" : "",
    fe: s.fullyEvolved,
    form: s.form,
  }));
}

export function speciesById(): Map<number, MBSpecies> {
  return new Map(buildRoster().species.map((s) => [s.id, s]));
}

export const slugIndex = (): SlugIndex => {
  const species = buildRoster().species;
  const bySlug = new Map(species.map((s) => [s.slug, s.id]));
  const byId = new Map(species.map((s) => [s.id, s.slug]));
  return { id: (s) => bySlug.get(s), slug: (id) => byId.get(id) };
};

export interface PresetCardData {
  id: string;
  kind: "howmany" | "battle";
  title: string;
  hook: string;
  blurb: string;
  spec: BattleSpec;
  question: Question | null;
  answer: { n: number; spread: number; wins: number; runs: number; seed: number } | null;
  labels: [string, string] | null;
  outcome: PresetsFile["results"][string]["outcome"] | null;
  /** How it's shown: the preset's own choices, unless the link says otherwise. */
  playback: Partial<PlaybackSpec>;
}

export function presetCards(): PresetCardData[] {
  const roster = buildRoster();
  return PRESETS.map((p) => {
    const r = resolvePreset(p, roster);
    const res = PRESET_RESULTS.results[p.id];
    return { ...r, answer: res?.answer ?? null, outcome: res?.outcome ?? null };
  });
}

export const presetById = (id: string) => (PRESET_BY_ID.has(id) ? presetCards().find((c) => c.id === id) ?? null : null);

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function linkBattle(code: string | string[] | undefined): BattleSpec | null {
  return decodeBattle(first(code), slugIndex(), MAX_SPECIES);
}

export function linkQuestion(code: string | string[] | undefined): Question | null {
  return decodeQuestion(first(code), slugIndex());
}

export function linkPlayback(code: string | string[] | undefined): PlaybackSpec {
  return decodePlayback(first(code));
}

export const nameOf = (id: number) => speciesById().get(id)?.name ?? "";
