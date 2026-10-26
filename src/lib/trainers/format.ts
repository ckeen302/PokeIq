/** Client-safe display helpers for trainer data. */
import type { TrainerTeam } from "./types";

export const AREA_KINDS = ["Routes", "Towns & cities", "Places & dungeons"] as const;
export type AreaKind = (typeof AREA_KINDS)[number];

const TOWN = /(City|Town|Island|Village|Plateau|Area|League)$|^(Fight Area|Survival Area|Resort Area|Pokémon League|Indigo Plateau|Ever Grande City)$|^(One|Two|Three|Four|Five|Six|Seven) Island$/;

export function areaKind(name: string): AreaKind {
  if (/^Route \d+/.test(name)) return "Routes";
  if (TOWN.test(name)) return "Towns & cities";
  return "Places & dungeons";
}

/** Routes by number, everything else alphabetically (numbers inside names sort naturally). */
export function compareAreas(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, "en", { numeric: true });
}

/** "Bug Catcher Wade", "Rival", "Brock" (Gen I prints only the class). */
export function teamTitle(t: Pick<TrainerTeam, "cls" | "name">): string {
  if (!t.name) return t.cls;
  if (t.name === t.cls) return t.name;
  return `${t.cls} ${t.name}`;
}

/** URL-safe anchor for a team on its area page. */
export const teamAnchor = (id: string) => `t-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/** Names of the alternate forms trainers use (Gen IV). */
const FORMS: Record<number, Record<number, string>> = {
  412: { 1: "Sandy Cloak", 2: "Trash Cloak" },
  413: { 1: "Sandy Cloak", 2: "Trash Cloak" },
  422: { 1: "East Sea" },
  423: { 1: "East Sea" },
};
export const formName = (species: number, form?: number) => (form ? (FORMS[species]?.[form] ?? `Form ${form}`) : null);

/** The level range of a team, "Lv 12" or "Lv 10–14". */
export function levelRange(team: { lv: number }[]): string {
  const lo = Math.min(...team.map((m) => m.lv));
  const hi = Math.max(...team.map((m) => m.lv));
  return lo === hi ? `Lv ${lo}` : `Lv ${lo}–${hi}`;
}

/** Initials for the placeholder portrait ("Lt. Surge" -> "LS", "Tate & Liza" -> "TL"). */
export function initials(name: string): string {
  const w = name.replace(/[^A-Za-zÀ-ÿ& ]/g, " ").split(/[\s&]+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : name.slice(0, 2)).toUpperCase();
}
