import type { PublicAvatar } from "./avatar";
/**
 * Chat rooms: the official rooms, shared by the server (which checks,
 * stores and delivers every message) and the pages.
 */

export interface RoomLink {
  label: string;
  href: string;
}

export interface RoomInfo {
  id: string;
  name: string;
  description: string;
  /** Room-specific rules, on top of the site-wide ones. */
  rules: string[];
  links: RoomLink[];
}

/** Every room: be kind, no links, no personal details. */
export const SITE_RULES = [
  "Be kind. No bullying, swearing or hate.",
  "Never share personal details: your real name, age, school, address, phone or socials.",
  "Links can't be posted. Talk about the game!",
  "Spot something wrong? Use the flag to report a message. Moderators read every report.",
];

export const ROOMS: RoomInfo[] = [
  {
    id: "lobby",
    name: "Main Lobby",
    description: "Say hi! The main room for everything PokéIQ. Stuck or new? Ask here and other trainers will help.",
    rules: ["Keep it friendly and on topic: Pokémon and PokéIQ.", "Beginners welcome: answer questions patiently, never make fun of one."],
    links: [
      { label: "All game modes", href: "/play" },
      { label: "Daily Challenge", href: "/daily" },
      { label: "Send feedback", href: "/feedback" },
    ],
  },
  {
    id: "pokedle",
    name: "Pokédle",
    description: "The daily Pokémon guessing game: share your score, not the answer.",
    rules: ["No spoilers: never post today's answer or big hints."],
    links: [{ label: "Play Pokédle", href: "/pokedle" }],
  },
  {
    id: "connections",
    name: "Connections",
    description: "Four hidden groups, sixteen Pokémon: share your grid and talk about the tricky ones.",
    rules: ["No spoilers: never post today's groups."],
    links: [{ label: "Play Connections", href: "/connections" }],
  },
  {
    id: "pikadoku",
    name: "Pikadoku",
    description: "Pokémon Sudoku: compare rare picks and brag about your rarity score.",
    rules: ["No spoilers: never post today's answers."],
    links: [{ label: "Play Pikadoku", href: "/pikadoku" }],
  },
  {
    id: "pokeguessr",
    name: "PokéGuessr",
    description: "Where in the Pokémon world was that? Share streaks and great guesses.",
    rules: ["No spoilers for today's rounds."],
    links: [
      { label: "Play PokéGuessr", href: "/guessr" },
      { label: "World atlas", href: "/atlas" },
    ],
  },
  {
    id: "battle",
    name: "Battle",
    description: "Random Battles, OU, Little Cup and every format: teams, sets, big plays and comebacks.",
    rules: ["No asking for or arranging wins: play every battle for real.", "Rate teams kindly: say what works, then what you'd change."],
    links: [
      { label: "Battle!", href: "/battle" },
      { label: "Team Builder", href: "/battle/teams" },
      { label: "Damage calc", href: "/battle/calc" },
      { label: "Tournaments", href: "/battle/tournaments" },
    ],
  },
  {
    id: "quizzes",
    name: "Quizzes",
    description: "Who's That Pokémon, Name 'em All and every quiz: share scores and challenge each other.",
    rules: ["No posting answers to a quiz someone is playing."],
    links: [
      { label: "All quizzes", href: "/play" },
      { label: "Name 'em All", href: "/quiz/name-em-all" },
    ],
  },
];

/** Rooms that were merged into another: old links go to the new room. */
export const ROOM_MOVED: Record<string, string> = {
  randombattles: "battle",
  overused: "battle",
  littlecup: "battle",
  help: "lobby",
  academy: "lobby",
};

export const ROOM_IDS = ROOMS.map((r) => r.id) as [string, ...string[]];
export const roomById = (id: string): RoomInfo | undefined => ROOMS.find((r) => r.id === id);

/** Messages a room keeps. */
export const ROOM_KEPT = 100;
/** Slow mode choices, in seconds (0: off). */
export const SLOW_MODES = [0, 5, 10, 30, 60, 120] as const;
/** Without Realtime, the page polls this often (never faster), and only while visible. */
export const ROOM_POLL_MS = 5_000;
/** The user list refreshes this often (it comes from presence, which beats once a minute). */
export const ROOM_USERS_MS = 60_000;

/** A message as anyone may see it (never the sender's account id). */
export interface RoomMessage {
  id: number;
  at: number;
  name: string;
  text: string;
  /** The sender's avatar. */
  avatar?: PublicAvatar;
}

export interface RoomState {
  available: boolean;
  room: string;
  messages: RoomMessage[];
  slow: number;
  /** Realtime delivery: where to subscribe, and the key that signs every broadcast. */
  realtime: { url: string; anon: string; key: JsonWebKey } | null;
}

/** What a room's channel carries: a new message, a deleted one, a cleared room, a changed slow mode. */
export type RoomEvent =
  | { type: "msg"; room: string; msg: RoomMessage }
  | { type: "del"; room: string; id: number }
  | { type: "clear"; room: string }
  | { type: "slow"; room: string; slow: number };

export const roomTopic = (room: string) => `room:${room}`;
