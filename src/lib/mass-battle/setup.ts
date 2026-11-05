import { DEFAULT_RUNS, MAX_SIDE, MAX_SPECIES, simpleQuestion } from "./share";
import { clampLevel } from "./sets";
import { DEFAULT_FIELD, type ArenaId, type ArmySpec, type BattleSpec, type FieldSpec, type Formation, type GroupRule, type ItemPolicy, type Question, type RulesSpec, type SetChoice, type Spacing, type SpreadUse, type Stance, type Targeting, type UnitSpec } from "./types";

/**
 * The Battle setup panel's state, and its round trip to battles and
 * questions (so a preset or a link fills the panel in, and the panel
 * builds exactly what the link will say). Pure.
 */

export interface RowState {
  /** Stable key for the list. */
  key: string;
  id: number;
  count: number;
  group?: GroupRule;
  set?: SetChoice;
}

export interface SideState {
  rows: RowState[];
  formation: Formation;
  spacing: Spacing;
  targeting: Targeting;
  stance: Stance;
  spread: SpreadUse;
}

export interface SetupState {
  tab: "ask" | "army";
  /** "How many?": the army (its rows share the size) and the boss. */
  army: SideState;
  boss: SideState;
  /** Army vs army. */
  sides: [SideState, SideState];
  level: number;
  arena: ArenaId;
  field: FieldSpec;
  items: ItemPolicy;
  /** Real PP (off: unlimited, the default) and friendly fire (on, as in the games). */
  pp: boolean;
  friendlyFire: boolean;
  threshold: number;
  runs: number;
}

let keySeq = 0;
export const rowKey = () => `r${++keySeq}`;

export const side = (formation: Formation, rows: Omit<RowState, "key">[]): SideState => ({ rows: rows.map((r) => ({ ...r, key: rowKey() })), formation, spacing: "normal", targeting: "nearest", stance: "charge", spread: "auto" });

/** The panel as it first opens: Magikarp against Arceus, and 1,000 Rattata against a Mewtwo. */
export function defaultSetup(id: (slug: string) => number): SetupState {
  return {
    tab: "ask",
    army: side("swarm", [{ id: id("magikarp"), count: 1 }]),
    boss: side("line", [{ id: id("arceus"), count: 1 }]),
    sides: [side("swarm", [{ id: id("rattata"), count: 1000 }]), side("line", [{ id: id("mewtwo"), count: 1 }])],
    level: 100,
    arena: "plains",
    field: { ...DEFAULT_FIELD },
    items: "none",
    pp: false,
    friendlyFire: true,
    threshold: 0.5,
    runs: DEFAULT_RUNS,
  };
}

const toRows = (units: UnitSpec[]): RowState[] => units.map((u) => ({ key: rowKey(), id: u.id, count: u.count, ...(u.group ? { group: u.group } : {}), ...(u.set ? { set: u.set } : {}) }));
const toSide = (a: ArmySpec): SideState => ({ rows: toRows(a.units), formation: a.formation, spacing: a.spacing ?? "normal", targeting: a.targeting ?? "nearest", stance: a.stance ?? "charge", spread: a.spread ?? "auto" });

/** The panel filled in from a battle (the Army vs army tab). */
export function fromBattle(s: SetupState, spec: BattleSpec): SetupState {
  return { ...s, tab: "army", sides: [toSide(spec.sides[0]), toSide(spec.sides[1])], level: spec.level, arena: spec.arena, field: spec.field ?? { ...DEFAULT_FIELD }, items: spec.items ?? "none", pp: !!spec.rules?.pp, friendlyFire: spec.rules?.friendlyFire !== false };
}

/** The panel filled in from a question (the How many? tab). */
export function fromQuestion(s: SetupState, q: Question): SetupState {
  return { ...s, tab: "ask", army: toSide(q.army), boss: toSide(q.boss), level: q.level, arena: q.arena, field: q.field ?? { ...DEFAULT_FIELD }, items: q.items ?? "none", pp: !!q.rules?.pp, friendlyFire: q.rules?.friendlyFire !== false, threshold: q.threshold ?? 0.5, runs: q.runs ?? DEFAULT_RUNS };
}

const toArmy = (s: SideState, counts = true): ArmySpec => {
  const a: ArmySpec = {
    formation: s.formation,
    units: s.rows.slice(0, MAX_SPECIES).map((r) => ({ id: r.group ? 0 : r.id, count: counts ? Math.max(1, Math.min(MAX_SIDE, Math.floor(r.count))) : 1, ...(r.group ? { group: r.group } : {}), ...(r.set && Object.keys(r.set).length ? { set: r.set } : {}) })),
  };
  if (s.spacing !== "normal") a.spacing = s.spacing;
  if (s.targeting !== "nearest") a.targeting = s.targeting;
  if (s.stance !== "charge") a.stance = s.stance;
  if (s.spread !== "auto") a.spread = s.spread;
  return a;
};

/** The rules that differ from the defaults (Real PP off, friendly fire on), or undefined. */
const rulesOf = (s: Pick<SetupState, "pp" | "friendlyFire">): RulesSpec | undefined => (s.pp || !s.friendlyFire ? { ...(s.pp ? { pp: true } : {}), ...(!s.friendlyFire ? { friendlyFire: false } : {}) } : undefined);

const fieldOrNone = (f: FieldSpec) => (f.weather === "none" && f.terrain === "none" && f.time === "day" ? undefined : { ...f });

/** The Army vs army tab as a battle. */
export function toBattle(s: SetupState, seed: number): BattleSpec {
  const spec: BattleSpec = { sides: [toArmy(s.sides[0]), toArmy(s.sides[1])], level: clampLevel(s.level), arena: s.arena, seed };
  const f = fieldOrNone(s.field);
  if (f) spec.field = f;
  if (s.items === "sets") spec.items = "sets";
  const rules = rulesOf(s);
  if (rules) spec.rules = rules;
  return spec;
}

/** The How many? tab as a question. */
export function toQuestion(s: SetupState): Question {
  const q: Question = { army: toArmy(s.army, false), boss: toArmy(s.boss), level: clampLevel(s.level), arena: s.arena };
  const f = fieldOrNone(s.field);
  if (f) q.field = f;
  if (s.items === "sets") q.items = "sets";
  const rules = rulesOf(s);
  if (rules) q.rules = rules;
  if (s.threshold !== 0.5) q.threshold = s.threshold;
  if (s.runs !== DEFAULT_RUNS) q.runs = s.runs;
  return q;
}

/** A simple question's panel (for tests and the defaults). */
export const simpleSetup = (s: SetupState, challenger: number, boss: number) => fromQuestion(s, simpleQuestion(challenger, boss, s.level, s.arena));
