import { describe, expect, it } from "vitest";
import {
  HEARTBEAT_MS,
  backoff,
  battleHiddenDelay,
  battlePollDelay,
  duelHiddenDelay,
  duelPollDelay,
  fingerprint,
  untilNext,
  type DuelPace,
} from "@/lib/polling";
import type { BattleView } from "@/lib/battle/play";

const NOW = 1_800_000_000_000;

const duel = (over: Partial<DuelPace>): DuelPace => ({ rev: 1, now: NOW, status: "playing", you: 0, players: [{}, {}], ...over });

describe("polling pace", () => {
  it("backs off by half each quiet poll, up to a cap", () => {
    expect([0, 1, 2, 3, 4].map((n) => backoff(2000, 5000, n))).toEqual([2000, 3000, 4500, 5000, 5000]);
  });

  it("lands a poll just after the next deadline, never sooner than 250 ms", () => {
    expect(untilNext(2000, NOW, [NOW + 700])).toBe(760);
    expect(untilNext(2000, NOW, [NOW + 5000])).toBe(2000);
    expect(untilNext(2000, NOW, [NOW - 100, null, undefined])).toBe(2000);
    expect(untilNext(1000, NOW, [NOW + 10])).toBe(250);
  });

  it("ignores the clock and revision when telling whether a poll found anything", () => {
    expect(fingerprint({ rev: 1, now: 5, status: "lobby" })).toBe(fingerprint({ rev: 9, now: 77, status: "lobby" }));
    expect(fingerprint({ rev: 1, now: 5, status: "lobby" })).not.toBe(fingerprint({ rev: 1, now: 5, status: "playing" }));
  });

  describe("duels", () => {
    it("polls every second while a round is being played", () => {
      const round = { startsAt: NOW - 5000, endsAt: NOW + 60_000 };
      expect(duelPollDelay(duel({ round }), 3, NOW)).toBe(1000);
      expect(duelPollDelay(duel({ question: round }), 3, NOW)).toBe(1000);
    });

    it("polls every 2 s around a round, and right after the next one starts", () => {
      expect(duelPollDelay(duel({ next: { at: NOW + 9000 } }), 0, NOW)).toBe(2000);
      expect(duelPollDelay(duel({ round: { startsAt: NOW + 1200, endsAt: NOW + 91_200 } }), 0, NOW)).toBe(1260);
      expect(duelPollDelay(duel({ next: { at: NOW + 400 } }), 0, NOW)).toBe(460);
      expect(duelPollDelay(duel({}), 0, NOW, NOW + 300)).toBe(360);
    });

    it("slows a lobby waiting for a challenger, but not one with both trainers", () => {
      expect(duelPollDelay(duel({ status: "lobby", players: [{}] }), 0, NOW)).toBe(2000);
      expect(duelPollDelay(duel({ status: "lobby", players: [{}] }), 5, NOW)).toBe(5000);
      expect(duelPollDelay(duel({ status: "lobby", players: [{}, {}] }), 5, NOW)).toBe(2000);
    });

    it("slows after the end, and stops ten minutes on", () => {
      const end = { at: NOW - 60_000 };
      expect(duelPollDelay(duel({ status: "finished", end }), 0, NOW)).toBe(4000);
      expect(duelPollDelay(duel({ status: "finished", end }), 10, NOW)).toBe(15_000);
      expect(duelPollDelay(duel({ status: "finished", end: { at: NOW - 11 * 60_000 } }), 0, NOW)).toBeNull();
    });

    it("keeps a seated trainer's hidden tab alive, and lets everyone else's sleep", () => {
      expect(duelHiddenDelay(duel({ status: "lobby" }))).toBe(HEARTBEAT_MS);
      expect(duelHiddenDelay(duel({}))).toBe(HEARTBEAT_MS);
      expect(duelHiddenDelay(duel({ status: "finished" }))).toBeNull();
      expect(duelHiddenDelay(duel({ you: null }))).toBeNull();
      expect(duelHiddenDelay(null)).toBeNull();
      // The server counts a trainer as away after 10 s, and gone after 30 s.
      expect(HEARTBEAT_MS).toBeLessThan(10_000);
    });
  });

  describe("battles", () => {
    const battle = (over: Partial<BattleView>): BattleView =>
      ({ kind: "pvp", status: "playing", you: 0, players: [{}, {}], request: null, waiting: false, now: NOW, rev: 1, ...over }) as BattleView;
    const request = { rqid: 1, data: {} } as BattleView["request"];

    it("polls every second while waiting on the opponent, every 2 s while it's your move", () => {
      expect(battlePollDelay(battle({ request, waiting: true }), 0, NOW)).toBe(1000);
      expect(battlePollDelay(battle({ request: null }), 0, NOW)).toBe(1000);
      expect(battlePollDelay(battle({ request }), 0, NOW)).toBe(2000);
    });

    it("polls right after a clock runs out", () => {
      const clocks = { you: { bank: 1000, deadline: null }, foe: { bank: 5000, deadline: NOW + 900 } };
      expect(battlePollDelay(battle({ request, clocks }), 0, NOW)).toBe(960);
    });

    it("only checks on a battle against the computer now and then", () => {
      expect(battlePollDelay(battle({ kind: "cpu" }), 0, NOW)).toBe(5000);
      expect(battlePollDelay(battle({ kind: "cpu", status: "finished" }), 0, NOW)).toBeNull();
      expect(battleHiddenDelay(battle({ kind: "cpu" }))).toBeNull();
    });

    it("keeps a seated player's hidden tab alive in a live battle", () => {
      expect(battleHiddenDelay(battle({}))).toBe(HEARTBEAT_MS);
      expect(battleHiddenDelay(battle({ status: "lobby" }))).toBe(HEARTBEAT_MS);
      expect(battleHiddenDelay(battle({ status: "finished" }))).toBeNull();
      expect(battleHiddenDelay(battle({ you: null }))).toBeNull();
    });
  });
});
