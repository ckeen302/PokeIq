import { describe, expect, it } from "vitest";
import type { Athlete } from "@/lib/games/athlete";
import { GAMES_BY_KEY } from "@/lib/games/data";
import { EVENT_IDS } from "@/lib/games/events";
import { buildNations, runEvent, runGames } from "@/lib/games/games";
import { DEFAULT_NATIONS } from "@/lib/games/deeplink";
import RECORDS from "@/data/games-records.json";
import type { RecordsFile } from "@/lib/games/records";
import { eventShow } from "@/components/games/show/build";
import { gamesShow, gamesSummary } from "@/components/games/show/games";
import type { ShowFrame } from "@/components/games/show/types";

/**
 * The broadcasts are pure functions of the show clock: every event's show
 * (and the Games') must lay its beats end to end, give a finite camera and
 * finite poses at every moment, in a wide and a tall frame, and play the
 * same twice.
 */

const FIELD = ["pikachu", "snorlax", "machamp", "magikarp", "wailord", "regieleki", "gyarados", "shuckle"].map((k) => GAMES_BY_KEY.get(k)!);
const byKey = new Map<string, Athlete>(FIELD.map((a) => [a.key, a]));

function finite(f: ShowFrame, where: string) {
  const nums: number[] = [...f.pose.pos, ...f.pose.target, f.pose.fov, f.excitement, f.fade, f.flash, f.replay];
  for (const a of f.actors) {
    const p = a.pose;
    nums.push(p.x, p.y, p.z, p.dx, p.dz, p.lean, p.roll, p.squash, p.turn ?? 0, p.raise ?? 0, p.bend ?? 0, p.shake ?? 0, p.sway ?? 0);
    for (const l of [p.legs, p.arms, p.wings, p.tail]) if (l) nums.push(l.a, l.b, l.k, l.split ?? 0);
  }
  const pr = f.props;
  if (pr.kind === "throw") { if (pr.pos) nums.push(...pr.pos); nums.push(...pr.dir); }
  if (pr.kind === "lift") { if (pr.bar) nums.push(...pr.bar); nums.push(pr.bend, pr.whip, pr.tilt); }
  if (pr.kind === "swim") for (const w of pr.wakes) nums.push(w.x, w.z, w.v, w.len);
  if (pr.kind === "wrestle") nums.push(pr.ring);
  if (pr.kind === "hj") nums.push(pr.bar, pr.bounce, pr.spin, pr.fall);
  for (const b of f.bursts) nums.push(b.t0, b.x, b.y, b.z, b.size, b.power);
  for (const d of f.decals) nums.push(d.t0, d.x, d.y, d.z, d.w, d.l);
  const bad = nums.findIndex((n) => !Number.isFinite(n));
  expect(bad, `${where}: a non-finite number in the frame`).toBe(-1);
  expect(f.pose.fov, where).toBeGreaterThan(4);
  expect(f.pose.fov, where).toBeLessThan(90);
}

describe.each(EVENT_IDS)("the %s broadcast", (event) => {
  const field = event === "wrestling" ? FIELD.slice(0, 6) : FIELD;
  const out = runEvent(event, field, 7);
  const seq = eventShow(out, byKey, { budget: 72 });

  it("lays its beats end to end and finishes with the medal ceremony", () => {
    expect(seq.end).toBeGreaterThan(10);
    for (let i = 1; i < seq.beats.length; i++) expect(seq.beats[i].t0).toBeCloseTo(seq.beats[i - 1].t1, 6);
    expect(seq.beats[seq.beats.length - 1].kind).toBe("podium");
    expect(seq.hook.length).toBeGreaterThan(5);
  });

  it("gives a finite camera and finite poses at every moment, wide and tall", () => {
    for (let t = 0; t <= seq.end; t += 0.37) {
      finite(seq.at(t, 16 / 9), `${event} at ${t.toFixed(2)} s (16:9)`);
      finite(seq.at(t, 9 / 16), `${event} at ${t.toFixed(2)} s (9:16)`);
      expect(() => seq.overlay(t)).not.toThrow();
    }
  });

  it("plays the same twice", () => {
    const again = eventShow(runEvent(event, field, 7), byKey, { budget: 72 });
    expect(again.end).toBe(seq.end);
    for (const t of [1, seq.end * 0.3, seq.end * 0.6, seq.end - 0.5]) expect(JSON.stringify(again.at(t, 1.6).pose)).toBe(JSON.stringify(seq.at(t, 1.6).pose));
  });
});

describe("the Games", () => {
  const all = new Map<string, Athlete>([...GAMES_BY_KEY]);
  const ns = buildNations(DEFAULT_NATIONS.slice(0, 4), all, (RECORDS as unknown as RecordsFile).nations);
  const g = runGames(ns, 3);
  it("broadcasts every event in order and a summary video of them", () => {
    const parts = gamesShow(g, all, { budget: 34 }).parts;
    expect(parts.length).toBe(EVENT_IDS.length);
    for (const p of parts) for (const t of [0.5, p.end / 2, p.end - 0.2]) finite(p.at(t, 16 / 9), `${p.event} at ${t.toFixed(1)} s`);
    const summary = gamesSummary(g, all);
    expect(summary.length).toBe(EVENT_IDS.length);
    for (const p of summary) for (const t of [0.5, p.end / 2, p.end - 0.2]) finite(p.at(t, 9 / 16), `summary ${p.event} at ${t.toFixed(1)} s`);
  });
});
