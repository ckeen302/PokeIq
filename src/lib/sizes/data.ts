import "server-only";
import ART from "@/data/sizes-art.json";
import FORMS from "@/data/sizes-forms.json";
import REFS from "@/data/sizes-refs.json";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { isLength, type RefKind, type SizeItem, type SizeKind } from "./types";

/**
 * Build-time list of every figure /pokedex/sizes can show. Heights and
 * weights of default forms come from src/data/pokedex.json (dm, hg); forms
 * from src/data/sizes-forms.json (PokéAPI, cross-checked: scripts/sizes-data.ts);
 * proportions from the HOME render's visible box (src/data/sizes-art.json);
 * references from src/data/sizes-refs.json, each with its source.
 */

type Box = [number, number, number, number, number];
const BOX = ART as unknown as Record<string, Box>;

interface FormRow { id: number; species: number; slug: string; name: string; kind: string; height: number; weight: number; types: string[]; serebii?: number }
export const SIZE_FORMS = (FORMS as { forms: FormRow[] }).forms;
export const EXCLUDED_FORMS = (FORMS as unknown as { excluded: { slug: string; reason: string }[] }).excluded;

interface RefRow { id: string; name: string; detail?: string; kind: RefKind; m: number; height?: number; length: boolean; fact: string; source: string; url: string; presets?: string[] }
export const SIZE_REFS = (REFS as { refs: RefRow[] }).refs;

/** Proportions of each reference model (width : height), matching the grey models the scene builds. */
const REF_ASPECT: Record<RefKind, number> = { phone: 71.6 / 147.6, human: 0.3, car: 4.63 / 1.435, bus: 12.67 / 3.25, house: 1.35, building: 0.58, whale: 6.2, trainer: 0.5 };

const SPECIES = new Map(POKEDEX.map((p) => [p.id, p]));

function box(id: number): { bw: number; bh: number; bx: number; by: number; bs: number } {
  const b = BOX[String(id)];
  if (!b) throw new Error(`sizes: no HOME render box for ${id}`);
  return { bx: b[0], by: b[1], bw: b[2], bh: b[3], bs: b[4] };
}

const POKEMON: SizeItem[] = POKEDEX.map((p) => {
  const b = box(p.id);
  return {
    key: p.slug,
    name: p.name,
    kind: "pokemon",
    species: p.id,
    art: p.id,
    m: p.height / 10,
    length: isLength(p.shape, b.bw, b.bh),
    min: false,
    ...b,
    types: [...p.types],
    gen: p.gen,
    legendary: p.legendary,
    mythical: p.mythical,
    kg: p.weight / 10,
    chain: p.chain,
  };
});

const FORM_ITEMS: SizeItem[] = SIZE_FORMS.map((f) => {
  const p = SPECIES.get(f.species);
  if (!p) throw new Error(`sizes: form ${f.slug} has no species ${f.species}`);
  const b = box(f.id);
  const kind = f.kind as SizeKind;
  const unknownWeight = kind === "gmax" || kind === "eternamax";
  return {
    key: f.slug,
    name: f.name,
    kind,
    species: p.id,
    art: f.id,
    m: f.height / 10,
    length: isLength(p.shape, b.bw, b.bh),
    min: kind === "gmax",
    ...b,
    types: [...f.types],
    gen: p.gen,
    legendary: p.legendary,
    mythical: p.mythical,
    kg: unknownWeight ? null : f.weight / 10,
    chain: p.chain,
  };
});

const REF_ITEMS: SizeItem[] = SIZE_REFS.map((r) => {
  const a = REF_ASPECT[r.kind];
  return {
    key: `ref-${r.id}`,
    name: r.name,
    kind: "ref",
    species: 0,
    art: 0,
    m: r.m,
    length: r.length,
    min: false,
    bw: a >= 1 ? 1000 : Math.round(1000 * a),
    bh: a >= 1 ? Math.round(1000 / a) : 1000,
    bx: 0,
    by: 0,
    bs: 0,
    types: [],
    gen: 0,
    legendary: false,
    mythical: false,
    kg: null,
    chain: 0,
    ref: { kind: r.kind, detail: r.detail, source: r.source, url: r.url, fact: r.fact, presets: r.presets },
  };
});

/** Every Pokémon (1,025), every Mega / Gigantamax / regional / Eternamax form, and the references. */
export const SIZE_ITEMS: SizeItem[] = [...POKEMON, ...FORM_ITEMS, ...REF_ITEMS];
export const SIZE_BY_KEY = new Map(SIZE_ITEMS.map((i) => [i.key, i]));
export const SIZE_POKEMON = POKEMON;
export const SIZE_FORM_ITEMS = FORM_ITEMS;
export const SIZE_REF_ITEMS = REF_ITEMS;
