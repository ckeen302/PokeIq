import type { EncounterKind, NuzBoss, NuzEncounter, NuzStep, NuzVersion } from "./model";

/**
 * A game as the tracker's screens use it: the game data (./model) with what the browser needs to show each Pokémon
 * already worked out on the server (lib/nuzlocke/view.server.ts): its name, picture, Pokédex page, family, evolutions
 * and its types in this game's generation, and the generation's type chart. Plain data, so a page can send it as JSON.
 */

/** A Pokémon as the tracker shows it: one species in one form. */
export interface ViewMon {
  /** "16", or the form's PokéAPI name ("rattata-alola"): what runs save. */
  key: string;
  /** National Pokédex number. */
  species: number;
  /** The form's PokéAPI name, for a form other than the species' default. */
  form?: string;
  /** English name ("Pidgey", "Alolan Rattata"). */
  name: string;
  /** The species' Pokédex page: /pokemon/<slug>. */
  slug: string;
  /**
   * Its picture: a PokéAPI id (/sizes/art/256/<art>.webp; the form's own when the site has one, else the species'), or
   * the path of one kept with the tracker (a cosmetic form's: East Sea Shellos).
   */
  art: number | string;
  /** Its types in this game's generation, lowercase ("normal"). */
  types: string[];
  /** Its evolution family (PokéAPI's evolution chain): one family is one "line" for the dupes clause. */
  family: number;
  /** What it can evolve into in this generation (keys of `mons`). */
  evos?: string[];
  /** Pokémon Showdown's name for it ("Rattata-Alola"), for the Team Builder. */
  showdown: string;
  /** Its first ability in this generation (what the Team Builder picks first), from Gen 3 on. */
  ability?: string;
}

/** An encounter, pointing at its Pokémon in `mons`: one of the data's lines, or several summed up (compact.ts). */
export interface ViewEncounter extends Omit<NuzEncounter, "species" | "form" | "art"> {
  mon: string;
  /** What varies between the lines summed up here (the weathers, the times of day, the floors…). */
  when?: string[];
  /** The lowest of their rates, when they differ (`rate` is then the highest). */
  rateMin?: number;
  /** Met only after the story ("After the Hall of Fame"): shown apart from (under) the story's lines. */
  post?: string;
}

export interface ViewArea {
  id: string;
  name: string;
  /** The add-on the whole area is in ("The Teal Mask"), said by its name instead of on each line. */
  addOn?: string;
  encounters: ViewEncounter[];
}

/** A boss with a key of its own (the game data has none): a run saves the bosses beaten by key. */
export interface ViewBoss extends NuzBoss {
  key: string;
}

export type ViewStep = { type: "area"; area: ViewArea } | { type: "boss"; boss: ViewBoss };

export interface GameView {
  id: string;
  name: string;
  gen: number;
  region: string;
  versions: NuzVersion[];
  steps: ViewStep[];
  extra: ViewArea[];
  /** Every Pokémon the game's areas give, and everything they evolve into, by key. */
  mons: Record<string, ViewMon>;
  /** Every species of this generation, [number, English name], for "what fainted it". */
  dex: [number, string][];
  /** The generation's types, lowercase, in the games' order. */
  types: string[];
  /** The generation's type chart, chart[attacking][defending], only where it isn't ×1. */
  chart: Record<string, Record<string, number>>;
  /** The Catch Rate Calculator's game id, when it covers this game. */
  catchRate?: string;
  /** The Team Builder's format for this generation, when it has one. */
  teamFormat?: string;
  sources: string[];
}

/** A game in the tracker's lists (the front page, the new-run sheet). */
export interface GameSummary {
  id: string;
  name: string;
  gen: number;
  region: string;
  versions: NuzVersion[];
  /** Changes when the game's data does, so browsers fetch its new data.json rather than a cached one. */
  data: string;
}

/** An encounter's Pokémon key. */
export const monKey = (e: Pick<NuzEncounter, "species" | "form">): string => e.form ?? String(e.species);

/** Gifts, in-game trades, eggs and revived fossils: what "gift Pokémon count" covers. */
export const GIFT_KINDS: readonly EncounterKind[] = ["gift", "trade", "egg", "fossil"];
/** Static (and roaming) encounters: what "static encounters count" covers. */
export const STATIC_KINDS: readonly EncounterKind[] = ["static", "roaming"];

const slug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "boss";

/**
 * Keys for the bosses, in story order: the name as a slug, with "-2", "-3"… for a name met again ("rival", "rival-2").
 * Stable while the data keeps its bosses' names and order.
 */
export function bossKeys(steps: readonly NuzStep[]): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const s of steps) {
    if (s.type !== "boss") continue;
    const base = slug(s.boss.name);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push(n === 1 ? base : `${base}-${n}`);
  }
  return out;
}

/** Every area of the game: the story's, then the others. */
export function allAreas(view: Pick<GameView, "steps" | "extra">): ViewArea[] {
  return [...view.steps.flatMap((s) => (s.type === "area" ? [s.area] : [])), ...view.extra];
}

export function allBosses(view: Pick<GameView, "steps">): ViewBoss[] {
  return view.steps.flatMap((s) => (s.type === "boss" ? [s.boss] : []));
}

/** Whether an encounter can be met in this version. */
export const inVersion = (e: { versions?: string[] }, version: string): boolean => !e.versions || e.versions.includes(version);

/** A boss's level cap in this version, when the data has one. */
export const capFor = (b: NuzBoss, version: string): number | undefined => b.capByVersion?.[version] ?? b.cap;

/** Whether a boss gives a gym badge (not a title such as Champion): badges are what the header counts. */
export const givesBadge = (b: NuzBoss): boolean => !!b.badge && /badge$/i.test(b.badge.trim());

/**
 * Pictures kept with the tracker because /sizes/art has none: the forms on the covers of Ultra Sun and Ultra Moon (Dusk
 * Mane and Dawn Wings Necrozma) and of Legends: Z-A (Complete Forme Zygarde), by PokéAPI id; the same renders as the rest
 * of the site's (scripts/nuzlocke-art.ts).
 */
export const ART_PATHS: Record<number, string> = { 10155: "/tools/nuzlocke/10155.webp", 10156: "/tools/nuzlocke/10156.webp", 10120: "/tools/nuzlocke/10120.webp" };

/** The picture of a Pokémon (or of any species, by number). */
export const artSrc = (art: number | string): string => (typeof art === "string" ? art : (ART_PATHS[art] ?? `/sizes/art/256/${art}.webp`));
