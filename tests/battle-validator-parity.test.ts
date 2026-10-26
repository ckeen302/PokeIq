import { describe, expect, it } from "vitest";
import { Teams, TeamValidator } from "pokemon-showdown";
import { Dex as PkmnDex } from "@pkmn/dex";
import { BATTLE_FORMATS, type BattleFormatId } from "@/lib/battle/formats";
import { exportShowdown, importShowdown, packTeam, unpackTeam, type TeamSet } from "@/lib/battle/sets";
import { checkTeam, randomTeam } from "@/lib/server/battle";

/**
 * The team builder's verdict for every format must be Showdown's: each team
 * here (a legal one and a dozen broken variants) goes through our checker and
 * through a fresh Showdown TeamValidator reading the same team as exported
 * text, and the two must agree. Text and packed round-trips must match
 * Showdown's own Teams.import/export.
 */

const FORMATS = Object.keys(BATTLE_FORMATS) as BattleFormatId[];

const clone = (sets: TeamSet[]) => structuredClone(sets);

type Mutation = [string, (sets: TeamSet[]) => void];
const MUTATIONS: Mutation[] = [
  ["unchanged", () => {}],
  ["an unlearnable move", (s) => (s[0].moves[0] = "Spore")],
  ["a made-up move", (s) => (s[0].moves[1] = "Fake Move")],
  ["a repeated move", (s) => (s[0].moves[1] = s[0].moves[0])],
  ["too many EVs", (s) => (s[0].evs = { hp: 252, atk: 252, def: 252, spa: 252, spd: 252, spe: 252 })],
  ["an IV over 31", (s) => (s[1].ivs = { ...s[1].ivs, hp: 40 })],
  ["level 100", (s) => (s[0].level = 100)],
  ["level 5", (s) => (s[0].level = 5)],
  ["a duplicate species", (s) => (s[1] = { ...structuredClone(s[0]), item: s[1].item })],
  ["a duplicate item", (s) => (s[1].item = s[0].item || "Leftovers")],
  ["an Ubers Pokémon", (s) => (s[0] = { ...s[0], species: "Koraidon", name: "", ability: "Orichalcum Pulse", item: "Choice Scarf", moves: ["Collision Course", "Flare Blitz", "U-turn"], teraType: "Fire" })],
  ["a Mega Stone", (s) => (s[2] = { ...s[2], species: "Gengar", name: "", ability: "Cursed Body", item: "Gengarite", moves: ["Shadow Ball", "Sludge Bomb"] })],
  ["an ability it can't have", (s) => (s[0].ability = "Wonder Guard")],
  ["a Tera type", (s) => (s[0].teraType = "Fairy")],
  ["Baton Pass", (s) => (s[3] = { ...s[3], species: "Espeon", name: "", ability: "Magic Bounce", item: "Leftovers", moves: ["Baton Pass", "Psychic"] })],
  ["only one Pokémon", (s) => s.splice(1)],
  ["Moody", (s) => (s[4] = { ...s[4], species: "Glalie", name: "", ability: "Moody", moves: ["Ice Beam", "Protect"] })],
];

function showdownVerdict(format: BattleFormatId, sets: TeamSet[]): boolean {
  const imported = Teams.import(exportShowdown(sets)) ?? [];
  return TeamValidator.get(format).validateTeam(imported) === null;
}

describe("team validation matches Showdown's validator", () => {
  for (const format of FORMATS) {
    it(format, { timeout: 120_000 }, () => {
      const base = randomTeam(format);
      expect(base.length, `no legal random team for ${format}`).toBeGreaterThan(0);
      let legal = 0;
      for (const [label, mutate] of MUTATIONS) {
        const sets = clone(base);
        mutate(sets);
        const ours = checkTeam(format, sets).ok;
        expect(ours, `${format}: ${label}`).toBe(showdownVerdict(format, sets));
        if (ours) legal++;
      }
      // The unchanged team is legal; most broken ones aren't.
      expect(checkTeam(format, base).ok).toBe(true);
      expect(legal).toBeLessThan(MUTATIONS.length);
    });
  }
});

describe("Showdown text and packed formats round-trip like Showdown's own", () => {
  for (const format of FORMATS) {
    it(format, { timeout: 60_000 }, () => {
      const sets = randomTeam(format);
      const text = exportShowdown(sets);
      // Our export is byte-for-byte Showdown's.
      expect(text).toBe(Teams.export(structuredClone(sets) as never));
      // Import reads the text back to the same sets, and exports the same text again.
      const back = importShowdown(text)!.sets;
      expect(exportShowdown(back)).toBe(text);
      expect(back.map((s) => s.species)).toEqual((Teams.import(text) ?? []).map((s) => s.species));
      // Packed: the same string Showdown packs, and back again.
      expect(packTeam(sets)).toBe(Teams.pack(structuredClone(sets) as never));
      expect(exportShowdown(unpackTeam(packTeam(sets), PkmnDex)!)).toBe(text);
    });
  }
});
