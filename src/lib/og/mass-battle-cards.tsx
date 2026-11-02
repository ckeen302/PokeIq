import "server-only";
import { massBattleCard } from "@/lib/og/mass-battle";
import { armyName, fmt } from "@/lib/mass-battle/copy";
import { prepare, runHeadless } from "@/lib/mass-battle/engine";
import { buildRoster } from "@/lib/mass-battle/roster-data";
import { nameOf, presetById } from "@/lib/mass-battle/page-data";
import type { BattleSpec, Question } from "@/lib/mass-battle/types";

/** The Mass Battle's preview cards, from presets, shared battles and shared questions. */

const total = (spec: BattleSpec, s: 0 | 1) => spec.sides[s].units.reduce((a, u) => a + u.count, 0);
const ids = (spec: BattleSpec, s: 0 | 1) => [...spec.sides[s].units].sort((a, b) => b.count - a.count).map((u) => u.id);

export function presetCardImage(id: string) {
  const p = presetById(id);
  if (!p) return questionCardImage({ challenger: 129, boss: 493, level: 100, arena: "colosseum" });
  if (p.kind === "howmany" && p.question && p.answer) {
    const c = nameOf(p.question.challenger), b = nameOf(p.question.boss);
    return massBattleCard({
      title: [`How many ${c}`, [`beat ${b}?`, "#ff9a2e"]],
      subtitle: `The real games' damage maths, ${fmt(p.answer.runs)} battles a size, then the battle in 3D.`,
      left: [p.question.challenger],
      right: [p.question.boss],
      leftCount: p.answer.n,
      rightCount: 1,
      big: `${fmt(p.answer.n)} ${c}`,
      footer: "See it in 3D →",
    });
  }
  const names = p.labels ?? [armyName(p.spec.sides[0].units.map((u) => nameOf(u.id))), armyName(p.spec.sides[1].units.map((u) => nameOf(u.id)))];
  const o = p.outcome;
  return massBattleCard({
    title: [p.title],
    subtitle: p.blurb,
    left: ids(p.spec, 0),
    right: ids(p.spec, 1),
    leftCount: total(p.spec, 0),
    rightCount: total(p.spec, 1),
    big: o && o.winner !== 2 ? `${names[o.winner]} ${o.left[o.winner] === 1 && !/ and |&|types|s$/.test(names[o.winner]) ? "wins" : "win"}` : null,
  });
}

export function questionCardImage(q: Question) {
  const c = nameOf(q.challenger), b = nameOf(q.boss);
  return massBattleCard({
    title: [`How many ${c}`, [`beat ${b}?`, "#ff9a2e"]],
    subtitle: "Thousands of battles with the real games' damage maths decide it, then you watch it in 3D.",
    left: [q.challenger],
    right: [q.boss],
    leftCount: 10,
    rightCount: 1,
    big: null,
    footer: "Find out →",
  });
}

/** A shared battle: small enough battles are played here, so the card can tell who wins. */
export function battleCardImage(spec: BattleSpec) {
  const a = armyName(spec.sides[0].units.map((u) => nameOf(u.id))), b = armyName(spec.sides[1].units.map((u) => nameOf(u.id)));
  const ta = total(spec, 0), tb = total(spec, 1);
  let big: string | null = null;
  if (ta + tb <= 2500) {
    try {
      const bt = runHeadless(prepare(buildRoster(), spec));
      big = bt.winner === 2 ? "A draw" : `${bt.winner === 0 ? a : b} ${bt.outcome().left[bt.winner] === 1 ? "wins" : "win"}`;
    } catch {
      big = null;
    }
  }
  return massBattleCard({
    title: [`${fmt(ta)} ${a}`, [`vs ${fmt(tb)} ${b}`, "#ff9a2e"]],
    subtitle: "A Pokémon mass battle in 3D with the real games' damage maths.",
    left: ids(spec, 0),
    right: ids(spec, 1),
    leftCount: ta,
    rightCount: tb,
    big,
    footer: big ? "Watch how →" : "Who wins? →",
  });
}
