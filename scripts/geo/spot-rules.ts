/**
 * PokéGuessr exact spots: the rules every scored spot must pass, whichever
 * matcher or fit found it. A spot is scored only when a player can aim at it
 * on our world map, so:
 *
 * - its place must be drawn on our atlas with its walkable layout
 *   (scripts/geo/spot-places.json, decided per place by looking at the atlas:
 *   a route's own path or sea line, an island strip, a lake). Towns and
 *   cities are blocks; caves, forests, towers, buildings and interiors are
 *   icons; parks, open sea and the like are not drawn. None of them get a
 *   scored spot, and a place missing from the file counts as not drawn;
 * - its rip must not be one floor or room of a place (a floor map);
 * - it must have been looked at on our atlas (scripts/geo/spot-audit.json:
 *   "ok" with the rip it was placed from, or "unscored" with the reason).
 *   A spot no one has checked against our drawing stays area-scored.
 *
 * The pipeline (scripts/geo/spots-2d.ts) applies these after every run, and
 * tests/geo-spot-rules.test.ts fails if a scored spot breaks one.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export interface PlaceRule {
  drawn: boolean;
  /** path | sea | island | lake (drawn); town | icon | undrawn (not). */
  kind: string;
  why: string;
  /** What the atlas shows there (own path and sea line lengths, mask size). */
  atlas?: string;
}

/**
 * A spot looked at on our atlas: "ok" keeps the spot it was checked at (world
 * map 0–1) and the rip it was placed from; "unscored" says why not.
 */
export type AuditEntry = { verdict: "ok"; at: [number, number]; rip: string; note: string } | { verdict: "unscored"; reason: string; rip?: string };

/** World map size (src/data/geo.json's world.map), for how far a spot moved since it was checked. */
const WORLD: [number, number] = [5850, 2565];

/** A rip of one floor, basement, room or chamber of a place (not a whole-area map). */
export const FLOOR_RIP = /(?:^|[_ |(-])(?:B?\d{1,2}F|[BUH]F|Basement|Floors?|Rooms?|Chambers?|Interior|Inside|Rooftop|Lobby)(?=[_ .)-]|$)/i;

export function loadPlaceRules(root = process.cwd()): Record<string, PlaceRule> {
  return JSON.parse(readFileSync(path.join(root, "scripts/geo/spot-places.json"), "utf8")) as Record<string, PlaceRule>;
}

export function loadAudit(root = process.cwd()): Record<string, AuditEntry> {
  return JSON.parse(readFileSync(path.join(root, "scripts/geo/spot-audit.json"), "utf8")) as Record<string, AuditEntry>;
}

export const isFloorRip = (rip: string) => FLOOR_RIP.test(rip.split("|").pop()!.replace(/\.[a-z]+$/i, ""));

/**
 * Why the spot `at` (world map 0–1) of shot `id` at `region|name`, placed from
 * `rip`, can't be scored (null: it can).
 */
export function spotRuleViolation(places: Record<string, PlaceRule>, audit: Record<string, AuditEntry>, id: string, region: string, name: string, at: [number, number], rip?: string): string | null {
  const place = places[`${region}|${name}`];
  if (!place) return `${name}: not in spot-places.json (a place counts as drawn only once it's been checked on the atlas)`;
  if (!place.drawn) return `${name} is not drawn on our map (${place.kind}: ${place.why})`;
  if (rip && isFloorRip(rip)) return `placed on a floor map (${rip})`;
  const a = audit[id];
  if (!a) return "not checked against our atlas yet (scripts/geo/spot-audit.json)";
  if (a.verdict === "unscored") return `audit: ${a.reason}`;
  if (isFloorRip(a.rip)) return `placed on a floor map (${a.rip})`;
  const moved = Math.hypot((at[0] - a.at[0]) * WORLD[0], (at[1] - a.at[1]) * WORLD[1]);
  if (moved > 0.5) return `moved ${moved.toFixed(1)}px since it was checked on our atlas`;
  return null;
}
