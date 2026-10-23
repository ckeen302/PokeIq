import type { TournamentMatchNote } from "./tournaments";
import type { PublicAvatar } from "./avatar";
/**
 * Friends, presence and challenges: what the browser and the server share.
 *
 * Presence is a slow heartbeat (one request a minute while a tab is
 * visible, none while it's hidden); a trainer counts as online until their
 * last heartbeat is PRESENCE_TTL_MS old. Everything about a trainer beyond
 * their public profile (online status, what they're playing, their dailies)
 * is shown to their accepted friends only.
 */

export const PRESENCE_BEAT_MS = 60_000;
/** Two and a half beats: one late or lost heartbeat doesn't flicker a friend offline. */
export const PRESENCE_TTL_MS = 150_000;
/** A visible tab coming back (or a new page) beats at most this often on top of the minute. */
export const PRESENCE_MIN_GAP_MS = 20_000;

/** A challenge waits this long for an answer. */
export const CHALLENGE_TTL_MS = 10 * 60_000;
export const MAX_FRIENDS = 200;
export const MAX_PENDING_OUT = 50;
export const MAX_CHALLENGES_OUT = 5;

/** What a page says the trainer is doing (the server picks the words). */
export const ACTIVITY_KINDS = ["browsing", "battle", "watching", "teams", "pokedle", "guessr", "quiz", "daily", "iqtest", "pokedex", "duel", "room"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  browsing: "Online",
  battle: "In a battle",
  watching: "Watching a battle",
  teams: "Building a team",
  pokedle: "Playing Pokédle",
  guessr: "Playing PokéGuessr",
  quiz: "Playing a quiz",
  daily: "Playing the Daily Challenge",
  iqtest: "Taking the PokéIQ test",
  pokedex: "Browsing the Pokédex",
  duel: "In a duel",
  room: "In a chat room",
};

export const activityLabel = (kind: ActivityKind) => ACTIVITY_LABEL[kind];

/** The activity a page reports, from its path (a battle page adds its code). */
export function activityFromPath(pathname: string): { kind: ActivityKind; code?: string; room?: string } {
  const room = /^\/rooms\/([a-z]{2,20})$/.exec(pathname);
  if (room) return { kind: "room", room: room[1] };
  const battle = /^\/battle\/(?:live|play)\/([a-z2-9]{8})/.exec(pathname);
  if (battle) return { kind: "battle", code: battle[1] };
  if (/^\/(?:pokedle|quiz|guessr|connections|pikadoku)\/duel\//.test(pathname)) return { kind: "duel" };
  if (pathname.startsWith("/battle/watch") || pathname.startsWith("/battle/replay")) return { kind: "watching" };
  if (pathname.startsWith("/battle/teams")) return { kind: "teams" };
  if (pathname.startsWith("/pokedle")) return { kind: "pokedle" };
  if (pathname.startsWith("/guessr") || pathname.startsWith("/atlas")) return { kind: "guessr" };
  if (pathname.startsWith("/quiz") || pathname.startsWith("/play")) return { kind: "quiz" };
  if (pathname.startsWith("/daily")) return { kind: "daily" };
  if (pathname.startsWith("/iq-test")) return { kind: "iqtest" };
  if (pathname.startsWith("/pokedex") || pathname.startsWith("/pokemon")) return { kind: "pokedex" };
  return { kind: "browsing" };
}

/** What a friend is doing, as their friends see it. `watch`: their public battle's code, one click to spectate. */
export interface FriendActivity {
  kind: ActivityKind;
  label: string;
  watch?: string;
  /** In a chat room: which (its user list comes from presence). */
  room?: string;
}

export interface FriendDaily {
  /** The Daily Challenge: the latest day played. */
  daily?: { date: string; correct: number; total: number; streak: number };
  /** The daily Pokédle: the latest day played. */
  dle?: { date: string; solved: boolean; guesses: number; streak: number };
}

export interface FriendView {
  username: string;
  avatar?: PublicAvatar;
  online: boolean;
  activity: FriendActivity | null;
  daily: FriendDaily | null;
  since: number;
}

export interface FriendRequestView {
  username: string;
  avatar?: PublicAvatar;
  at: number;
}

export interface FriendsResponse {
  /** False until the server has friends (the migration), or for guests. */
  available: boolean;
  signedIn: boolean;
  friends: FriendView[];
  incoming: FriendRequestView[];
  outgoing: FriendRequestView[];
  blocked: string[];
  appearOffline: boolean;
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

export const CHALLENGE_KINDS = ["battle", "pokedle", "quiz", "guessr", "connections", "pikadoku"] as const;
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];

/** Where a challenge is played: the existing invite page of each game. */
export function challengeHref(kind: ChallengeKind, code: string): string {
  if (kind === "connections") return `/connections/duel/${code}`;
  if (kind === "pikadoku") return `/pikadoku/duel/${code}`;
  return kind === "battle" ? `/battle/live/${code}` : kind === "pokedle" ? `/pokedle/duel/${code}` : kind === "quiz" ? `/quiz/duel/${code}` : `/guessr/duel/${code}`;
}

/** A challenge waiting for this trainer's answer. */
export interface ChallengeView {
  id: string;
  from: string;
  /** The challenger's avatar. */
  avatar?: PublicAvatar;
  kind: ChallengeKind;
  label: string;
  href: string;
  expiresAt: number;
}

/** A challenge this trainer sent that the friend answered. */
export interface ChallengeAnswer {
  id: string;
  to: string;
  /** The friend's avatar. */
  avatar?: PublicAvatar;
  label: string;
  status: "accepted" | "declined";
}

export interface HeartbeatResponse {
  available: boolean;
  /** Friend requests waiting for an answer. */
  requests: number;
  challenges: ChallengeView[];
  answers: ChallengeAnswer[];
  /** Tournament matches waiting for this trainer ("Your match is ready"). */
  matches?: TournamentMatchNote[];
}

/** After a battle or duel: whether the opponent was signed in, and where you stand with them. */
export type MetRelation = "none" | "friends" | "sent" | "received" | "blocked";
export interface MetResponse {
  available: boolean;
  /** The opponent is signed in to an account (and isn't you). */
  account: boolean;
  relation?: MetRelation;
}

/** The live counters on the battle home. */
export interface LiveCounts {
  online: number;
  battles: number;
}

/** A user search: a prefix of a valid account name, at least two characters. */
export const USER_QUERY_RE = /^[A-Za-z0-9_-]{2,20}$/;

/** A user search hit. */
export interface UserHit {
  username: string;
}
