import type { Athlete } from "@/lib/games/athlete";
import { HIGH_JUMP, JAVELIN, LIFT, LONG_JUMP, SHOT, SPRINT, SWIM, THROW, WRESTLE } from "@/lib/games/constants";
import { eventOf, localNum, type EventId } from "@/lib/games/events";
import { aquatic, swimSpe } from "@/lib/games/swim";
import type { Keys, Translator } from "@/i18n/catalog";
import type gamesInfo from "@/messages/games-info";

/**
 * "How it works" for each event: the formula, the inputs it reads (only
 * real data: base stats, height, weight, types, abilities, body shape and
 * egg groups), and what's modelled and what isn't. The same words on the
 * page, in the 3D view's panel and on the records pages. The text is the
 * games-info messages; the page (server) or the 3D view (browser) hands
 * over its translator.
 */

export type GamesInfoT = Translator<typeof gamesInfo.en>;
type Key = Keys<typeof gamesInfo.en>;
type Line = [Key, Record<string, string>?];

interface Section {
  formula: Line[];
  inputs: Key;
  modelled: Key[];
  not: Key[];
}

const n = (v: number) => String(v);

export const INFO: Record<EventId, Section> = {
  "100m": sprint(100),
  "200m": sprint(200),
  "400m": sprint(400),
  "long-jump": {
    formula: [
      ["long-jump.formula.0", { runUp: n(LONG_JUMP.runUp), boardKeep: n(LONG_JUMP.boardKeep) }],
      ["long-jump.formula.1", { v: n(LONG_JUMP.vVertical) }],
      ["long-jump.formula.2", { comTakeoff: n(LONG_JUMP.comTakeoff), comLanding: n(LONG_JUMP.comLanding), share: n(LONG_JUMP.takeoffShare) }],
      ["long-jump.formula.3"],
    ],
    inputs: "long-jump.inputs",
    modelled: ["long-jump.modelled.0", "long-jump.modelled.1", "long-jump.modelled.2", "long-jump.modelled.3", "long-jump.modelled.4"],
    not: ["long-jump.not.0", "long-jump.not.1"],
  },
  "high-jump": {
    formula: [
      ["high-jump.formula.0", { com: n(HIGH_JUMP.com) }],
      ["high-jump.formula.1", { v: n(HIGH_JUMP.vVertical) }],
      ["high-jump.formula.2", { bonus: n(HIGH_JUMP.bipedBonus), penalty: n(HIGH_JUMP.quadPenalty) }],
      ["high-jump.formula.3"],
    ],
    inputs: "high-jump.inputs",
    modelled: ["high-jump.modelled.0", "high-jump.modelled.1", "high-jump.modelled.2"],
    not: ["high-jump.not.0"],
  },
  "shot-put": {
    formula: [
      ["shot-put.formula.0", { v: n(SHOT.vRef) }],
      ["shot-put.formula.1", { mass: n(SHOT.mass), cap: n(THROW.vCap) }],
      ["shot-put.formula.2", { angle: n(SHOT.angle), share: n(SHOT.releaseShare), releaseCap: n(SHOT.releaseCap), diameter: n(SHOT.diameter * 100) }],
      ["shot-put.formula.3", { noArms: n(THROW.noArms * 100) }],
    ],
    inputs: "shot-put.inputs",
    modelled: ["shot-put.modelled.0", "shot-put.modelled.1", "shot-put.modelled.2"],
    not: ["shot-put.not.0", "shot-put.not.1"],
  },
  javelin: {
    formula: [
      ["javelin.formula.0", { runKeep: n(JAVELIN.runKeep), runUp: n(JAVELIN.runUp), arm: n(JAVELIN.armRef) }],
      ["javelin.formula.1", { mass: n(JAVELIN.mass * 1000), angle: n(JAVELIN.angle), share: n(JAVELIN.releaseShare) }],
      ["javelin.formula.2", { noArms: n(THROW.noArms * 100) }],
    ],
    inputs: "javelin.inputs",
    modelled: ["javelin.modelled.0", "javelin.modelled.1", "javelin.modelled.2"],
    not: ["javelin.not.0", "javelin.not.1"],
  },
  weightlifting: {
    formula: [
      ["weightlifting.formula.0", { ref: n(LIFT.ref), defExp: n(LIFT.defExp) }],
      ["weightlifting.formula.1", { opening: n(LIFT.opening * 100), second: n(LIFT.second * 100), third: n(LIFT.third * 100) }],
      ["weightlifting.formula.2", { width: n(LIFT.width * 100) }],
      ["weightlifting.formula.3"],
    ],
    inputs: "weightlifting.inputs",
    modelled: ["weightlifting.modelled.0", "weightlifting.modelled.1"],
    not: ["weightlifting.not.0", "weightlifting.not.1"],
  },
  "50m-freestyle": swim(50),
  "100m-freestyle": swim(100),
  wrestling: {
    formula: [
      ["wrestling.formula.0", { push: n(WRESTLE.push), brace: n(WRESTLE.brace), friction: n(WRESTLE.friction) }],
      ["wrestling.formula.1"],
      ["wrestling.formula.2", { ring: n(WRESTLE.ring), maxTime: n(WRESTLE.maxTime) }],
    ],
    inputs: "wrestling.inputs",
    modelled: ["wrestling.modelled.0", "wrestling.modelled.1"],
    not: ["wrestling.not.0"],
  },
  "all-around": {
    formula: [["all-around.formula.0"], ["all-around.formula.1"], ["all-around.formula.2"]],
    inputs: "all-around.inputs",
    modelled: ["all-around.modelled.0"],
    not: ["all-around.not.0"],
  },
};

function sprint(d: number): Section {
  return {
    formula: [
      ["sprint.formula.0"],
      ["sprint.formula.1", { fast: n(SPRINT.reactionFast), slow: n(SPRINT.reactionSlow), falseStart: SPRINT.falseStart.toFixed(3) }],
      ["sprint.formula.2", { dip: n(SPRINT.dip) }],
      ["sprint.formula.3"],
    ],
    inputs: d === 100 ? "sprint.inputs100" : "sprint.inputs",
    modelled: [d === 100 ? "sprint.heats" : "sprint.stagger", "sprint.form"],
    not: ["sprint.not.0", "sprint.not.1"],
  };
}

function swim(d: number): Section {
  return {
    formula: [
      ["swim.formula.0", { vRef: n(SWIM.vRef), speedExp: n(SWIM.speedExp) }],
      ["swim.formula.1", { water: n(SWIM.water), sinkers: n(SWIM.sinkers), other: n(SWIM.other), fin: n(SWIM.fin) }],
      ["swim.formula.2"],
      [d === 100 ? "swim.formula.3turn" : "swim.formula.3", { fade: n(SWIM.fadeOnset) }],
    ],
    inputs: "swim.inputs",
    modelled: ["swim.modelled.0", "swim.modelled.1"],
    not: ["swim.not.0", "swim.not.1"],
  };
}

/** A line in the language: its numbers written the language's way (a decimal comma in es/fr/de/it). */
function line(t: GamesInfoT, [key, values]: Line): string {
  if (!values) return t(key);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) out[k] = localNum(v, t.locale);
  return t(key, out);
}

export function GamesInfo({ t, event, compact = false, athletes = [], rain = false, typeName }: { t: GamesInfoT; event: EventId; compact?: boolean; athletes?: Athlete[]; rain?: boolean; typeName?: (type: string) => string }) {
  const s = INFO[event];
  const e = eventOf(event);
  const part = (p: ReturnType<typeof aquatic>["parts"][number]) =>
    t.locale === "en" ? p.label : p.id === "sinks" ? t("parts.sinks", { types: (p.types ?? []).map((x) => typeName?.(x) ?? x).join("/") }) : t(`parts.${p.id}`);
  return (
    <div className={compact ? "space-y-3 text-sm" : "space-y-4 text-sm text-muted-foreground"}>
      <div>
        <h3 className={compact ? "font-display text-xs font-bold uppercase tracking-wider text-[#ffd84a]" : "font-display text-sm font-bold uppercase tracking-wider text-foreground"}>{t("formula")}</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {s.formula.map((f) => {
            const text = line(t, f);
            return <li key={text}>{text}</li>;
          })}
        </ul>
      </div>
      <p><span className={compact ? "text-white" : "text-foreground"}>{t("inputs")}</span> {t(s.inputs)}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <h3 className={compact ? "font-display text-xs font-bold uppercase tracking-wider text-[#9fd8ff]" : "font-display text-sm font-bold uppercase tracking-wider text-foreground"}>{t("modelled")}</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">{s.modelled.map((x) => <li key={x}>{t(x)}</li>)}</ul>
        </div>
        <div>
          <h3 className={compact ? "font-display text-xs font-bold uppercase tracking-wider text-[#9fd8ff]" : "font-display text-sm font-bold uppercase tracking-wider text-foreground"}>{t("not")}</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">{s.not.map((x) => <li key={x}>{t(x)}</li>)}</ul>
        </div>
      </div>
      {e.kind === "swim" && athletes.length > 0 && (
        <div>
          <h3 className={compact ? "font-display text-xs font-bold uppercase tracking-wider text-[#ffd84a]" : "font-display text-sm font-bold uppercase tracking-wider text-foreground"}>{t("aquatic")}</h3>
          <ul className="mt-1 space-y-0.5">
            {athletes.map((a) => {
              const q = aquatic(a);
              const ss = swimSpe(a, rain) !== a.stats.spe;
              return <li key={a.key}><span className={compact ? "text-white" : "text-foreground"}>{a.name}</span>: {q.parts.map((p) => `${part(p)} (${localNum(String(p.k), t.locale)})`).join(" × ")}{ss ? t("swiftSwim") : ""} = {localNum(q.factor.toFixed(2), t.locale)}</li>;
            })}
          </ul>
        </div>
      )}
      <p className="text-xs opacity-75">{t("common")}</p>
    </div>
  );
}
