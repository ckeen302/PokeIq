import { cell } from "./materials";
import type { Cell, Level, MatrixItem, NumberItem } from "./types";

/**
 * Twelve fixed anchor items, hand-written, so every run shares some common
 * ground with every other (and with the norms). The adaptive section draws
 * one anchor at its level whenever one is left; generated items fill the rest.
 */

function matrix(id: string, level: Level, rule: string, cells: Cell[], options: Cell[], answer: number): MatrixItem {
  return { kind: "matrix", id: `anchor:${id}`, level, timeMs: 60_000, rule, cells: [...cells.slice(0, 8), { k: "blank" }], options, answer };
}

function number(id: string, level: Level, rule: string, terms: number[], options: number[], answer: number): NumberItem {
  return { kind: "number", id: `anchor:${id}`, level, timeMs: 45_000, rule, terms, options, answer };
}

const PIKACHU = 25;
const CHARIZARD = 6;
const GYARADOS = 130;
const GENGAR = 94;
const SNORLAX = 143;
const LAPRAS = 131;

export const ANCHORS: readonly (MatrixItem | NumberItem)[] = [
  // Level 1 ------------------------------------------------------------------
  matrix(
    "a1",
    1,
    "count grows across each row",
    [
      cell.mon(PIKACHU, 0, 1, 1), cell.mon(PIKACHU, 0, 1, 2), cell.mon(PIKACHU, 0, 1, 3),
      cell.mon(CHARIZARD, 0, 1, 1), cell.mon(CHARIZARD, 0, 1, 2), cell.mon(CHARIZARD, 0, 1, 3),
      cell.mon(GYARADOS, 0, 1, 1), cell.mon(GYARADOS, 0, 1, 2), cell.mon(GYARADOS, 0, 1, 3),
    ],
    [cell.mon(GYARADOS, 0, 1, 2), cell.mon(GYARADOS, 0, 1, 3), cell.mon(CHARIZARD, 0, 1, 3), cell.mon(GYARADOS, 0, 1, 1), cell.mon(PIKACHU, 0, 1, 3), cell.mon(GYARADOS, 90, 1, 3)],
    1
  ),
  number("a2", 1, "+5", [3, 8, 13, 18], [21, 23, 24, 22, 28, 20], 1),
  // Level 2 ------------------------------------------------------------------
  matrix(
    "a3",
    2,
    "each type once per row and column",
    [
      cell.type("fire"), cell.type("water"), cell.type("grass"),
      cell.type("water"), cell.type("grass"), cell.type("fire"),
      cell.type("grass"), cell.type("fire"), cell.type("water"),
    ],
    [cell.type("grass"), cell.type("fire"), cell.type("water"), cell.type("water", 2), cell.type("electric"), cell.type("fire", 2)],
    2
  ),
  matrix(
    "a4",
    2,
    "a quarter turn clockwise per column",
    [
      cell.mon(GENGAR, 0), cell.mon(GENGAR, 90), cell.mon(GENGAR, 180),
      cell.mon(SNORLAX, 90), cell.mon(SNORLAX, 180), cell.mon(SNORLAX, 270),
      cell.mon(LAPRAS, 180), cell.mon(LAPRAS, 270), cell.mon(LAPRAS, 0),
    ],
    [cell.mon(LAPRAS, 270), cell.mon(LAPRAS, 180), cell.mon(LAPRAS, 0), cell.mon(LAPRAS, 90), cell.mon(SNORLAX, 0), cell.mon(LAPRAS, 0, 3)],
    2
  ),
  number("a5", 2, "×2", [3, 6, 12, 24], [36, 48, 30, 42, 50, 47], 1),
  // Level 3 ------------------------------------------------------------------
  matrix(
    "a6",
    3,
    "right column = OR of the other two",
    [
      cell.dots(0b000_000_111), cell.dots(0b100_100_100), cell.dots(0b100_100_111),
      cell.dots(0b010_010_010), cell.dots(0b000_111_000), cell.dots(0b010_111_010),
      cell.dots(0b101_000_000), cell.dots(0b000_000_101), cell.dots(0b101_000_101),
    ],
    [cell.dots(0b101_000_101), cell.dots(0b101_101_101), cell.dots(0b000_000_101), cell.dots(0b101_000_000), cell.dots(0b101_000_001), cell.dots(0b111_000_101)],
    0
  ),
  number("a7", 3, "squares", [4, 9, 16, 25], [36, 35, 30, 49, 34, 38], 0),
  matrix(
    "a8",
    3,
    "each ball once per row and column; count fixed per row",
    [
      cell.ball("poke", 1), cell.ball("great", 1), cell.ball("ultra", 1),
      cell.ball("great", 2), cell.ball("ultra", 2), cell.ball("poke", 2),
      cell.ball("ultra", 3), cell.ball("poke", 3), cell.ball("great", 3),
    ],
    [cell.ball("great", 2), cell.ball("great", 3), cell.ball("ultra", 3), cell.ball("poke", 3), cell.ball("great", 1), cell.ball("master", 3)],
    1
  ),
  // Level 4 ------------------------------------------------------------------
  matrix(
    "a9",
    4,
    "each type and each count once per row and column",
    [
      cell.type("psychic", 1), cell.type("ghost", 2), cell.type("dark", 3),
      cell.type("ghost", 3), cell.type("dark", 1), cell.type("psychic", 2),
      cell.type("dark", 2), cell.type("psychic", 3), cell.type("ghost", 1),
    ],
    [cell.type("ghost", 2), cell.type("psychic", 1), cell.type("ghost", 1), cell.type("dark", 1), cell.type("ghost", 3), cell.type("psychic", 3)],
    2
  ),
  number("a10", 4, "each term is the sum of the two before", [2, 5, 7, 12, 19], [31, 29, 26, 38, 33, 30], 0),
  // Level 5 ------------------------------------------------------------------
  matrix(
    "a11",
    5,
    "bottom row = XOR of the other two",
    [
      cell.dots(0b111_000_000), cell.dots(0b000_010_000), cell.dots(0b100_000_001),
      cell.dots(0b010_000_010), cell.dots(0b000_111_000), cell.dots(0b000_000_011),
      cell.dots(0b101_000_010), cell.dots(0b000_101_000), cell.dots(0b100_000_010),
    ],
    [cell.dots(0b100_000_010), cell.dots(0b100_000_011), cell.dots(0b100_000_000), cell.dots(0b000_000_010), cell.dots(0b100_000_001), cell.dots(0b000_000_011)],
    0
  ),
  number("a12", 5, "two sequences interleaved", [4, 10, 9, 20, 14, 30], [19, 40, 18, 20, 24, 35], 0),
];
