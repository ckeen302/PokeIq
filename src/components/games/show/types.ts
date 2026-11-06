import type { CamPose, Vec3 } from "@/lib/race/director";
import type { Race } from "@/lib/race/race";
import type { Athlete } from "@/lib/games/athlete";
import type { EventId, Venue } from "@/lib/games/events";
import type { ActorPose } from "../scene/pose";

/**
 * A show: one event (or the medal ceremony, or the Games' closing) as a
 * broadcast on its own clock. Pure (no three.js): the page asks for the
 * frame at a show time, the scene draws it, the overlay paints its
 * graphics, and the recorder does the same frame by frame. Every moving
 * thing is a function of the show time, so replays, seeks and videos are
 * exact.
 */

export type SoundKind = "gun" | "recall" | "beep" | "thud" | "sand" | "clank" | "splash" | "dive" | "cheer" | "groan" | "ooh" | "applause" | "buzzer" | "whoosh" | "impact" | "roar" | "fanfare" | "anthem" | "whistle" | "stomp" | "chalk";

export interface Cue {
  t: number;
  kind: SoundKind;
  gain: number;
}

/** A burst of particles, born once at t0 (the scene spawns it the first time it sees it). */
export interface Burst {
  id: string;
  t0: number;
  kind: "sand" | "dust" | "splash" | "spray" | "chalk" | "turf" | "confetti" | "clay";
  x: number;
  y: number;
  z: number;
  /** Size of what made it (m) and how hard (0..1+). */
  size: number;
  power: number;
  /** Direction it's thrown (unit, ground plane). */
  dx?: number;
  dz?: number;
  /** Show seconds per second of its life (below 1 in a slow-motion replay). */
  rate?: number;
}

/** A mark on the ground that appears at t0. */
export interface Decal {
  id: string;
  t0: number;
  kind: "sand" | "divot" | "scuff";
  x: number;
  y: number;
  z: number;
  w: number;
  l: number;
  angle: number;
}

export type Props =
  | { kind: "none" }
  | { kind: "lj"; pitFar: number; flag: number; foul: boolean; tape: number | null; leader: number | null }
  | { kind: "hj"; bar: number; bounce: number; spin: number; fall: number; side: number; dent: [number, number, number, number] }
  | { kind: "throw"; implement: "shot" | "javelin"; tape: number | null; leader: number | null; pos: Vec3 | null; dir: Vec3; trail: Vec3[]; stuck: number }
  | { kind: "lift"; bar: Vec3 | null; weight: number; bend: number; whip: number; lights: ("white" | "red" | null)[]; tilt: number }
  | { kind: "swim"; rain: boolean; wakes: { x: number; z: number; v: number; len: number; dir: number }[]; board: boolean }
  | { kind: "wrestle"; ring: number }
  | { kind: "podium"; at: Vec3; scale: number; medals: { medal: 1 | 2 | 3; t0: number; pos: Vec3; size: number }[] };

export interface ShowFrame {
  t: number;
  venue: Venue;
  pose: CamPose;
  /** What the beat is (the overlay reads it). */
  beat: Beat;
  /** 0..1 through the beat. */
  k: number;
  /** Sprints: the Race's clock and start state (the scene runs the Race's runners). */
  race?: { t: number; pre: "idle" | "marks" | "set" | "race"; focus?: number; /** 1: the recalled start of a false start. */ index?: number };
  actors: { key: string; pose: ActorPose }[];
  props: Props;
  bursts: Burst[];
  decals: Decal[];
  /** 0 calm … 1 roaring. */
  excitement: number;
  /** 0..1: the slow-motion replay's grade. */
  replay: number;
  /** Depth of field (high quality): a point to focus on and how strongly (0 off). */
  dof?: { focus: Vec3; k: number };
  /** A dip to black (0..1) and a white flash (0..1). */
  fade: number;
  flash: number;
  /** The stadium clock and the big screens' camera. */
  clock: string;
  screen: CamPose | null;
}

export interface Beat {
  kind: "establish" | "startlist" | "intro" | "action" | "replay" | "result" | "board" | "podium" | "photo" | "card";
  t0: number;
  t1: number;
  cam: string;
  /** For action and replay beats: which action, its clock at t0, and its rate (below 1: slow motion). */
  act?: number;
  clock0?: number;
  rate?: number;
  /** Athlete in focus. */
  key?: string;
  /** Words for the overlay. */
  title?: string;
  sub?: string;
}

/** What the overlay draws (the page and the video share it). */
export interface Overlay {
  /** The event's corner bug: its name, the round or the bar. */
  bug?: { title: string; sub: string };
  /** The opening title card. */
  title?: { text: string; sub: string; k: number };
  /** A lower third: the athlete, a line of stats, a tag (its attempt). */
  lower?: { key: string; name: string; line: string; tag?: string; k: number };
  /** A big mark: "8.21 m", "FOUL", "NEW LEAD". */
  mark?: { text: string; sub?: string; tone: "good" | "bad" | "lead" | "plain"; k: number };
  /** A results board. */
  board?: { title: string; rows: { place: string; name: string; mark: string; key: string; hi?: boolean; note?: string; /** No medal colours (a lane, a draw). */ plain?: boolean }[]; k: number };
  /** The replay bug. */
  replay?: boolean;
  /** Name tags over these athletes, and what a tag says instead of the name ("1 · 21.32"). */
  tags?: string[];
  tagText?: Record<string, string>;
  /** A caption under everything (commentary: "Wailord's centre of mass is already 4 m up"). */
  caption?: string;
}

export interface Show {
  event: EventId;
  venue: Venue;
  /** Everyone the show draws (loaded before it starts). */
  athletes: Athlete[];
  beats: Beat[];
  cues: Cue[];
  end: number;
  /** Sprints: the race the Race's runners draw (and the recalled one of a false start). */
  race?: Race;
  falseRace?: Race | null;
  /** The frame at show time t for a frame of this aspect (width/height). */
  at(t: number, aspect: number): ShowFrame;
  overlay(t: number): Overlay;
  /** The video's hook and the result line under it ("Barraskewda wins in 16.12 s"). */
  hook: string;
  headline: string;
  /** The finish, for "skip to the results". */
  resultsAt: number;
}

export function beatAt(beats: Beat[], t: number): Beat {
  for (const b of beats) if (t < b.t1) return b;
  return beats[beats.length - 1];
}

export const beatK = (b: Beat, t: number) => Math.max(0, Math.min(1, (t - b.t0) / Math.max(1e-6, b.t1 - b.t0)));
export const beatClock = (b: Beat, t: number) => (b.clock0 ?? 0) + (Math.min(t, b.t1) - b.t0) * (b.rate ?? 1);

/** Lays beats end to end from t (returns the new t). */
export class Timeline {
  beats: Beat[] = [];
  cues: Cue[] = [];
  t = 0;
  add(b: Omit<Beat, "t0" | "t1">, dur: number): Beat {
    const beat = { ...b, t0: this.t, t1: this.t + dur } as Beat;
    this.beats.push(beat);
    this.t += dur;
    return beat;
  }
  cue(t: number, kind: SoundKind, gain = 1) {
    this.cues.push({ t, kind, gain });
  }
}

export const NO_PROPS: Props = { kind: "none" };
