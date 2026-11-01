/**
 * The Pokémon history timeline (src/data/pokemon-timeline.json): lanes, eras
 * and date helpers. Client-safe: no Pokédex import here.
 */

export type LaneId = "games" | "spinoffs" | "anime" | "movies" | "tcg" | "events";

export interface Lane {
  id: LaneId;
  label: string;
  /** HSL triplet, used for the track glow and chips. */
  color: string;
}

/** Left-to-right order of the tracks in the 3D view. */
export const LANES: readonly Lane[] = [
  { id: "events", label: "Milestones", color: "42 98% 62%" },
  { id: "tcg", label: "TCG", color: "199 89% 62%" },
  { id: "games", label: "Main games", color: "340 86% 62%" },
  { id: "anime", label: "Anime", color: "258 94% 74%" },
  { id: "movies", label: "Movies", color: "18 92% 62%" },
  { id: "spinoffs", label: "Spin-offs", color: "154 68% 50%" },
];
export const LANE_BY_ID = Object.fromEntries(LANES.map((l) => [l.id, l])) as Record<LaneId, Lane>;

/** One row of src/data/pokemon-timeline.json. */
export interface TimelineRaw {
  id: string;
  lane: LaneId;
  title: string;
  platform: string;
  /** "YYYY-MM-DD", or "YYYY-MM" where the sources agree only on the month. */
  date_jp: string | null;
  date_na: string | null;
  date_eu: string | null;
  /** Same day everywhere. */
  worldwide?: boolean;
  /** The game's generation (games), else the generation era the date falls in. */
  generation: number;
  region: string | null;
  kind?: "opener" | "enhanced" | "remake" | "sequel" | "legends" | "dlc" | "rerelease";
  note?: string;
  series?: string;
  season?: number;
  film?: number;
  /** Where the starters / box legendaries come from (scripts/timeline-data.ts fills the ids). */
  basis?: { starters?: string; starter_slugs?: string[]; box?: string[]; box_slugs?: string[] };
  starters?: number[];
  legendaries?: number[];
  source: string;
  sources: string[];
}

export interface TimelineSpecies {
  id: number;
  slug: string;
  name: string;
}

/** An entry as the page ships it: dates parsed, species resolved. */
export interface TimelineEntry {
  id: string;
  lane: LaneId;
  title: string;
  platform: string;
  date_jp: string | null;
  date_na: string | null;
  date_eu: string | null;
  worldwide: boolean;
  generation: number;
  region: string | null;
  /** /pokedex/places filtered to the region, when the Places tab has it. */
  regionHref: string | null;
  kind: TimelineRaw["kind"] | null;
  note: string | null;
  series: string | null;
  /** Fractional year of the earliest release. */
  t: number;
  era: EraId;
  starters: TimelineSpecies[];
  legendaries: TimelineSpecies[];
  /** Generation openers: the generation whose new species the panel lists. */
  introduces: number | null;
  sources: string[];
}

export type EraId = "gb" | "gbc" | "gba" | "ds" | "ds2" | "3ds" | "switch";

export interface Era {
  id: EraId;
  gens: number[];
  label: string;
  /** The hardware the era is themed on. */
  device: string;
  /** Hex colours: main glow, second accent, the deep background tint. */
  a: string;
  b: string;
  deep: string;
}

/** Visual eras, themed on each generation's hardware. They start at their first generation's opener. */
export const ERAS: readonly Era[] = [
  { id: "gb", gens: [1], label: "Generation I", device: "Game Boy", a: "#9bbc0f", b: "#8bac0f", deep: "#0f380f" },
  { id: "gbc", gens: [2], label: "Generation II", device: "Game Boy Color", a: "#ffc94a", b: "#3ec7c2", deep: "#1c1430" },
  { id: "gba", gens: [3], label: "Generation III", device: "Game Boy Advance", a: "#8a7dff", b: "#3ea0ff", deep: "#120f38" },
  { id: "ds", gens: [4], label: "Generation IV", device: "Nintendo DS", a: "#a9c7ff", b: "#5ad1ff", deep: "#0c1830" },
  { id: "ds2", gens: [5], label: "Generation V", device: "Nintendo DS", a: "#f2f4f8", b: "#4fd2ff", deep: "#101218" },
  { id: "3ds", gens: [6, 7], label: "Generations VI–VII", device: "Nintendo 3DS", a: "#3fd0ff", b: "#ff4d6d", deep: "#071a26" },
  { id: "switch", gens: [8, 9], label: "Generations VIII–IX", device: "Nintendo Switch", a: "#ff4554", b: "#00c3e3", deep: "#16070d" },
];
export const ERA_BY_ID = Object.fromEntries(ERAS.map((e) => [e.id, e])) as Record<EraId, Era>;
export const eraOfGen = (gen: number): Era => ERAS.find((e) => e.gens.includes(gen)) ?? ERAS[0];

export const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

const DATE_RE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;
export const isValidDate = (s: string) => {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 1];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
};

/** "1996-02-27" -> 1996.15; a month-only date sits mid-month. */
export function yearFrac(s: string): number {
  const m = DATE_RE.exec(s)!;
  const y = Number(m[1]), mo = Number(m[2]) - 1, d = m[3] ? Number(m[3]) : 15;
  const start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1);
  return y + (Date.UTC(y, mo, d) - start) / (end - start);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "27 Feb 1996", or "Oct 1999" for a month-only date. */
export function formatDate(s: string): string {
  const m = DATE_RE.exec(s)!;
  const mon = MONTHS[Number(m[2]) - 1];
  return m[3] ? `${Number(m[3])} ${mon} ${m[1]}` : `${mon} ${m[1]}`;
}

/** The earliest of an entry's release dates (the one it sits at on the timeline). */
export function firstDate(e: Pick<TimelineRaw, "date_jp" | "date_na" | "date_eu">): string {
  const ds = [e.date_jp, e.date_na, e.date_eu].filter((d): d is string => !!d);
  return ds.reduce((a, b) => (yearFrac(b) < yearFrac(a) ? b : a));
}

/** The labelled dates an entry shows, JP first. A same-day worldwide release is one line. */
export function dateRows(e: Pick<TimelineEntry, "date_jp" | "date_na" | "date_eu" | "worldwide">): { label: string; date: string }[] {
  if (e.worldwide && e.date_jp) return [{ label: "Worldwide", date: e.date_jp }];
  const rows: { label: string; date: string }[] = [];
  if (e.date_jp) rows.push({ label: "Japan", date: e.date_jp });
  if (e.date_na) rows.push({ label: "North America", date: e.date_na });
  if (e.date_eu) rows.push({ label: "Europe", date: e.date_eu });
  return rows;
}

/** Timeline span shown by the scrubber. */
export const T_START = 1996;

/**
 * Each generation's region, as PokéGuessr's own world-atlas crop
 * (public/geo/maps): the 3D view lays it faintly on the floor of that
 * generation's stretch. Pixel sizes are the crops' own.
 */
export const REGION_MAPS: Readonly<Record<number, { region: string; src: string; w: number; h: number }>> = {
  1: { region: "Kanto", src: "/geo/maps/kanto.webp", w: 763, h: 550 },
  2: { region: "Johto", src: "/geo/maps/johto.webp", w: 803, h: 568 },
  3: { region: "Hoenn", src: "/geo/maps/hoenn.webp", w: 838, h: 514 },
  4: { region: "Sinnoh", src: "/geo/maps/sinnoh.webp", w: 890, h: 706 },
  5: { region: "Unova", src: "/geo/maps/unova.webp", w: 852, h: 580 },
  6: { region: "Kalos", src: "/geo/maps/kalos.webp", w: 1014, h: 692 },
  7: { region: "Alola", src: "/geo/maps/alola.webp", w: 1460, h: 826 },
  8: { region: "Galar", src: "/geo/maps/galar.webp", w: 713, h: 1414 },
  9: { region: "Paldea", src: "/geo/maps/paldea.webp", w: 614, h: 564 },
};
