/**
 * Encounter ("Where to find it") data shapes + the game/version table. Client
 * safe: the section component and the build pipeline both import from here.
 */

/** One table row: versions whose rows were identical are merged into `v`. */
export interface EncRow {
  /** Version keys (see VERSIONS), in game order. */
  v: string[];
  /** Location label. Absent on free-text rows (`x`). */
  loc?: string;
  /** Atlas search query ("Route 201 · Sinnoh") when the place matched confidently. */
  a?: string;
  /** Method label (Grass, Surf, Old Rod, Gift, Static…). */
  m?: string;
  /** Level range, e.g. "2-4". */
  lv?: string;
  /** Single rate that doesn't vary by time of day, e.g. "30%". */
  r?: string;
  /** Morning / Day / Night rates when they differ ("—" = never). */
  t?: [string, string, string];
  /** Condition note: swarm, Poké Radar, season, weather… (no dual-slot or radio rows). */
  n?: string;
  /** Free-text row spanning the data columns (evolve from X, not in the wild…). */
  x?: string;
}

export interface EncGen {
  g: number;
  rows: EncRow[];
}

export interface VersionInfo {
  key: string;
  abbr: string;
  name: string;
  gen: number;
  /** Atlas regions a place in this game can belong to. */
  regions: string[];
  bg: string;
  /** Light badge background, so it takes dark text. */
  dark?: boolean;
}

const R = (key: string, abbr: string, name: string, gen: number, regions: string[], bg: string, dark?: boolean): VersionInfo => ({ key, abbr, name, gen, regions, bg, dark });

/** Every game column, in release order (this order sorts versions inside a row). */
export const VERSIONS: VersionInfo[] = [
  R("red", "R", "Red", 1, ["Kanto"], "#c0392b"),
  R("blue", "B", "Blue", 1, ["Kanto"], "#2f5fd0"),
  R("yellow", "Y", "Yellow", 1, ["Kanto"], "#e6c200", true),
  R("gold", "G", "Gold", 2, ["Johto", "Kanto"], "#c9a227", true),
  R("silver", "S", "Silver", 2, ["Johto", "Kanto"], "#aeb7c2", true),
  R("crystal", "C", "Crystal", 2, ["Johto", "Kanto"], "#7fd0e8", true),
  R("ruby", "R", "Ruby", 3, ["Hoenn"], "#b01e3e"),
  R("sapphire", "S", "Sapphire", 3, ["Hoenn"], "#1e4fb0"),
  R("emerald", "E", "Emerald", 3, ["Hoenn"], "#1f9d55"),
  R("firered", "FR", "FireRed", 3, ["Kanto", "Sevii Islands"], "#e8541e"),
  R("leafgreen", "LG", "LeafGreen", 3, ["Kanto", "Sevii Islands"], "#4aa83c"),
  R("diamond", "D", "Diamond", 4, ["Sinnoh"], "#7fa4e6", true),
  R("pearl", "P", "Pearl", 4, ["Sinnoh"], "#e8a9c8", true),
  R("platinum", "Pt", "Platinum", 4, ["Sinnoh"], "#9a9aa6", true),
  R("heartgold", "HG", "HeartGold", 4, ["Johto", "Kanto"], "#d4a017", true),
  R("soulsilver", "SS", "SoulSilver", 4, ["Johto", "Kanto"], "#b4bcc8", true),
  R("black", "B", "Black", 5, ["Unova"], "#333333"),
  R("white", "W", "White", 5, ["Unova"], "#e4e4e4", true),
  R("black-2", "B2", "Black 2", 5, ["Unova"], "#4a4a4a"),
  R("white-2", "W2", "White 2", 5, ["Unova"], "#d4d4d4", true),
  R("x", "X", "X", 6, ["Kalos"], "#2563a8"),
  R("y", "Y", "Y", 6, ["Kalos"], "#c03a52"),
  R("omega-ruby", "OR", "Omega Ruby", 6, ["Hoenn"], "#a21d2e"),
  R("alpha-sapphire", "AS", "Alpha Sapphire", 6, ["Hoenn"], "#1d46a0"),
  R("sun", "Su", "Sun", 7, ["Alola"], "#f08a1c", true),
  R("moon", "Mo", "Moon", 7, ["Alola"], "#4b5fc7"),
  R("ultra-sun", "US", "Ultra Sun", 7, ["Alola"], "#e86a10"),
  R("ultra-moon", "UM", "Ultra Moon", 7, ["Alola"], "#3a3f9e"),
  R("lets-go-pikachu", "LGP", "Let's Go, Pikachu!", 7, ["Kanto"], "#f2c200", true),
  R("lets-go-eevee", "LGE", "Let's Go, Eevee!", 7, ["Kanto"], "#a8692a"),
  R("sword", "Sw", "Sword", 8, ["Galar", "Isle of Armor", "Crown Tundra"], "#2fa8d9", true),
  R("shield", "Sh", "Shield", 8, ["Galar", "Isle of Armor", "Crown Tundra"], "#d93a6a"),
  R("brilliant-diamond", "BD", "Brilliant Diamond", 8, ["Sinnoh"], "#5b8fd6"),
  R("shining-pearl", "SP", "Shining Pearl", 8, ["Sinnoh"], "#d68fb0", true),
  R("legends-arceus", "LA", "Legends: Arceus", 8, [], "#3f6f82"),
  R("scarlet", "S", "Scarlet", 9, ["Paldea", "Kitakami", "Blueberry Academy"], "#e5483d"),
  R("violet", "V", "Violet", 9, ["Paldea", "Kitakami", "Blueberry Academy"], "#7a3fc4"),
  R("legends-za", "ZA", "Legends: Z-A", 9, ["Kalos"], "#1aa3a3"),
];

export const VERSION_BY_KEY: Record<string, VersionInfo> = Object.fromEntries(VERSIONS.map((v) => [v.key, v]));
export const versionOrder = (key: string) => VERSIONS.findIndex((v) => v.key === key);

const NEGATIVE = /^Not (in this game|found in the wild)$/;

/** Collapsed-header summary of a generation; the count is always the number of table rows. */
export function genSummary(gen: EncGen, name: string): string {
  const n = gen.rows.length;
  if (gen.rows.some((r) => r.loc || (r.x && !NEGATIVE.test(r.x)))) return `${n} ${n === 1 ? "entry" : "entries"} for ${name}`;
  return gen.rows.every((r) => r.x === "Not in this game") ? `${name} isn't in these games` : `${name} isn't found in the wild`;
}

/** Which data columns a generation's table needs: a column no row fills is left out. */
export function genColumns(rows: EncRow[]): { levels: boolean; rate: boolean; timed: boolean } {
  const timed = rows.some((r) => r.t);
  return { levels: rows.some((r) => !!r.lv), rate: timed || rows.some((r) => !!r.r), timed };
}
