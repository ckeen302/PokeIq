/**
 * The events of the PokéIQ Games: real track and field, weightlifting,
 * swimming and wrestling events (never the Pokéathlon's), in the order the
 * Games run them. Client-safe.
 */

export const EVENT_IDS = ["100m", "long-jump", "shot-put", "weightlifting", "50m-freestyle", "wrestling", "200m", "high-jump", "javelin", "100m-freestyle", "400m", "all-around"] as const;
export type EventId = (typeof EVENT_IDS)[number];
export const isEventId = (s: string): s is EventId => (EVENT_IDS as readonly string[]).includes(s);

export type Venue = "stadium" | "arena" | "pool";
export type EventKind = "sprint" | "jump" | "throw" | "lift" | "swim" | "wrestle" | "combined";

export interface GameEvent {
  id: EventId;
  name: string;
  /** "100 m", "Long jump"… in a sentence ("the long jump"). */
  lower: string;
  kind: EventKind;
  venue: Venue;
  /** What the mark is: a time (lower wins), a distance or height or weight (higher wins), points, or a bout. */
  unit: "s" | "m" | "kg" | "pts" | "bout";
  better: "lower" | "higher";
  /** The question its records page answers. */
  question: string;
  /** The video's hook card. */
  hook: string;
  /** Stats the event reads (shown on the lower-thirds). */
  stats: ("hp" | "atk" | "def" | "spe" | "kg" | "height")[];
  emoji: string;
}

export const EVENTS: GameEvent[] = [
  { id: "100m", name: "100 m", lower: "the 100 m", kind: "sprint", venue: "stadium", unit: "s", better: "lower", question: "Who is the fastest Pokémon over 100 m?", hook: "Who's the fastest Pokémon? 100 m ⚡", stats: ["spe", "atk", "kg"], emoji: "⚡" },
  { id: "200m", name: "200 m", lower: "the 200 m", kind: "sprint", venue: "stadium", unit: "s", better: "lower", question: "Who is the fastest Pokémon round the bend, over 200 m?", hook: "Who wins the 200 m? 🏃", stats: ["spe", "atk", "hp"], emoji: "🏃" },
  { id: "400m", name: "400 m", lower: "the 400 m", kind: "sprint", venue: "stadium", unit: "s", better: "lower", question: "Which Pokémon runs the fastest lap?", hook: "Which Pokémon runs the fastest lap? 🏁", stats: ["spe", "hp", "atk"], emoji: "🏁" },
  { id: "long-jump", name: "Long jump", lower: "the long jump", kind: "jump", venue: "stadium", unit: "m", better: "higher", question: "Who is the best long jumper of all Pokémon?", hook: "Which Pokémon jumps the furthest? 🦘", stats: ["spe", "atk", "kg", "height"], emoji: "🦘" },
  { id: "high-jump", name: "High jump", lower: "the high jump", kind: "jump", venue: "stadium", unit: "m", better: "higher", question: "Which Pokémon jumps the highest?", hook: "Which Pokémon jumps the highest? 🪂", stats: ["atk", "kg", "height"], emoji: "⬆️" },
  { id: "shot-put", name: "Shot put", lower: "the shot put", kind: "throw", venue: "stadium", unit: "m", better: "higher", question: "Which Pokémon throws a 7.26 kg shot the furthest?", hook: "Which Pokémon throws the furthest? 💪", stats: ["atk", "def", "kg"], emoji: "💪" },
  { id: "javelin", name: "Javelin", lower: "the javelin", kind: "throw", venue: "stadium", unit: "m", better: "higher", question: "Which Pokémon throws the javelin the furthest?", hook: "Who throws the javelin furthest? 🎯", stats: ["atk", "spe", "kg"], emoji: "🎯" },
  { id: "weightlifting", name: "Weightlifting", lower: "the weightlifting", kind: "lift", venue: "arena", unit: "kg", better: "higher", question: "Who's the strongest Pokémon? The clean & jerk", hook: "Who's the strongest Pokémon? 🏋️", stats: ["atk", "def", "kg"], emoji: "🏋️" },
  { id: "50m-freestyle", name: "50 m freestyle", lower: "the 50 m freestyle", kind: "swim", venue: "pool", unit: "s", better: "lower", question: "Which Pokémon is the fastest swimmer over 50 m?", hook: "Which Pokémon swims fastest? 🌊", stats: ["spe", "atk", "kg"], emoji: "🌊" },
  { id: "100m-freestyle", name: "100 m freestyle", lower: "the 100 m freestyle", kind: "swim", venue: "pool", unit: "s", better: "lower", question: "Which Pokémon wins the 100 m freestyle?", hook: "Which Pokémon wins the 100 m freestyle? 🏊", stats: ["spe", "atk", "hp"], emoji: "🏊" },
  { id: "wrestling", name: "Wrestling", lower: "the wrestling", kind: "wrestle", venue: "arena", unit: "bout", better: "higher", question: "Which Pokémon is the hardest to push out of the ring?", hook: "Which Pokémon can push the others out? 🤼", stats: ["atk", "def", "kg"], emoji: "🤼" },
  { id: "all-around", name: "All-around", lower: "the all-around", kind: "combined", venue: "stadium", unit: "pts", better: "higher", question: "Who is the best all-round athlete of all Pokémon?", hook: "Who's the best all-round Pokémon? 🏆", stats: ["spe", "atk", "def", "hp"], emoji: "🏆" },
];

export const EVENT_BY_ID = new Map(EVENTS.map((e) => [e.id, e])) as ReadonlyMap<EventId, GameEvent>;
export const eventOf = (id: EventId): GameEvent => EVENT_BY_ID.get(id)!;

/** The events scored in the all-around (every event with a mark; wrestling is head to head). */
export const MARK_EVENTS = ["100m", "200m", "400m", "long-jump", "high-jump", "shot-put", "javelin", "weightlifting", "50m-freestyle", "100m-freestyle"] as const satisfies readonly EventId[];
export type MarkEvent = (typeof MARK_EVENTS)[number];

/** "9.58", "1:02.37" (times rounded up, as the stadium clock reads them). */
export function formatSeconds(s: number, dp = 2): string {
  if (!Number.isFinite(s)) return "—";
  const k = 10 ** dp;
  const up = Math.ceil(s * k - 1e-7) / k;
  const m = Math.floor(up / 60);
  const rest = up - m * 60;
  return m > 0 ? `${m}:${rest.toFixed(dp).padStart(dp + 3, "0")}` : rest.toFixed(dp);
}

/** Distances and heights are measured to the centimetre below (World Athletics TR 25.19). */
export const floorCm = (m: number) => Math.floor(m * 100 + 1e-7) / 100;

/** A mark as it's read out: "9.81 s", "8.42 m", "212 kg", "8,123 pts". */
export function formatMark(id: EventId, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const e = eventOf(id);
  if (e.unit === "s") return `${formatSeconds(v)} s`;
  if (e.unit === "m") return `${floorCm(v).toFixed(2)} m`;
  if (e.unit === "kg") return `${Math.floor(v + 1e-7).toLocaleString("en-US")} kg`;
  if (e.unit === "pts") return `${Math.floor(v).toLocaleString("en-US")} pts`;
  return String(v);
}
