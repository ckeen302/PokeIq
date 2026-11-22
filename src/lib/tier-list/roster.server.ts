import "server-only";
import { Dex } from "pokemon-showdown";
import POKEDEX from "@/data/pokedex.json";
import ITEMS from "@/data/items.json";
import DETAILS from "@/data/pokedex-details.json";
import BATTLE_SPRITES from "@/data/battle-sprites.json";
import ART_FILE from "@/data/tier-list-art.json";
import { VIDEO_GAMES } from "@/lib/dex/video-games";
import { ART, CAT, type FormKind, type Mon, type Roster } from "./types";

/**
 * The Tier List Maker's roster, built from the site's own Pokémon data whenever the site builds: every species in
 * the Pokédex (src/data/pokedex.json) and every form Showdown's data knows (Megas, including Legends: Z-A's, regional
 * forms, Gigantamax, Unown's letters, Vivillon's patterns…), each with the picture PokéAPI has for it. New species and
 * forms in either source flow in by themselves; a form with no picture of its own is left out (it would look exactly
 * like its species), and so are Totem Pokémon (the same look, bigger).
 *
 * Which pictures exist was checked once (scripts/tier-list/art.ts writes src/data/tier-list-art.json); a species or
 * form that file doesn't know yet still gets its PokéAPI id, the way the battles find their sprites.
 */

interface DexRow {
  id: number;
  name: string;
  gen: number;
  types: string[];
  bst: number;
  stage: number;
  chain: number;
  evolvesFrom: number | null;
  genus: string;
  legendary: boolean;
  mythical: boolean;
}

const DEX = POKEDEX as unknown as DexRow[];
const SPRITE_FORMS: Record<string, number> = BATTLE_SPRITES.forms;
/** showdown id → [art key, availability bits], from the art check. */
const ART_CHECKED: Record<string, [string, number]> = (ART_FILE as unknown as { mons: Record<string, [string, number]> }).mons;
/** Ids with a picture in public/sizes/art/256 (the site's own HOME renders). */
const LOCAL_ART: Set<string> = new Set((ART_FILE as { local: string[] }).local);

export const ROSTER_VERSION = 1;

const REGIONAL: Record<string, string> = { Alola: "Alolan", Galar: "Galarian", Hisui: "Hisuian", Paldea: "Paldean" };
const words = (s: string) => s.replace(/-/g, " ");

/** A form's name as people write it: "Mega Charizard X", "Alolan Raichu", "Gigantamax Lapras", "Vivillon (Polar)". */
export function formName(base: string, forme: string): string {
  if (forme === "Primal") return `Primal ${base}`;
  if (forme === "Eternamax") return `Eternamax ${base}`;
  const mega = /^(?:(.*)-)?Mega(?:-(.*))?$/.exec(forme);
  if (mega) {
    const [, before, after] = mega;
    if (after && /^[XYZ]$/.test(after)) return `Mega ${base} ${after}`;
    const extra = before === "M" ? "Male" : before === "F" ? "Female" : before ? words(before) : after ? words(after) : "";
    return `Mega ${base}${extra ? ` (${extra})` : ""}`;
  }
  const gmax = /^(?:(.*)-)?Gmax$/.exec(forme);
  if (gmax) return `Gigantamax ${base}${gmax[1] ? ` (${words(gmax[1])})` : ""}`;
  const [first, ...rest] = forme.split("-");
  if (REGIONAL[first]) {
    const more = rest.join(" ");
    const breed = base === "Tauros" && more ? `${more} Breed` : more === "Zen" ? "Zen Mode" : more;
    return `${REGIONAL[first]} ${base}${breed ? ` (${breed})` : ""}`;
  }
  if (base === "Unown") return `Unown (${forme === "Exclamation" ? "!" : forme === "Question" ? "?" : forme})`;
  return `${base} (${words(forme)})`;
}

export function formKind(forme: string): FormKind {
  if (/Mega|Primal/.test(forme)) return "mega";
  if (/Gmax|Eternamax/.test(forme)) return "gmax";
  if (REGIONAL[forme.split("-")[0]]) return "regional";
  return "other";
}

/** The first Pokémon of each region's trio of starters, from the games' own data. */
function starterSet(): Set<number> {
  const out = new Set<number>();
  for (const g of VIDEO_GAMES) if (g.starters?.length === 3) for (const n of g.starters) out.add(n);
  return out;
}

/** Fossil Pokémon: what each fossil item is revived into and its evolutions, plus the "Fossil Pokémon" (Aerodactyl, Galar's). */
function fossilChains(): Set<number> {
  const byName = new Map(DEX.map((p) => [p.name, p]));
  const chains = new Set<number>();
  for (const item of ITEMS as { effect?: string | null }[]) {
    const m = /revived into an? ([^.]+)\./.exec(item.effect ?? "");
    const p = m && byName.get(m[1]);
    if (p) chains.add(p.chain);
  }
  for (const p of DEX) if (p.genus === "Fossil Pokémon") chains.add(p.chain);
  return chains;
}

/** Whether a mod (Legends: Z-A's or Champions') lets this species or form battle. */
function legalIn(mod: string): (id: string) => boolean {
  const dex = Dex.mod(mod);
  const data = dex.data.FormatsData as Record<string, { tier?: string; isNonstandard?: string | null }>;
  return (id) => {
    const row = data[id];
    if (!row || row.tier === "Illegal") return false;
    const s = dex.species.get(id);
    return s.exists && !s.isNonstandard;
  };
}

const lower = (types: readonly string[]) => types.map((t) => t.toLowerCase());
const bstOf = (s: { baseStats: Record<string, number> }) => Object.values(s.baseStats).reduce((a, b) => a + b, 0);

/** A species or form before its picture is known: what the art check (and the roster) start from. */
export interface MonSource extends Omit<Mon, "a" | "m"> {
  /** PokéAPI's id for the form, when the battles know it. */
  pokeapi?: number;
  /** Showdown's forme name ("Polar"), for forms. */
  forme?: string;
}

let sourcesMemo: MonSource[] | null = null;

/** Every species and form, in National Dex order (each species, then its forms in Showdown's order). */
export function rosterSources(): MonSource[] {
  if (sourcesMemo) return sourcesMemo;
  const starters = starterSet();
  const fossils = fossilChains();
  const za = legalIn("gen9legends");
  const champions = legalIn("champions");
  const byNum = new Map(DEX.map((p) => [p.id, p]));
  const showdown = Dex.species.all().filter((s) => s.exists && s.num > 0 && s.isNonstandard !== "CAP" && s.isNonstandard !== "Custom");
  const bases = new Map<number, (typeof showdown)[number]>();
  for (const s of showdown) if (!s.forme && !bases.has(s.num)) bases.set(s.num, s);
  const nums = [...new Set([...byNum.keys(), ...bases.keys()])].sort((a, b) => a - b);

  const out: MonSource[] = [];
  for (const num of nums) {
    const row = byNum.get(num);
    const base = bases.get(num);
    const tags = (base?.tags ?? []) as string[];
    let c = 0;
    if (row?.legendary || tags.includes("Sub-Legendary") || tags.includes("Restricted Legendary")) c |= CAT.legendary;
    if (row?.mythical || tags.includes("Mythical")) c |= CAT.mythical;
    if (starters.has(num)) c |= CAT.starter;
    if (row && row.stage === 3 && row.bst === 600 && !row.legendary && !row.mythical) c |= CAT.pseudo;
    if (tags.includes("Ultra Beast")) c |= CAT.ultraBeast;
    if (tags.includes("Paradox") || row?.genus === "Paradox Pokémon") c |= CAT.paradox;
    if (row && fossils.has(row.chain)) c |= CAT.fossil;
    if (row?.evolvesFrom === 133) c |= CAT.eeveelution;
    const shared = c;
    const k = base?.id ?? String(num);
    const name = row?.name ?? base!.name;
    if (base && za(base.id)) c |= CAT.za;
    if (base && champions(base.id)) c |= CAT.champions;
    out.push({
      k,
      n: name,
      d: num,
      g: row?.gen ?? base!.gen,
      t: row?.types ?? lower(base!.types),
      b: row?.bst ?? bstOf(base!),
      c,
    });
    if (!base) continue;

    // Formes (battle and regional), then the cosmetic ones (Unown's letters, Vivillon's patterns), each once.
    const seen = new Set<string>([base.id]);
    const formes = showdown.filter((s) => s.num === num && s.forme && !/Totem/.test(s.forme));
    for (const name2 of (base.cosmeticFormes ?? []) as string[]) {
      const s = Dex.species.get(name2);
      if (s.exists && !formes.some((f) => f.id === s.id)) formes.push(s);
    }
    for (const s of formes) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      let fc = shared & ~(CAT.starter | CAT.pseudo | CAT.eeveelution | CAT.fossil);
      if (za(s.id)) fc |= CAT.za;
      if (champions(s.id)) fc |= CAT.champions;
      out.push({
        k: s.id,
        n: formName(name, s.forme),
        d: num,
        g: row?.gen ?? s.gen,
        t: lower(s.types),
        b: bstOf(s),
        f: formKind(s.forme),
        c: fc,
        s: k,
        forme: s.forme,
        pokeapi: SPRITE_FORMS[s.id],
      });
    }
  }
  sourcesMemo = withSiteForms(out);
  return sourcesMemo;
}

interface DetailForm {
  id: number;
  slug: string;
  name: string;
  types: string[];
  stats: Record<string, number>;
}

/**
 * Forms the site's Pokédex lists (PokéAPI's) that no Showdown forme maps to (Red Core Minior, 10% Zygarde's other
 * look): added after their species' other forms, under their PokéAPI slug.
 */
function withSiteForms(list: MonSource[]): MonSource[] {
  const known = new Set(list.map((m) => (m.f ? m.pokeapi : m.d)).filter(Boolean));
  const details = DETAILS as unknown as Record<string, { forms?: DetailForm[] }>;
  const out: MonSource[] = [];
  for (let i = 0; i < list.length; i++) {
    out.push(list[i]);
    const next = list[i + 1];
    if (next && next.d === list[i].d) continue;
    const sp = list.find((m) => m.d === list[i].d && !m.f);
    if (!sp) continue;
    for (const f of details[String(sp.d)]?.forms ?? []) {
      if (known.has(f.id) || /totem/.test(f.slug)) continue;
      const kind = /-mega|-primal/.test(f.slug) ? "mega" : /-gmax|eternamax/.test(f.slug) ? "gmax" : /-(alola|galar|hisui|paldea)/.test(f.slug) ? "regional" : "other";
      out.push({
        k: f.slug.replace(/[^a-z0-9]/g, ""),
        n: f.name,
        d: sp.d,
        g: sp.g,
        t: f.types,
        b: Object.values(f.stats).reduce((a, b) => a + b, 0),
        f: kind,
        c: sp.c & (CAT.legendary | CAT.mythical | CAT.ultraBeast | CAT.paradox),
        s: sp.k,
        pokeapi: f.id,
      });
    }
  }
  return out;
}

let rosterMemo: Roster | null = null;

/** The roster the browser gets: every species, and every form with a picture of its own. */
export function buildRoster(): Roster {
  if (rosterMemo) return rosterMemo;
  const mons: Mon[] = [];
  const used = new Set<string>();
  for (const src of rosterSources()) {
    const checked = ART_CHECKED[src.k];
    const a = checked?.[0] ?? (src.f ? (src.pokeapi ? String(src.pokeapi) : null) : String(src.d));
    // Not checked yet: assume PokéAPI's usual pictures (every species and battle form has them).
    let m = checked?.[1] ?? ART.home | ART.homeShiny | ART.pixel | ART.pixelShiny;
    if (!a) continue;
    if (src.f && (used.has(a) || !(m & (ART.home | ART.pixel)))) continue;
    if (LOCAL_ART.has(a)) m |= ART.local;
    used.add(a);
    const { forme: _forme, pokeapi: _pokeapi, ...mon } = src;
    void _forme;
    void _pokeapi;
    mons.push({ ...mon, a, m });
  }
  rosterMemo = { v: ROSTER_VERSION, mons };
  return rosterMemo;
}

export function rosterByKey(): Map<string, Mon> {
  return new Map(buildRoster().mons.map((m) => [m.k, m]));
}
