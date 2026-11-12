import { describe, expect, it } from "vitest";
import { GAMES_BY_KEY } from "@/lib/games/data";
import { EVENT_IDS } from "@/lib/games/events";
import { runEvent } from "@/lib/games/games";
import { findMatchups, formatGap, h2hSummary } from "@/lib/games/h2h";
import { DEFAULT_GAMES_SEED } from "@/lib/games/seed";
import { h2hClip, replayCues } from "@/components/games/show/h2h";
import { eventShow } from "@/components/games/show/build";
import { gamesVideoPlan } from "@/components/games/record";

const A = (k: string) => GAMES_BY_KEY.get(k)!;

describe("head to head", () => {
  it("reads the result straight from the outcome", () => {
    const out = runEvent("weightlifting", [A("pikachu"), A("snorlax")], DEFAULT_GAMES_SEED);
    const s = h2hSummary(out, A("pikachu"), A("snorlax"));
    expect(s.sides.map((x) => x.key)).toEqual(["pikachu", "snorlax"]);
    expect(s.winner).toBe(out.podium.gold[0]);
    expect(s.sides.filter((x) => x.win)).toHaveLength(1);
    expect(s.line).toMatch(/wins/);
  });

  it("says how a bout ended", () => {
    const out = runEvent("wrestling", [A("machamp"), A("snorlax")], DEFAULT_GAMES_SEED);
    const s = h2hSummary(out, A("machamp"), A("snorlax"));
    expect(s.sides.find((x) => x.win)?.mark).toBe("Winner");
    expect(s.line).toMatch(/ring|bell/);
  });

  it("formats gaps in the event's unit", () => {
    expect(formatGap("100m", 0.081)).toBe("0.09 s");
    expect(formatGap("long-jump", 0.129)).toBe("12 cm");
    expect(formatGap("weightlifting", 12.4)).toBe("12 kg");
  });

  it("finds example match-ups from real runs, and each replays its result", () => {
    const pool = ["pikachu", "snorlax", "machamp", "magikarp", "onix", "squirtle", "garchomp", "eevee"].map(A);
    const ms = findMatchups(pool, DEFAULT_GAMES_SEED, { events: ["weightlifting", "50m-freestyle", "long-jump"], n: 3 });
    expect(ms.length).toBeGreaterThan(0);
    for (const m of ms) {
      const out = runEvent(m.event, [A(m.a), A(m.b)], DEFAULT_GAMES_SEED);
      expect(out.marks.get(m.a)).not.toBeNull();
      expect(out.marks.get(m.b)).not.toBeNull();
      expect(["close", "upset"]).toContain(m.why);
    }
  });

  it("cuts every event to a short clip (hook, the deciding stretch, the replay) without changing the outcome", () => {
    for (const ev of EVENT_IDS) {
      const out = runEvent(ev, [A("snorlax"), A("machamp")], 3);
      const before = JSON.stringify([out.standings, [...out.marks]]);
      const clip = h2hClip(out, GAMES_BY_KEY);
      const total = gamesVideoPlan([clip]).total;
      expect(total, ev).toBeGreaterThan(10);
      expect(total, ev).toBeLessThan(23);
      expect(JSON.stringify([out.standings, [...out.marks]])).toBe(before);
      if (ev !== "all-around") expect(clip.beats.some((b) => b.kind === "action"), ev).toBe(true);
    }
  });

  it("gives a slow-motion replay the sound of what it shows", () => {
    const out = runEvent("shot-put", [A("snorlax"), A("machamp")], 3);
    const main = eventShow(out, GAMES_BY_KEY, { budget: 16, video: true, podium: false }).parts[0].show;
    const replay = main.beats.find((b) => b.kind === "replay");
    const cues = replayCues(main);
    if (replay) {
      expect(cues.length).toBeGreaterThan(0);
      for (const c of cues) expect(c.t >= replay.t0 && c.t < replay.t1).toBe(true);
    }
  });
});
