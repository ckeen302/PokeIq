import { BookOpen, Box, Compass, Gamepad2, Grid3x3, LayoutGrid, Search, Swords, type LucideIcon } from "lucide-react";
import { LAB_PATH } from "@/lib/lab";

export interface HomeSection {
  id: "guessr" | "pokedle" | "connections" | "pikadoku" | "battle" | "quizzes" | "pokedex" | "lab";
  href: string;
  name: string;
  /** One short line for the tile. */
  line: string;
  icon: LucideIcon;
  /** HSL triplet. */
  accent: string;
}

/**
 * The site's main tabs, for the tiles under the title screen. PokéGuessr
 * leads; the rest follow the top nav.
 */
export const HOME_SECTIONS: HomeSection[] = [
  {
    id: "guessr",
    href: "/guessr",
    name: "PokéGuessr",
    line: "Guess where you are in the Pokémon world",
    icon: Compass,
    accent: "154 68% 46%",
  },
  {
    id: "pokedle",
    href: "/pokedle",
    name: "Pokédle",
    line: "Name today's mystery Pokémon",
    icon: Search,
    accent: "258 94% 74%",
  },
  {
    id: "connections",
    href: "/connections",
    name: "Connections",
    line: "Find the links between Pokémon",
    icon: LayoutGrid,
    accent: "42 98% 60%",
  },
  {
    id: "pikadoku",
    href: "/pikadoku",
    name: "Pikadoku",
    line: "Pokémon Sudoku, one grid a day",
    icon: Grid3x3,
    accent: "190 90% 55%",
  },
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
  {
    id: "lab",
    href: LAB_PATH,
    name: "3D Lab",
    line: "Pokémon history and battles in 3D",
    icon: Box,
    accent: "300 75% 68%",
  },
];
