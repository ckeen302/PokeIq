/**
 * Story bosses (scripts/nuzlocke/story-bosses.json): rivals, villain leaders, totems and the like, each placed in a
 * game's story order by an anchor and sourced from Bulbapedia. Merge rules:
 *  - `after: "<area id>"`: straight after that area's step, before any boss already there; entries with the same
 *    anchor keep the file's order.
 *  - `afterBoss: "<boss name>"`: straight after that boss, after any story bosses already anchored to it, in file
 *    order. The name must be a boss already in the steps.
 * A story boss never carries a badge (it doesn't change the game's badge count). Totems have no `kind`: they are the
 * gym equivalent.
 */
import fs from "node:fs";
import path from "node:path";
import type { NuzBoss, NuzStep } from "../../../src/lib/nuzlocke/model";

export interface StoryBoss {
  after?: string;
  afterBoss?: string;
  boss: NuzBoss;
  source: string;
}

export const STORY_FILE = path.resolve(__dirname, "../story-bosses.json");

export function storyBosses(): Record<string, StoryBoss[]> {
  if (!fs.existsSync(STORY_FILE)) return {};
  return JSON.parse(fs.readFileSync(STORY_FILE, "utf8")) as Record<string, StoryBoss[]>;
}

/** Problems with one game's entries against its steps: unknown anchors, missing sources, badges (by entry index). */
export function storyProblems(game: string, entries: StoryBoss[], steps: NuzStep[]): { i: number; msg: string }[] {
  const out: { i: number; msg: string }[] = [];
  const areaIds = new Set(steps.flatMap((s) => (s.type === "area" ? [s.area.id] : [])));
  const bossNames = new Set(steps.flatMap((s) => (s.type === "boss" ? [s.boss.name] : [])));
  entries.forEach((e, i) => {
    const at = `${game} story boss #${i + 1} ${e.boss?.name ?? "(no name)"}`;
    const bad = (msg: string) => out.push({ i, msg: `${at}: ${msg}` });
    if (!e.boss?.name?.trim()) bad("no name");
    if (!!e.after === !!e.afterBoss) bad("needs exactly one of after / afterBoss");
    if (e.after && !areaIds.has(e.after)) bad(`unknown area anchor ${e.after}`);
    if (e.afterBoss && !bossNames.has(e.afterBoss)) bad(`unknown boss anchor ${e.afterBoss}`);
    if (!/^https:\/\/bulbapedia\.bulbagarden\.net\/wiki\/\S+$/.test(e.source ?? "")) bad("no Bulbapedia source");
    if (e.boss?.badge !== undefined) bad("a story boss has a badge (it would change the badge count)");
    if (e.boss?.kind !== undefined && e.boss.kind !== "story") bad(`kind ${String(e.boss.kind)}`);
  });
  return out;
}

/** The steps with the game's story bosses merged in (entries with problems are left out and returned). */
export function mergeStoryBosses(game: string, steps: NuzStep[], entries: StoryBoss[]): { steps: NuzStep[]; placed: number; problems: string[] } {
  const problems = storyProblems(game, entries, steps);
  const skip = new Set(problems.map((p) => p.i));
  const out = [...steps];
  const anchorOf = new Map<NuzStep, string>();
  let placed = 0;
  entries.forEach((e, i) => {
    if (skip.has(i)) return;
    const step: NuzStep = { type: "boss", boss: { ...e.boss } };
    const key = e.after ? `area:${e.after}` : `boss:${e.afterBoss}`;
    // Straight after the anchor (before the bosses already there), after the story bosses anchored to it earlier.
    let at = (e.after ? out.findIndex((s) => s.type === "area" && s.area.id === e.after) : out.findIndex((s) => s.type === "boss" && s.boss.name === e.afterBoss)) + 1;
    while (at < out.length && anchorOf.get(out[at]) === key) at++;
    anchorOf.set(step, key);
    out.splice(at, 0, step);
    placed++;
  });
  return { steps: out, placed, problems: problems.map((p) => p.msg) };
}
