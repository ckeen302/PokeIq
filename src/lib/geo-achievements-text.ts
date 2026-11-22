import { type Keys, type Translator } from "@/i18n/catalog";
import { formatNumber } from "@/i18n/format";
import type geoRecord from "@/messages/geo-record";
import { GEO_EXPERT_AVG, GEO_EXPERT_ROUNDS, GEO_PERFECT_SCORE, type GeoAchievement } from "./geo-achievements";
import { localRegion, type GeoNamesT } from "./geo-i18n";

/**
 * PokéGuessr achievements in the page's language: each badge's name and what it takes (geo-achievements.ts holds
 * them in English, with the rules), and the server's progress note. English comes back exactly as defined there.
 */

export type RecordT = Translator<typeof geoRecord.en>;
type RecordKey = Keys<typeof geoRecord.en>;

export function achievementText(def: GeoAchievement, t: RecordT, names: GeoNamesT): { name: string; blurb: string } {
  if (t.locale === "en") return { name: def.name, blurb: def.blurb };
  const f = (n: number) => formatNumber(n, t.locale);
  const named = (key: string) => (t.has(key) ? t(key as RecordKey) : null);
  let m: RegExpExecArray | null;
  if ((m = /^perfect-(\d+)$/.exec(def.id))) {
    const n = Number(m[1]);
    return { name: named(`names.${def.id}`) ?? def.name, blurb: n === 1 ? t("blurbs.perfectOne", { score: f(GEO_PERFECT_SCORE) }) : t("blurbs.perfect", { score: f(GEO_PERFECT_SCORE), n: f(n) }) };
  }
  if ((m = /^expert-(\w+)$/.exec(def.id))) {
    const region = localRegion(names, m[1]);
    return { name: t("expertName", { region }), blurb: t("blurbs.expert", { avg: f(GEO_EXPERT_AVG), rounds: GEO_EXPERT_ROUNDS, region }) };
  }
  if ((m = /^(streak|daily)-(\d+)$/.exec(def.id))) {
    return { name: named(`names.${def.id}`) ?? def.name, blurb: t(m[1] === "streak" ? "blurbs.streak" : "blurbs.daily", { n: Number(m[2]) }) };
  }
  if ((m = /^ranked-(\w+)$/.exec(def.id)) && t.has(`balls.${m[1]}`)) {
    const ball = t(`balls.${m[1]}` as RecordKey);
    return { name: t("rankedName", { ball }), blurb: t("blurbs.ranked", { ball }) };
  }
  return { name: named(`names.${def.id}`) ?? def.name, blurb: named(`blurbs.${def.id}`) ?? def.blurb };
}

/** The server's note under a badge's bar ("Average 3,812 of 3,500 needed"), in the page's language. */
export function achievementNote(note: string, t: RecordT): string {
  if (t.locale === "en") return note;
  const m = /^Average ([\d,]+) of ([\d,]+) needed$/.exec(note);
  if (!m) return note;
  const n = (s: string) => formatNumber(Number(s.replace(/,/g, "")), t.locale);
  return t("note", { avg: n(m[1]), need: n(m[2]) });
}
