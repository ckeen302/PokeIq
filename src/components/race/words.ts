import type { Translator } from "@/i18n/catalog";
import race from "@/messages/race";
import { DEFAULT_PRESET, PRESET_BY_ID } from "@/lib/race/presets";
import { vsOk } from "@/lib/race/deeplink";
import type { RaceSpec } from "@/lib/race/lineup";
import type { Entrant } from "@/lib/race/types";

/**
 * The race's composed text (a field's title and hook, round names) from the race namespace, in the page's language.
 * On English pages these give exactly lib/race/lineup's and lib/race/tournament's English (tests/i18n-race).
 */

type T = Translator<typeof race.en>;
type PresetId = keyof typeof race.en.presets;

const presetId = (id: string) => (PRESET_BY_ID.get(id) ?? DEFAULT_PRESET).id as PresetId;

/** A preset's label: "Fastest Eight". */
export const presetLabel = (id: string, t: T) => t(`presets.${presetId(id)}.label`);

/** A preset's video hook. */
export const presetHook = (id: string, t: T) => t(`presets.${presetId(id)}.hook`);

/** A field's title and hook (lib/race/lineup's fieldFor's), from its spec and its runners (named in the page's language). */
export function fieldText(spec: RaceSpec, entrants: Entrant[], t: T): { title: string; hook: string } {
  if (spec.vs.length === 1 && entrants.length && entrants[0].key === spec.vs[0]) {
    const name = entrants[0].name;
    return { title: t("field.heat", { name }), hook: t("field.heatHook", { name }) };
  }
  if (vsOk(spec.vs.length)) {
    const names = entrants.map((e) => e.name).join(t("field.sep"));
    return { title: names, hook: t("field.vsHook", { names }) };
  }
  const p = PRESET_BY_ID.get(spec.preset) ?? DEFAULT_PRESET;
  if (p.tournament) return { title: t("field.final", { label: presetLabel(p.id, t) }), hook: presetHook(p.id, t) };
  return { title: presetLabel(p.id, t), hook: presetHook(p.id, t) };
}

/** A knockout round's name ("Semi-finals") in the page's language. */
export function roundName(name: string, t: T): string {
  if (name === "Final") return t("round.final");
  if (name === "Semi-finals") return t("round.semis");
  if (name === "Quarter-finals") return t("round.quarters");
  if (name === "Round 2") return t("round.round2");
  if (name === "Heats") return t("round.heats");
  return name;
}
