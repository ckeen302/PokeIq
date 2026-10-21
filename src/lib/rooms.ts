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
    name: "Lobby",
    description: "Say hi! The main room for everything PokéIQ.",
    rules: ["Keep it friendly and on topic: Pokémon and PokéIQ."],
    links: [
      { label: "Battle!", href: "/battle" },
      { label: "Daily Challenge", href: "/daily" },
      { label: "Tournaments", href: "/battle/tournaments" },
    ],
  },
  {
    id: "randombattles",
    name: "Random Battles",
    description: "Six random Pokémon each: talk sets, lucky crits and big comebacks.",
    rules: ["No asking for or arranging wins: play every battle for real."],
    links: [
      { label: "Battle! (Random Battle)", href: "/battle?format=gen9randombattle" },
      { label: "Random Doubles", href: "/battle?format=gen9randomdoublesbattle" },
      { label: "Hourly tournament", href: "/battle/tournaments" },
    ],
  },
  {
    id: "overused",
    name: "OverUsed",
    description: "Gen 9 OU: teams, threats and the metagame.",
    rules: ["Rate teams kindly: say what works, then what you'd change."],
    links: [
      { label: "Battle! (OU)", href: "/battle?format=gen9ou" },
      { label: "Team Builder", href: "/battle/teams" },
      { label: "Damage calc", href: "/battle/calc" },
    ],
  },
  {
    id: "littlecup",
    name: "Little Cup",
    description: "Level 5 baby Pokémon battling it out. Small Pokémon, big plays.",
    rules: ["Little Cup only: first-stage Pokémon that can evolve."],
    links: [
      { label: "Custom rules battle", href: "/battle?format=custom" },
      { label: "Pokédex", href: "/pokedex" },
    ],
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
    id: "pokedle",
    name: "Pokédle",
    description: "The daily Pokémon guessing game: share your score, not the answer.",
    rules: ["No spoilers: never post today's answer or big hints."],
    links: [{ label: "Play Pokédle", href: "/pokedle" }],
  },
  {
    id: "help",
    name: "Help",
    description: "Stuck, or something not working? Ask here and other trainers can help.",
    rules: ["Found a bug? Send it with the feedback form so it reaches us."],
    links: [
      { label: "Send feedback", href: "/feedback" },
      { label: "All game modes", href: "/play" },
    ],
  },
  {
    id: "academy",
    name: "Trainer Academy",
    description: "New to battling? Ask anything: type matchups, team building, what moves do. No question is silly.",
    rules: ["Beginners welcome: answer questions patiently, never make fun of one."],
    links: [
      { label: "Type chart quiz", href: "/quiz/pokemon-type-quiz" },
      { label: "Study mode", href: "/pokedex/study" },
      { label: "Battle the computer", href: "/battle/play" },
    ],
  },
];

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
