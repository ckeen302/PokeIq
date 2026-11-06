import { BookOpen, Box, Compass, Gamepad2, Grid3x3, LayoutGrid, Search, Swords, type LucideIcon } from "lucide-react";
import { LAB_PATH } from "@/lib/lab";

/** One cut of a slide's clip: H.264 and AV1 MP4s and their first frame (the poster), in /public/home/clips. */
export interface ClipCut {
  video: string;
  /** The same clip in AV1: smaller, and playable where H.264 isn't. */
  av1: string;
  poster: string;
  width: number;
  height: number;
}

/**
 * A slide's clip: the tab played on the real site, recorded by
 * scripts/hero-videos (16:9 for wider screens, 4:5 at a phone's layout).
 */
export interface SectionClip {
  desktop: ClipCut;
  phone: ClipCut;
  /** What the clip shows, for the poster's alt text. */
  alt: string;
  /** CSS object-position: which part stays in view when the box crops the 16:9 cut. */
  position?: string;
}

const clip = (id: string, alt: string, position?: string): SectionClip => ({
  desktop: { video: `/home/clips/${id}-desktop.mp4`, av1: `/home/clips/${id}-desktop.av1.mp4`, poster: `/home/clips/${id}-desktop.webp`, width: 1600, height: 900 },
  phone: { video: `/home/clips/${id}-phone.mp4`, av1: `/home/clips/${id}-phone.av1.mp4`, poster: `/home/clips/${id}-phone.webp`, width: 800, height: 1000 },
  alt,
  ...(position && { position }),
});

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
  /** The slide's clip. */
  clip: SectionClip;
}

/**
 * The site's main tabs, for the title screen's slideshow and the tiles under
 * it. PokéGuessr leads (its poster is the page's hero image); the rest follow
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
    clip: clip("guessr", "A PokéGuessr round: a pin dropped on the map of Paldea, then the score"),
  },
  {
    id: "pokedle",
    href: "/pokedle",
    name: "Pokédle",
    line: "Name today's mystery Pokémon",
    cta: "Play",
    icon: Search,
    accent: "258 94% 74%",
    clip: clip("pokedle", "A Pokédle game solved on the fourth guess"),
  },
  {
    id: "connections",
    href: "/connections",
    name: "Connections",
    line: "Find the links between Pokémon",
    cta: "Play",
    icon: LayoutGrid,
    accent: "42 98% 60%",
    clip: clip("connections", "Two PokéConnections groups found"),
  },
  {
    id: "pikadoku",
    href: "/pikadoku",
    name: "Pikadoku",
    line: "Pokémon Sudoku, one grid a day",
    cta: "Play",
    icon: Grid3x3,
    accent: "190 90% 55%",
    clip: clip("pikadoku", "A Pikadoku grid filled to the last cell"),
  },
  {
    id: "battle",
    href: "/battle",
    name: "Battle",
    line: "Showdown battles, against the computer or live",
    cta: "Battle",
    icon: Swords,
    accent: "340 86% 60%",
    clip: clip("battle", "A battle against the computer, ending in a knockout"),
  },
  {
    id: "quizzes",
    href: "/play",
    name: "Quizzes",
    line: "Silhouettes, cries, types and more",
    cta: "Play",
    icon: Gamepad2,
    accent: "24 95% 58%",
    clip: clip("quizzes", "Who's That Pokémon? silhouettes named and revealed"),
  },
  {
    id: "pokedex",
    href: "/pokedex",
    name: "Pokédex",
    line: "Stats, moves, matchups and entries",
    cta: "Explore",
    icon: BookOpen,
    accent: "214 90% 64%",
    clip: clip("pokedex", "The Pokédex: Pikachu's entry, its stats and evolutions"),
  },
  {
    id: "lab",
    href: LAB_PATH,
    name: "3D Lab",
    line: "Pokémon history and battles in 3D",
    cta: "Explore",
    icon: Box,
    accent: "300 75% 68%",
    clip: clip("lab", "A scene from The Story of Pokémon, a 3D film"),
  },
];
