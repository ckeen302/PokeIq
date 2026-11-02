import { ARENAS, FORMATIONS, type ArenaId, type BattleLevel, type BattleSpec, type Formation, type Question } from "./types";

/**
 * Share links. A battle is `?b=` with everything that decides it, readable
 * at a glance:
 *
 *   ?b=1.100.plains.k3f9.swarm.line.rattata*1000.mewtwo*1
 *
 * (version, level, arena, seed in base 36, each side's formation, then
 * each side's units as slug*count joined by "_"). The same link replays
 * the same battle. A question is `?ask=magikarp.arceus.100.plains`
 * (`?q=` stays the render quality, as on the other 3D pages).
 * Only characters URLSearchParams leaves alone (letters, digits, - . _ *).
 */

export const MASS_BATTLE_PATH = "/lab/mass-battle";
/** Most units a side can have in a shared or hand-made battle. */
export const MAX_SIDE = 10000;
/** Most species a side can have in the sandbox (presets may have more). */
export const MAX_SPECIES = 4;

export interface SlugIndex {
  id(slug: string): number | undefined;
  slug(id: number): string | undefined;
}

const clampCount = (n: number) => Math.max(1, Math.min(MAX_SIDE, Math.floor(n)));

export function encodeBattle(spec: BattleSpec, slugs: SlugIndex): string {
  const side = (s: 0 | 1) => spec.sides[s].units.map((u) => `${slugs.slug(u.id)}*${u.count}`).join("_");
  return ["1", spec.level, spec.arena, (spec.seed >>> 0).toString(36), spec.sides[0].formation, spec.sides[1].formation, side(0), side(1)].join(".");
}

/** A battle from its link, or null if anything in it is off (an unknown Pokémon, a bad number…). */
export function decodeBattle(code: string | null | undefined, slugs: SlugIndex, maxSpecies = 64): BattleSpec | null {
  if (!code) return null;
  const parts = code.split(".");
  if (parts.length !== 8 || parts[0] !== "1") return null;
  const level = Number(parts[1]);
  if (level !== 50 && level !== 100) return null;
  const arena = parts[2] as ArenaId;
  if (!ARENAS.includes(arena)) return null;
  if (!/^[0-9a-z]{1,7}$/.test(parts[3])) return null;
  const seed = parseInt(parts[3], 36) >>> 0;
  const forms = [parts[4], parts[5]] as Formation[];
  if (!forms.every((f) => FORMATIONS.includes(f))) return null;
  const side = (text: string) => {
    if (!text) return null;
    const units: { id: number; count: number }[] = [];
    for (const u of text.split("_")) {
      const m = /^([a-z0-9-]+)\*(\d{1,6})$/.exec(u);
      if (!m) return null;
      const id = slugs.id(m[1]);
      if (id === undefined) return null;
      const prev = units.find((x) => x.id === id);
      if (prev) prev.count = clampCount(prev.count + Number(m[2]));
      else units.push({ id, count: clampCount(Number(m[2])) });
    }
    if (!units.length || units.length > maxSpecies) return null;
    // The side's total stays within the cap.
    const total = units.reduce((a, u) => a + u.count, 0);
    if (total > MAX_SIDE) {
      const k = MAX_SIDE / total;
      for (const u of units) u.count = Math.max(1, Math.floor(u.count * k));
    }
    return units;
  };
  const a = side(parts[6]), b = side(parts[7]);
  if (!a || !b) return null;
  return { sides: [{ units: a, formation: forms[0] }, { units: b, formation: forms[1] }], level: level as BattleLevel, arena, seed };
}

export function encodeQuestion(q: Question, slugs: SlugIndex): string {
  return [slugs.slug(q.challenger), slugs.slug(q.boss), q.level, q.arena].join(".");
}

export function decodeQuestion(code: string | null | undefined, slugs: SlugIndex): Question | null {
  if (!code) return null;
  const [c, b, lv = "100", arena = "plains"] = code.split(".");
  const challenger = c ? slugs.id(c) : undefined;
  const boss = b ? slugs.id(b) : undefined;
  const level = Number(lv);
  if (challenger === undefined || boss === undefined || (level !== 50 && level !== 100) || !ARENAS.includes(arena as ArenaId)) return null;
  return { challenger, boss, level: level as BattleLevel, arena: arena as ArenaId };
}

export const battleHref = (spec: BattleSpec, slugs: SlugIndex) => `${MASS_BATTLE_PATH}?b=${encodeBattle(spec, slugs)}`;
export const questionHref = (q: Question, slugs: SlugIndex) => `${MASS_BATTLE_PATH}?ask=${encodeQuestion(q, slugs)}`;

/** A fresh seed for a new battle. */
export const newSeed = () => (Math.floor(Math.random() * 2 ** 32) >>> 0) % 36 ** 6;
