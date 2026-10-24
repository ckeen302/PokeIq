import "server-only";
import type { ModuleId } from "@/engines/types";
import { QuizVisual } from "./card";

/** A sample question per quiz mode for the share cards (a made-up example, never a live question). */
const SAMPLES: Record<ModuleId, { question: string; answers: string[]; right: number }> = {
  "whos-that": { question: "Who's that Pokémon?", answers: ["Gengar", "Haunter", "Mimikyu", "Sableye"], right: 0 },
  cry: { question: "Whose cry is this?", answers: ["Pikachu", "Pichu", "Raichu", "Pachirisu"], right: 0 },
  dex: { question: "Whose Pokédex entry?", answers: ["Lapras", "Dewgong", "Vaporeon", "Milotic"], right: 0 },
  types: { question: "Ice vs Dragon/Flying?", answers: ["4×", "2×", "1×", "½×"], right: 0 },
  "higher-lower": { question: "Who's faster?", answers: ["Jolteon", "Crobat", "Aerodactyl", "Electrode"], right: 3 },
  games: { question: "New in Gen III?", answers: ["Abilities", "Z-Moves", "Dynamax", "Tera"], right: 0 },
  anime: { question: "Ash's friend in Kalos?", answers: ["Dawn", "Serena", "May", "Iris"], right: 1 },
  competitive: { question: "Type of Moonblast?", answers: ["Fairy", "Psychic", "Dark", "Ghost"], right: 0 },
  shiny: { question: "Which is the real shiny?", answers: ["1", "2", "3", "4"], right: 2 },
  mixed: { question: "A bit of everything", answers: ["Silhouettes", "Cries", "Dex entries", "Type chart"], right: -1 },
};

export function sampleQuestion(module: ModuleId, accent: string, label = "Q 03/10") {
  const s = SAMPLES[module];
  return <QuizVisual label={label} question={s.question} answers={s.answers} right={s.right} accent={accent} />;
}
