/**
 * The 3D Lab: the site's cinematic 3D experiences, gathered on /lab. The nav's
 * 3D Lab tab lights up on /lab and on each experience's own pages, which keep
 * their old URLs.
 */

export const LAB_PATH = "/lab";

/** Pokémon Race (/pokedex/race) shows on /lab only while its page is live. */
export const RACE_LIVE = true;

export interface LabExperience {
  id: "timeline" | "sizes" | "globe" | "race";
  href: string;
  title: string;
  /** Small HUD label above the title. */
  kicker: string;
  /** The one-line pitch. */
  pitch: string;
  /** Short feature chips under the pitch. */
  tags: string[];
  /** Card art: a screenshot of the experience in /public, 16:9. Without it the card draws an animated preview. */
  image?: string;
  /** Accent colour, as an HSL triplet ("258 94% 74%"). */
  accent: string;
  live: boolean;
}

export const LAB_EXPERIENCES: LabExperience[] = [
  {
    id: "timeline",
    href: "/pokedex/timeline",
    title: "Pokémon Timeline",
    kicker: "History in 3D",
    pitch: "Fly through Pokémon history in a time tunnel, from Red and Green in 1996 to today: the games, the anime, the films and the card game.",
    tags: ["Guided tour", "Era transitions", "Japanese and Western dates"],
    image: "/lab/timeline.webp",
    accent: "258 94% 74%",
    live: true,
  },
  {
    id: "sizes",
    href: "/pokedex/sizes",
    title: "Pokémon Sizes",
    kicker: "Every Pokémon to scale",
    pitch: "Glide past every Pokémon at its real size in a 3D Lumiose City, then hit Make a video for a size comparison ready for TikTok, Reels and Shorts.",
    tags: ["Make a video", "Compare any Pokémon", "Lumiose City"],
    image: "/lab/sizes.webp",
    accent: "45 100% 64%",
    live: true,
  },
  {
    id: "globe",
    href: "/guessr/globe",
    title: "World Globe",
    kicker: "The Pokémon world",
    pitch: "Spin a holographic globe of the whole Pokémon world and zoom from its regions down to every town, route and landmark.",
    tags: ["Generation by generation", "Real screenshots", "From PokéGuessr"],
    image: "/lab/globe.webp",
    accent: "195 92% 64%",
    live: true,
  },
  {
    id: "race",
    href: "/pokedex/race",
    title: "Pokémon Race",
    kicker: "Who is fastest?",
    pitch: "Line Pokémon up in a 3D stadium at night and watch them sprint, with speeds from their base stats.",
    tags: ["Photo finish", "Pick your own race", "Make a video"],
    image: "/lab/race.webp",
    accent: "340 86% 60%",
    live: RACE_LIVE,
  },
];

/** The experiences that have a page to open. */
export const liveLabExperiences = () => LAB_EXPERIENCES.filter((e) => e.live);

/** /lab itself and every experience's pages (the nav's 3D Lab tab is active on all of them). */
export function isLabPath(pathname: string): boolean {
  return [LAB_PATH, ...LAB_EXPERIENCES.map((e) => e.href)].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
