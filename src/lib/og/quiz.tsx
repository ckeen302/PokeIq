import "server-only";
import type { ModuleId } from "@/engines/types";
import { speciesName } from "@/lib/names/species";
import { QuizVisual } from "./card";
import { englishOgT, type OgT } from "./i18n";

/** An answer in the card's language: a species' official name, or a line of the og namespace. */
type Answer = (t: OgT) => string;
const mon = (id: number, english: string): Answer => (t) => speciesName(id, english, t.locale);
const same = (text: string): Answer => () => text;

/** A sample question per quiz mode for the share cards (a made-up example, never a live question). */
const SAMPLES: Record<ModuleId, { answers: Answer[]; right: number }> = {
  "whos-that": { answers: [mon(94, "Gengar"), mon(93, "Haunter"), mon(778, "Mimikyu"), mon(302, "Sableye")], right: 0 },
  cry: { answers: [mon(25, "Pikachu"), mon(172, "Pichu"), mon(26, "Raichu"), mon(417, "Pachirisu")], right: 0 },
  dex: { answers: [mon(131, "Lapras"), mon(87, "Dewgong"), mon(134, "Vaporeon"), mon(350, "Milotic")], right: 0 },
  types: { answers: [same("4×"), same("2×"), same("1×"), same("½×")], right: 0 },
  "higher-lower": { answers: [mon(135, "Jolteon"), mon(169, "Crobat"), mon(142, "Aerodactyl"), mon(101, "Electrode")], right: 3 },
  games: { answers: [(t) => t("quizSamples.games.a0"), (t) => t("quizSamples.games.a1"), (t) => t("quizSamples.games.a2"), (t) => t("quizSamples.games.a3")], right: 0 },
  anime: { answers: [(t) => t("quizSamples.anime.a0"), (t) => t("quizSamples.anime.a1"), (t) => t("quizSamples.anime.a2"), (t) => t("quizSamples.anime.a3")], right: 1 },
  competitive: { answers: [(t) => t("quizSamples.competitive.a0"), (t) => t("quizSamples.competitive.a1"), (t) => t("quizSamples.competitive.a2"), (t) => t("quizSamples.competitive.a3")], right: 0 },
  shiny: { answers: [same("1"), same("2"), same("3"), same("4")], right: 2 },
  "zoom-reveal": { answers: [mon(6, "Charizard"), mon(59, "Arcanine"), mon(136, "Flareon"), mon(157, "Typhlosion")], right: 0 },
  "whose-team": { answers: [(t) => t("quizSamples.whose-team.a0"), (t) => t("quizSamples.whose-team.a1"), (t) => t("quizSamples.whose-team.a2"), (t) => t("quizSamples.whose-team.a3")], right: 0 },
  mixed: { answers: [(t) => t("quizSamples.mixed.a0"), (t) => t("quizSamples.mixed.a1"), (t) => t("quizSamples.mixed.a2"), (t) => t("quizSamples.mixed.a3")], right: -1 },
};

export function sampleQuestion(module: ModuleId, accent: string, t: OgT = englishOgT(), label = t("quizSamples.label")) {
  const s = SAMPLES[module];
  return <QuizVisual label={label} question={t(`quizSamples.${module}.question`)} answers={s.answers.map((a) => a(t))} right={s.right} accent={accent} />;
}
