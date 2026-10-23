import type { ConnLevel } from "./types";

/**
 * PokéConnections' puzzle creator, client-safe: the limits, the shapes the
 * API sends, and the link a published puzzle gets. The groups (the answers)
 * only exist server-side (src/lib/server/connections-custom.ts); nothing
 * here ever carries one to a player who isn't the creator.
 */

export const CUSTOM_ID_RE = /^[a-z0-9]{8}$/;
export const CUSTOM_GROUP_NAME_MAX = 32;
export const CUSTOM_TITLE_MAX = 40;
/** A community puzzle plays as a practice puzzle whose seed is "custom-<id>". */
export const CUSTOM_SEED_RE = /^custom-([a-z0-9]{8})$/;
export const customSeed = (id: string) => `custom-${id}`;
export const customPath = (id: string) => `/connections/c/${id}`;

/** One group as the creator builds it. */
export interface CustomGroupInput {
  name: string;
  level: ConnLevel;
  members: number[];
}

/** POST /api/connections/custom (create) and /check. */
export interface CustomInput {
  title?: string;
  groups: CustomGroupInput[];
  /** The trainer name to credit when not signed in (optional). */
  name?: string;
  /** The browser's random id, so votes and the creation limit follow the player. */
  player?: string;
}

/** POST /api/connections/custom/check: what blocks publishing, and what only deserves a second look. */
export interface CustomCheckResponse {
  errors: string[];
  warnings: string[];
}

/** A puzzle in a list: never its groups or tiles. */
export interface CustomSummary {
  id: string;
  title: string | null;
  creator: string | null;
  up: number;
  down: number;
  createdAt: string;
}

/** GET /api/connections/custom?sort=…: the community page. */
export interface CustomListResponse {
  available: boolean;
  /** The best-voted puzzle made this week. */
  featured: CustomSummary | null;
  top: CustomSummary[];
  newest: CustomSummary[];
}

/** GET /api/connections/custom/<id>: a puzzle's byline and votes (not its groups). */
export interface CustomMeta extends CustomSummary {
  /** This player's vote: 1, -1 or 0. */
  myVote: -1 | 0 | 1;
}

export const customScore = (s: Pick<CustomSummary, "up" | "down">) => s.up - s.down;
