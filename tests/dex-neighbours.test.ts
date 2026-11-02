import { describe, expect, it } from "vitest";
import { neighbours, notableOrder, pagerFor, placeLabel, tcgCardLabel, tcgCardOrder, tcgSetOrder, trainerAreaOrder } from "@/lib/dex/neighbours";
import { groupSetsBySeries } from "@/lib/tcg/prices";
import type { TcgCard, TcgSet } from "@/lib/tcg/types";
import fixture from "@/lib/tcg/fixture.json";
import { ABILITIES, ITEMS, MOVES } from "@/lib/dex/data";
import { PLACES } from "@/lib/dex/places-data";
import { TYPES } from "@/lib/pokemon/type-matrix";
import { TRAINER_GAMES } from "@/lib/trainers/games";
import { ROLE_ORDER } from "@/lib/trainers/notable";
import { gameAreas, gameFile, notableDirectory } from "@/lib/trainers/data";

const link = (s: string) => ({ href: `/x/${s}`, label: s.toUpperCase() });

describe("neighbours", () => {
  const list = ["a", "b", "c"];
  it("returns the items either side", () => {
    expect(neighbours(list, (x) => x === "b")).toEqual({ prev: "a", next: "c" });
  });
  it("has no link past either end", () => {
    expect(neighbours(list, (x) => x === "a")).toEqual({ prev: null, next: "b" });
    expect(neighbours(list, (x) => x === "c")).toEqual({ prev: "b", next: null });
    expect(neighbours(["solo"], (x) => x === "solo")).toEqual({ prev: null, next: null });
  });
  it("has no links for an item that isn't listed", () => {
    expect(neighbours(list, (x) => x === "z")).toEqual({ prev: null, next: null });
    expect(neighbours([], () => true)).toEqual({ prev: null, next: null });
  });
  it("maps neighbours to links", () => {
    expect(pagerFor(list, (x) => x === "b", link)).toEqual({ prev: { href: "/x/a", label: "A" }, next: { href: "/x/c", label: "C" } });
    expect(pagerFor(list, (x) => x === "a", link)).toEqual({ prev: null, next: { href: "/x/b", label: "B" } });
  });
});

describe("list orders match the Pokédex tabs", () => {
  // The Moves / Abilities / Items / Places tabs render these arrays as-is (DexListExplorer only filters).
  it("moves, abilities and items are alphabetical", () => {
    for (const list of [MOVES, ABILITIES, ITEMS]) {
      const names = list.map((x) => x.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    }
    const m = MOVES.findIndex((x) => x.slug === "thunderbolt");
    expect(pagerFor(MOVES, (x) => x.slug === "thunderbolt", (x) => ({ href: x.slug, label: x.name }))).toEqual({
      prev: { href: MOVES[m - 1].slug, label: MOVES[m - 1].name },
      next: { href: MOVES[m + 1].slug, label: MOVES[m + 1].name },
    });
  });

  it("places go region by region, then by name, naming the region at a boundary", () => {
    const i = PLACES.findIndex((p) => p.slug === "montenevera-gym-paldea");
    expect(i).toBeGreaterThan(0);
    const pager = pagerFor(PLACES, (p) => p.slug === "montenevera-gym-paldea", (p) => ({ href: p.slug, label: placeLabel(p, PLACES[i]) }));
    expect(pager.prev?.href).toBe(PLACES[i - 1].slug);
    expect(pager.next?.href).toBe(PLACES[i + 1].slug);
    // Last Kanto place → first place of the next region carries its region.
    const lastKanto = PLACES.findLastIndex((p) => p.region === "Kanto");
    const after = PLACES[lastKanto + 1];
    expect(placeLabel(after, PLACES[lastKanto])).toBe(`${after.name} · ${after.region}`);
    expect(placeLabel(PLACES[lastKanto - 1], PLACES[lastKanto])).toBe(PLACES[lastKanto - 1].name);
  });

  it("types follow the type chart", () => {
    expect(neighbours(TYPES, (t) => t === "normal")).toEqual({ prev: null, next: TYPES[1] });
    expect(neighbours(TYPES, (t) => t === "fairy").next).toBeNull();
  });

  it("TCG sets follow the TCG tab's series groups", () => {
    const sets = fixture.sets as unknown as TcgSet[];
    const order = tcgSetOrder(sets);
    expect(order.map((s) => s.id)).toEqual(groupSetsBySeries(sets).flatMap((g) => g.sets.map((s) => s.id)));
    expect(order[0].releaseDate! >= order.at(-1)!.releaseDate!).toBe(true);
    expect(order.at(-1)!.id).toBe("base1");
  });

  it("TCG cards go by number within their set (numerically, not as text)", () => {
    const base = (fixture.cards as unknown as TcgCard[]).filter((c) => c.set?.id === "base1");
    const order = tcgCardOrder(base);
    expect(order.slice(0, 3).map((c) => c.number)).toEqual(["1", "2", "3"]);
    const pager = pagerFor(order, (c) => c.id === "base1-1", (c) => ({ href: c.id, label: tcgCardLabel(c) }));
    expect(pager).toEqual({ prev: null, next: { href: "base1-2", label: "#2 Blastoise" } });
    expect(tcgCardOrder([{ number: "10" }, { number: "TG02" }, { number: "2" }, { number: "TG01" }]).map((c) => c.number)).toEqual(["2", "10", "TG01", "TG02"]);
    expect(tcgCardLabel({ name: "Mew", number: undefined })).toBe("Mew");
  });

  it("trainer areas follow the game page: every area page is in the order once", () => {
    for (const g of TRAINER_GAMES) {
      const order = trainerAreaOrder(gameAreas(g.key)).map((a) => a.slug);
      const f = gameFile(g.key)!;
      const used = new Set(f.teams.flatMap((t) => t.at.map((s) => s.a)));
      const pages = f.areas.filter((_, i) => used.has(i)).map((a) => a.slug);
      expect(new Set(order)).toEqual(new Set(pages));
      expect(order.length).toBe(new Set(order).size);
    }
  });

  it("notable trainers follow the Trainers tab: by role, then directory order", () => {
    const dir = notableDirectory();
    const order = notableOrder(dir, ROLE_ORDER);
    expect(order.length).toBe(dir.length);
    const roleRank = order.map((n) => ROLE_ORDER.indexOf(n.role));
    expect(roleRank).toEqual([...roleRank].sort((a, b) => a - b));
    expect(notableOrder([{ role: "b", n: 1 }, { role: "a", n: 2 }, { role: "b", n: 3 }], ["a", "b"]).map((x) => x.n)).toEqual([2, 1, 3]);
  });
});
