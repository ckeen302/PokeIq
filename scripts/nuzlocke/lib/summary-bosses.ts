/**
 * Bosses that a walkthrough's index names in a part's summary, where no walkthrough page shows the battle: Scarlet and
 * Violet's index outlines its whole route ("Victory Road, Part 7: Cortondo, South Province (Area Six), Alfornada,
 * Alfornada Gym Test…"), but Bulbapedia has written the pages of its first 15 parts only. Each summary item here names
 * the boss it is and the Bulbapedia page whose {{Party}} has that battle; the cap is that party's highest level, as
 * for a walkthrough's own parties. An item with no page is a boss whose battle data Bulbapedia doesn't give: no cap.
 */
import type { NuzBoss } from "../../../src/lib/nuzlocke/model";
import { pages, pageUrl, plain, templates } from "./bulbapedia";

interface Ref {
  /** The boss's title in our data. */
  name: string;
  /** Bulbapedia page with the battle's {{Party}}. */
  page?: string;
  /** The Party's trainer name, and the heading right above it. */
  trainer?: string;
  under?: RegExp;
  /** Take the badge from the page's infobox (a Gym page). */
  badge?: boolean;
}

export const SUMMARY_BOSSES: Record<string, Record<string, Ref[]>> = {
  // The walkthrough shows Kleavor's, Lilligant's and Arcanine's frenzies with a Pokémon box (their level); Electrode's
  // and Avalugg's with none.
  "legends-arceus": Object.fromEntries(["Kleavor", "Lilligant", "Arcanine", "Electrode", "Avalugg"].map((n) => [`Frenzied ${n}`, [{ name: `Noble ${n}` }]])),
  "scarlet-violet": {
    "Montenevera Gym Test": [{ name: "Ryme", page: "Montenevera Gym", trainer: "Ryme", under: /^Gym battle$/, badge: true }],
    "The Quaking Earth Titan": [{ name: "Titan Great Tusk (Scarlet) / Iron Treads (Violet)" }],
    "Alfornada Gym Test": [{ name: "Tulip", page: "Alfornada Gym", trainer: "Tulip", under: /^Gym battle$/, badge: true }],
    "Glaseado Gym Test": [{ name: "Grusha", page: "Glaseado Gym", trainer: "Grusha", under: /^Gym battle$/, badge: true }],
    "Team Star's Fairy Crew": [{ name: "Team Star Ortega", page: "Ortega", trainer: "Ortega", under: /^First battle$/ }],
    "The False Dragon Titan": [{ name: "Titan Tatsugiri and Dondozo" }],
    "Team Star's Fighting Crew": [{ name: "Team Star Eri", page: "Eri", trainer: "Eri", under: /^First battle$/ }],
    "Elite Four": ["Rika", "Poppy", "Larry", "Hassel"].map((n) => ({ name: `Elite Four ${n}`, page: "Pokémon League (Paldea)", trainer: n, under: /^Elite Test room$/ })),
    "Top Champion Geeta": [{ name: "Top Champion Geeta", page: "Pokémon League (Paldea)", trainer: "Geeta", under: /^Rooftop$/ }],
  },
};

export interface SummaryBosses {
  /** Summary item -> its bosses, in order. */
  byItem: Map<string, NuzBoss[]>;
  urls: string[];
  /** Per boss: where its cap came from (or why it has none). */
  notes: string[];
}

export async function summaryBosses(game: string): Promise<SummaryBosses> {
  const cfg = SUMMARY_BOSSES[game] ?? {};
  const refs = Object.values(cfg).flat();
  const got = await pages([...new Set(refs.flatMap((r) => (r.page ? [r.page] : [])))]);
  const byItem = new Map<string, NuzBoss[]>();
  const urls = new Set<string>();
  const notes: string[] = [];
  for (const [item, rs] of Object.entries(cfg)) {
    const out: NuzBoss[] = [];
    for (const r of rs) {
      if (!r.page) {
        out.push({ name: r.name });
        notes.push(`${r.name}: no cap (Bulbapedia gives no battle data for it)`);
        continue;
      }
      const text = got.get(r.page)?.text;
      if (!text) throw new Error(`${game}: no Bulbapedia page ${r.page} for ${r.name}`);
      const heads = [...text.matchAll(/^(={2,6})\s*(.*?)\s*\1\s*$/gm)].map((h) => ({ at: h.index!, name: plain(h[2]) }));
      const party = templates(text).find((t) => /^Party$/i.test(t.name) && plain(t.named.name ?? "") === r.trainer && r.under!.test(heads.filter((h) => h.at < t.start).pop()?.name ?? ""));
      if (!party) throw new Error(`${game}: no ${r.trainer} party under ${r.under} on ${r.page}`);
      const end = text.indexOf("{{Party/end}}", party.end);
      const levels = templates(text.slice(party.end, end < 0 ? undefined : end))
        .filter((t) => /^Pokémon$/i.test(t.name))
        .map((t) => Number(plain(t.named.level ?? "").match(/\d+/)?.[0] ?? NaN))
        .filter(Number.isFinite);
      if (!levels.length) throw new Error(`${game}: ${r.trainer}'s party on ${r.page} has no levels`);
      const badge = r.badge ? plain(text.match(/^\|\s*badge\s*=\s*([^\n|]+)/m)?.[1] ?? "") : "";
      out.push({ name: r.name, ...(badge ? { badge } : {}), cap: Math.max(...levels) });
      urls.add(pageUrl(r.page));
      notes.push(`${r.name}: cap ${Math.max(...levels)} from ${pageUrl(r.page)} (${r.trainer}'s party under "${heads.filter((h) => h.at < party.start).pop()?.name}")`);
    }
    byItem.set(item, out);
  }
  return { byItem, urls: [...urls], notes };
}
