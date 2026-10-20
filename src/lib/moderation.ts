/** Moderation, shared by the server and the admin page. */

/** A mute "forever": the end of year 9999. */
export const PERMANENT = 253402300799000;

export const MUTE_DURATIONS = { "1h": 3_600_000, "24h": 86_400_000, "7d": 604_800_000, permanent: Infinity } as const;
export type MuteDuration = keyof typeof MUTE_DURATIONS;

export interface Sanction {
  userId: string;
  username: string;
  /** Muted until then (PERMANENT: for good); null: not muted. */
  mutedUntil: number | null;
  banned: boolean;
  banReason: string | null;
  updatedAt: number;
  updatedBy: string;
}

export interface AuditEntry {
  id: number;
  at: number;
  admin: string;
  action: string;
  target: string;
  detail: string | null;
}

export const FEEDBACK_CATEGORIES = ["idea", "bug", "other"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

/** What the feedback is about. */
export const FEEDBACK_MODES = {
  general: "The whole site",
  daily: "Daily challenge",
  quiz: "Quizzes",
  iqtest: "PokéIQ test",
  pokedle: "Pokédle",
  guessr: "PokéGuessr",
  pokedex: "Pokédex",
  battle: "Battles",
  tournaments: "Tournaments",
  rooms: "Chat rooms",
  friends: "Friends",
  accounts: "Accounts",
} as const;
export type FeedbackMode = keyof typeof FEEDBACK_MODES;

export type ReportKind = "error" | "feedback" | "chat";

export interface ReportRow {
  id: number;
  createdAt: number;
  kind: ReportKind;
  category: FeedbackCategory | null;
  mode: string | null;
  message: string;
  page: string | null;
  userAgent: string | null;
  contact: string | null;
  extra: Record<string, unknown> | null;
  reporter: string | null;
  resolvedAt: number | null;
  resolvedBy: string | null;
}
