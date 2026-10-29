import { describe, expect, it } from "vitest";
import { createDuel, emoteDuel, joinDuel, leaveDuel, readyDuel, type Duel, type DuelOutcome } from "@/lib/server/duel";
import { DUEL_LEAD_MS } from "@/lib/duel-types";
import { isReaction } from "@/lib/pvp-types";
import { BALLS, checkTrainer, seededTrainer, unlockHint, unlocked } from "@/lib/trainer/config";
import { TAUNTS, TAUNT_GAP_MS, isTaunt, tauntBlocked, tauntFree } from "@/lib/trainer/taunts";
import { MOVES } from "@/components/trainer3d/moves";
import type { AvatarUnlocks } from "@/lib/avatar";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const NONE: AvatarUnlocks = { level: 1, tier: null, badges: 0 };
const ALL: AvatarUnlocks = { level: 99, tier: "master", badges: 99, wins: 999, streak: 99 };
const T0 = 1_800_000_000_000;

const must = (out: DuelOutcome): Duel => {
  if (!out.ok) throw new Error(out.error);
  return out.duel;
};

/** Red and Blue play; Blue leaves in round 1, so the duel is over. */
function finished() {
  const { duel, playerId: red } = createDuel("kanto", "Red", "abcdefgh", T0, "taunt-seed");
  const joined = joinDuel(duel, "Blue", T0 + 1000);
  if (!joined.ok) throw new Error(joined.error);
  const blue = joined.playerId;
  const t = T0 + 2000;
  const playing = must(readyDuel(must(readyDuel(joined.duel, red, true, t)), blue, true, t));
  const start = t + DUEL_LEAD_MS;
  return { playing, over: must(leaveDuel(playing, blue, start + 1000)), red, blue, at: start + 2000 };
}

describe("taunts", () => {
  it("has the dances and emotes, a few free and the rest earned", () => {
    const names = TAUNTS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["Heel Tap", "Fire Shot", "Swing Floss", "Dab", "Shuffle", "Robot", "Sprinkler", "Moonwalk", "Hype Jump"]));
    expect(names).toEqual(expect.arrayContaining(["Flex", "Ball Spin", "Too Easy", "Slow Clap", "Ball Toss", "GG Wave", "Facepalm", "Salute"]));
    expect(new Set(TAUNTS.map((t) => t.id)).size).toBe(TAUNTS.length);
    const free = TAUNTS.filter(tauntFree);
    expect(free.length).toBeGreaterThanOrEqual(3);
    expect(free.length).toBeLessThan(TAUNTS.length / 2);
    // Earned by play only: badges, ranked wins, streaks or tiers.
    for (const t of TAUNTS) expect(tauntFree(t) || unlockHint(t).length > 0).toBe(true);
  });

  it("are never mistaken for reactions, and reactions never for taunts", () => {
    for (const t of TAUNTS) {
      expect(isTaunt(t.id)).toBe(true);
      expect(isReaction({ n: 1, seat: 0, emote: t.id, at: 0 })).toBe(false);
    }
    expect(isTaunt("gg")).toBe(false);
    expect(isReaction({ n: 1, seat: 0, emote: "pika", at: 0 })).toBe(true);
  });

  it("lets guests use the free ones and checks the rest against what the account earned", () => {
    expect(tauntBlocked("dab", null)).toBeNull();
    expect(tauntBlocked("heeltap", null)).toMatch(/Sign in/);
    expect(tauntBlocked("heeltap", NONE)).toMatch(/Heel Tap is locked: reach Master Ball/);
    expect(tauntBlocked("heeltap", { ...NONE, tier: "master" })).toBeNull();
    expect(tauntBlocked("flex", { ...NONE, wins: 0 })).toMatch(/win 1 ranked game/);
    expect(tauntBlocked("flex", { ...NONE, wins: 1 })).toBeNull();
    expect(tauntBlocked("fireshot", { ...NONE, streak: 4 })).not.toBeNull();
    expect(tauntBlocked("fireshot", { ...NONE, streak: 5 })).toBeNull();
    expect(tauntBlocked("sprinkler", { ...NONE, badges: 3 })).toBeNull();
    expect(tauntBlocked("nope", ALL)).not.toBeNull();
    for (const t of TAUNTS) expect(tauntBlocked(t.id, ALL)).toBeNull();
  });

  it("each has a move that keeps every joint finite over its whole length", () => {
    for (const t of TAUNTS) {
      for (let s = 0; s <= t.secs; s += 0.05) {
        for (const [joint, v] of Object.entries(MOVES[t.id](s))) {
          if (!Number.isFinite(v)) throw new Error(`${t.id} ${joint} at ${s}: ${v}`);
        }
      }
    }
  });
});

describe("taunts in a duel", () => {
  it("only once the duel is over", () => {
    const { playing, red, at } = finished();
    const out = emoteDuel(playing, red, "dab", at);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.status).toBe(409);
    // Reactions still work during play.
    expect(emoteDuel(playing, red, "pika", at).ok).toBe(true);
  });

  it("both trainers, winner and loser, can taunt; one move every few seconds each", () => {
    const { over, red, blue, at } = finished();
    expect(over.status).toBe("finished");
    let d = must(emoteDuel(over, red, "dab", at));
    d = must(emoteDuel(d, blue, "ggwave", at + 100));
    // Red again too soon: the reaction gap passed, the taunt gap hasn't.
    const soon = emoteDuel(d, red, "robot", at + 2000);
    expect(!soon.ok && soon.status).toBe(429);
    expect(!soon.ok && soon.error).toMatch(/One move at a time/);
    d = must(emoteDuel(d, red, "robot", at + TAUNT_GAP_MS));
    expect(d.emotes?.filter((e) => isTaunt(e.emote)).map((e) => [e.seat, e.emote])).toEqual([
      [0, "dab"],
      [1, "ggwave"],
      [0, "robot"],
    ]);
  });

  it("holds a trainer to the burst limit", () => {
    const { over, red, at } = finished();
    let d = over;
    const sent: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      const out = emoteDuel(d, red, "salute", at + i * TAUNT_GAP_MS);
      sent.push(out.ok);
      if (out.ok) d = out.duel;
    }
    expect(sent).toEqual([true, true, true, false, true]);
  });
});

describe("Poké Balls", () => {
  it("has the ten new balls, each earned, and the server checks them", () => {
    const ids = BALLS.map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(["premier", "luxury", "dusk", "quick", "timer", "heal", "love", "safari", "beast", "cherish"]));
    for (const b of BALLS) {
      expect(b.top).toMatch(/^#[0-9a-f]{6}$/);
      expect(b.bottom).toMatch(/^#[0-9a-f]{6}$/);
      if (b.id !== "poke") expect(unlocked(b, NONE)).toBe(false);
      expect(unlocked(b, ALL)).toBe(true);
    }
    const t = { ...seededTrainer("Ash"), ball: "cherish" as const };
    const locked = checkTrainer(t, NONE);
    expect(locked.ok).toBe(false);
    expect(!locked.ok && locked.error).toMatch(/Cherish Ball is locked: win 6 ranked games in a row/);
    expect(checkTrainer(t, { ...NONE, streak: 6 }).ok).toBe(true);
    expect(checkTrainer({ ...t, ball: "quick" }, { ...NONE, wins: 3 }).ok).toBe(true);
    expect(checkTrainer({ ...t, ball: "beast" }, { ...NONE, tier: "ultra" }).ok).toBe(false);
    expect(checkTrainer({ ...t, ball: "beast" }, { ...NONE, tier: "ultra", wins: 5 }).ok).toBe(true);
    expect(checkTrainer({ ...t, ball: "nope" }, ALL).ok).toBe(false);
  });

  it("seeded trainers only get free items", () => {
    for (const name of ["Ash", "Misty", "Brock", "Dawn", "Iris"]) expect(seededTrainer(name).ball).toBe("poke");
  });
});
