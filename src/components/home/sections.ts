import { BookOpen, Gamepad2, Swords, type LucideIcon } from "lucide-react";

export interface HomeSection {
  id: "battle" | "quizzes" | "pokedex";
  href: string;
  name: string;
  /** One short line for the card. */
  line: string;
  icon: LucideIcon;
  /** HSL triplet. */
  accent: string;
}

/** The home page's More to play: the tabs that aren't a daily or the 3D Lab. */
export const HOME_SECTIONS: HomeSection[] = [
  {
    id: "battle",
    href: "/battle",
    name: "Battle",
    line: "Showdown battles, against the computer or live",
    icon: Swords,
    accent: "340 86% 60%",
  },
  {
    id: "quizzes",
    href: "/play",
    name: "Quizzes",
    line: "Silhouettes, cries, types and more",
    icon: Gamepad2,
    accent: "24 95% 58%",
  },
  {
    id: "pokedex",
    href: "/pokedex",
    name: "Pokédex",
    line: "Stats, moves, matchups and entries",
    icon: BookOpen,
    accent: "214 90% 64%",
  },
];
