import { describe, expect, it } from "vitest";
import snapshot from "./fixtures/pokeapi-dle.json";
import pool from "@/data/pokedle-pool.json";
import { BABY_IDS, compare, dleStage, traitsOf } from "@/lib/server/pokedle";
import { getPokemon, POKEDEX } from "@/lib/pokemon/pokedex";
import { DLE_COLUMNS } from "@/lib/dle-types";
import { DLE_EXAMPLE_MONS } from "@/components/pokedle/examples";
import type { DleTraits } from "@/lib/dle-compare";

/**
 * Every clue Pokédle can show, for every Pokémon, against an independent
 * PokéAPI snapshot (tests/fixtures/pokeapi-dle.json, from PokéAPI's CSV dumps
 * by scripts/pokedle-pokeapi-snapshot.ts; the app's own data comes from its
 * GraphQL API by scripts/ingest-pokedex.ts).
 */

type Fact = [gen: number, types: string[], height: number, weight: number, color: string, evolvesFrom: number | null, baby: 0 | 1];
const FACTS = snapshot.species as unknown as Record<string, Fact>;
const fact = (id: number) => FACTS[String(id)];

/** Pokédle's stage from the snapshot alone: a baby is 0, else 1 + the non-baby Pokémon it evolves from. */
function expectedStage(id: number): number {
  if (fact(id)[6]) return 0;
  let stage = 1;
  for (let from = fact(id)[5]; from !== null; from = fact(from)[5]) if (!fact(from)[6]) stage++;
  return stage;
}

function expectedTraits(id: number): DleTraits {
  const [gen, types, height, weight, color] = fact(id);
  return { gen, type1: types[0], type2: types[1] ?? null, height, weight, color, stage: expectedStage(id) };
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

describe("Pokédle's clues match PokéAPI", () => {
  it("covers exactly the species in the Pokédex", () => {
    expect(Object.keys(FACTS).map(Number).sort((a, b) => a - b)).toEqual(POKEDEX.map((p) => p.id).sort((a, b) => a - b));
  });

  it("has every Pokémon's generation, types, height, weight, colour and stage right", () => {
    const wrong: string[] = [];
    for (const p of POKEDEX) {
      const want = expectedTraits(p.id);
      const got = traitsOf(p);
      for (const key of Object.keys(want) as (keyof DleTraits)[]) {
        if (got[key] !== want[key]) wrong.push(`${p.name} ${key}: ${got[key]}, PokéAPI ${want[key]}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("knows exactly PokéAPI's baby Pokémon", () => {
    const babies = Object.entries(FACTS).filter(([, f]) => f[6]).map(([id]) => Number(id));
    expect([...BABY_IDS].sort((a, b) => a - b)).toEqual(babies);
  });

  it("writes every clue on the board as PokéAPI has it", () => {
    for (const p of POKEDEX) {
      const [gen, types, height, weight, color] = fact(p.id);
      const { cells, solved } = compare(p, p);
      expect(solved).toBe(true);
      expect(cells).toEqual({
        gen: { value: String(gen), status: "match" },
        type1: { value: cap(types[0]), status: "match" },
        type2: { value: types[1] ? cap(types[1]) : "None", status: "match" },
        height: { value: `${(height / 10).toFixed(1)} m`, status: "match" },
        weight: { value: `${(weight / 10).toFixed(1)} kg`, status: "match" },
        color: { value: cap(color), status: "match" },
        stage: { value: expectedStage(p.id) === 0 ? "Baby" : String(expectedStage(p.id)), status: "match" },
      });
    }
    expect(DLE_COLUMNS).toHaveLength(7);
  });

  it("only deals species (no alternate forms) in the daily pool, each with every clue defined", () => {
    for (const id of pool.tiers.flat()) {
      expect(fact(id), `pool Pokémon ${id}`).toBeDefined();
      const t = traitsOf(getPokemon(id)!);
      expect(t.color).not.toBe("unknown");
      expect(t.height).toBeGreaterThan(0);
      expect(t.weight).toBeGreaterThan(0);
      expect(dleStage(getPokemon(id)!)).toBeLessThanOrEqual(3);
    }
  });

  it("teaches the how-to with the real values", () => {
    for (const m of Object.values(DLE_EXAMPLE_MONS)) {
      expect(m.name).toBe(getPokemon(m.id)!.name);
      expect(m.t).toEqual(expectedTraits(m.id));
    }
  });
});
