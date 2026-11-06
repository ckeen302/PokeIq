import { BookOpen, Box, Compass, Gamepad2, Grid3x3, LayoutGrid, Search, Swords, type LucideIcon } from "lucide-react";
import { LAB_PATH } from "@/lib/lab";

/** A screenshot in /public for the title screen's slideshow. */
export interface SectionShot {
  /** For the wide title screen: the subject sits in the right half, clear of the headline. */
  src: string;
  /** For phones, where the picture sits above the text: the subject centred. Defaults to `src`. */
  small?: string;
  width: number;
  height: number;
  alt: string;
  /** CSS object-position: which part of the shot stays in view when the box crops it. */
  position?: string;
}

export interface HomeSection {
  id: "guessr" | "pokedle" | "connections" | "pikadoku" | "battle" | "quizzes" | "pokedex" | "lab";
  href: string;
  name: string;
  /** One short line for the tile. */
  line: string;
  /** The slide's button. */
  cta: string;
  icon: LucideIcon;
  /** HSL triplet. */
  accent: string;
  /** The slide's picture (PokéGuessr draws its own showcase instead). */
  shot?: SectionShot;
}

/**
 * The site's main tabs, for the title screen's slideshow and the tiles under
 * it. PokéGuessr leads (its view is the page's hero image); the rest follow
 * the top nav.
 */
export const HOME_SECTIONS: HomeSection[] = [
  {
    id: "guessr",
    href: "/guessr",
    name: "PokéGuessr",
    line: "Guess where you are in the Pokémon world",
    cta: "Play",
    icon: Compass,
    accent: "154 68% 46%",
  },
  {
    id: "pokedle",
    href: "/pokedle",
    name: "Pokédle",
    line: "Name today's mystery Pokémon",
    cta: "Play",
    icon: Search,
    accent: "258 94% 74%",
    shot: { src: "/home/pokedle.webp", small: "/home/pokedle-sm.webp", width: 1200, height: 892, alt: "A Pokédle board partway through today's game" },
  },
  {
    id: "connections",
    href: "/connections",
    name: "Connections",
    line: "Find the links between Pokémon",
    cta: "Play",
    icon: LayoutGrid,
    accent: "42 98% 60%",
    shot: { src: "/home/connections.webp", small: "/home/connections-sm.webp", width: 1200, height: 892, alt: "A PokéConnections board with one group found" },
  },
  {
    id: "pikadoku",
    href: "/pikadoku",
    name: "Pikadoku",
    line: "Pokémon Sudoku, one grid a day",
    cta: "Play",
    icon: Grid3x3,
    accent: "190 90% 55%",
    shot: { src: "/home/pikadoku.webp", small: "/home/pikadoku-sm.webp", width: 1200, height: 892, alt: "A Pikadoku grid with a few Pokémon filled in" },
  },
  {
    id: "battle",
    href: "/battle",
    name: "Battle",
    line: "Showdown battles, against the computer or live",
    cta: "Battle",
    icon: Swords,
    accent: "340 86% 60%",
    shot: { src: "/home/battle.webp", small: "/home/battle-sm.webp", width: 1200, height: 892, alt: "A Pokémon battle in progress" },
  },
  {
    id: "quizzes",
    href: "/play",
    name: "Quizzes",
    line: "Silhouettes, cries, types and more",
    cta: "Play",
    icon: Gamepad2,
    accent: "24 95% 58%",
    shot: { src: "/home/quizzes.webp", small: "/home/quizzes-sm.webp", width: 1200, height: 892, alt: "A Who's That Pokémon question in play" },
  },
  {
    id: "pokedex",
    href: "/pokedex",
    name: "Pokédex",
    line: "Stats, moves, matchups and entries",
    cta: "Explore",
    icon: BookOpen,
    accent: "214 90% 64%",
    shot: { src: "/home/pokedex.webp", width: 1200, height: 892, alt: "The Pokédex grid" },
  },
  {
    id: "lab",
    href: LAB_PATH,
    name: "3D Lab",
    line: "Pokémon history and battles in 3D",
    cta: "Explore",
    icon: Box,
    accent: "300 75% 68%",
    shot: { src: "/lab/pokemon-story.webp", width: 1280, height: 720, alt: "A scene from The Story of Pokémon, a 3D film" },
  },
];
