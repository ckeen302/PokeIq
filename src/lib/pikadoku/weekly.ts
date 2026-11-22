import { Rng } from "@/lib/rng";
import { allCategories, categoryById, type PdkCategory } from "./categories";
import type { PdkGridIds } from "./generator";
import { gridAnswers, isSolvable } from "./solve";
import { weekNumber, type WeekThemeId } from "./weeks";
import { translator } from "@/i18n/catalog";
import pikadoku from "@/messages/pikadoku";
import { PDK_MIN_ANSWERS, PDK_SIZE } from "./types";

/**
 * The weekly themed grid: one grid for everybody, live Monday to Sunday
 * (UTC), with its own board. The theme rotates through five weeks. A themed
 * grid is generated from a subset of the categories: the theme's anchor is
 * always one of the six, and the other five come from what the theme allows.
 */
export { isLiveWeek, weekEnd, weekNumber, weekStart } from "./weeks";

export interface WeekTheme {
  id: WeekThemeId;
  name: string;
  blurb: string;
  /** The category that is always on the grid. */
  anchor: string;
  /** What the other five may be. */
  allow: (c: PdkCategory) => boolean;
  /** Fewest valid answers per cell. */
  min: number;
}

const basic = (c: PdkCategory) => c.tier <= 2;
const fams = (...f: string[]) => (c: PdkCategory) => basic(c) && f.includes(c.family);
const en = translator(pikadoku, "en", undefined);
/** A theme's name and blurb (in English: the server sends them; another language's page shows its own). */
const named = (id: WeekThemeId) => ({ name: en(`weeklyTheme.${id}.name`), blurb: en(`weeklyTheme.${id}.blurb`) });

/** The rotation, in order: week 1 is Kanto, week 2 Starters, and so on, then round again. */
export const WEEK_THEMES: readonly WeekTheme[] = [
  { id: "kanto", ...named("kanto"), anchor: "region:1", allow: (c) => fams("types", "evolution", "other")(c) && !c.id.startsWith("other:paradox") && !c.id.startsWith("other:ultrabeast"), min: PDK_MIN_ANSWERS.normal },
  { id: "starters", ...named("starters"), anchor: "other:partner", allow: fams("types", "evolution", "regions", "other"), min: PDK_MIN_ANSWERS.normal },
  { id: "legendary", ...named("legendary"), anchor: "other:lm", allow: fams("types", "regions", "other", "abilities"), min: PDK_MIN_ANSWERS.normal },
  { id: "gen9", ...named("gen9"), anchor: "region:9", allow: fams("types", "evolution", "other", "abilities"), min: PDK_MIN_ANSWERS.normal },
  { id: "competitive", ...named("competitive"), anchor: "other:ou", allow: (c) => (fams("types", "evolution", "abilities")(c) || c.id.startsWith("stat:")) && c.id !== "other:ou", min: 2 },
];

/** The theme of a week. */
export const themeFor = (monday: string): WeekTheme => WEEK_THEMES[(((weekNumber(monday) - 1) % WEEK_THEMES.length) + WEEK_THEMES.length) % WEEK_THEMES.length];

/** Six categories for a week, generated from the theme's subset. Deterministic, and checked solvable. */
export function weeklyIds(monday: string): PdkGridIds {
  const theme = themeFor(monday);
  const anchor = categoryById(theme.anchor)!;
  const pool = allCategories().filter((c) => c.id !== anchor.id && c.group !== anchor.group && theme.allow(c));
  const rng = new Rng(`pikadoku:weekly:${monday}`);
  for (let t = 0; t < 2000; t++) {
    const picked: PdkCategory[] = [anchor];
    const groups = new Set([anchor.group]);
    for (let guard = 0; picked.length < PDK_SIZE * 2 && guard < 80; guard++) {
      const c = rng.pick(pool);
      if (groups.has(c.group)) continue;
      groups.add(c.group);
      picked.push(c);
    }
    if (picked.length < PDK_SIZE * 2) continue;
    // The anchor is the first row; the rest are shuffled in a seeded order.
    const rest = rng.shuffle(picked.slice(1));
    const ordered = [anchor, ...rest];
    const rows = ordered.slice(0, PDK_SIZE);
    const cols = ordered.slice(PDK_SIZE);
    if (isSolvable(gridAnswers(rows, cols), theme.min)) return { rows: rows.map((c) => c.id), cols: cols.map((c) => c.id) };
  }
  throw new Error(`No weekly grid found for ${monday}`);
}
