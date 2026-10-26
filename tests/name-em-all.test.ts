import { describe, expect, it } from "vitest";
import pokedex from "@/data/pokedex.json";
import forms from "@/data/about-forms.json";
import details from "@/data/pokedex-details.json";
import { NEA_CATEGORIES, NEA_DAILY_POOL, NEA_DEXES, NEA_TYPES, neaCategory, neaDailyCategory, standardMinutes } from "@/lib/name-em-all/categories";
import { PARADOX_IDS, RESTRICTED_LEGENDARY_IDS, ULTRA_BEAST_IDS, neaCounts, neaOutsiders, neaTargets } from "@/lib/name-em-all/targets";
import { buildMatcher, closestName, couldGrow, editDistance, matchName, normalizeName } from "@/lib/name-em-all/match";
import { neaClock, neaShareText } from "@/lib/name-em-all/share";
import { checkRun, clearMemoryNea, memoryNeaStore, neaElapsed, neaStartToken, readClaim, signClaim } from "@/lib/server/name-em-all-board";
import { advanceRace, createRace, joinRace, nameInRace, raceView, readyRace, startRace } from "@/lib/server/name-em-all-race";
import { parseScope } from "@/lib/server/name-em-all";

const DEX = pokedex as { id: number; name: string; gen: number; types: string[]; legendary: boolean; mythical: boolean }[];
const FORMS = forms as [number, number, string, string, string][];
const DETAILS = details as unknown as Record<string, { dexNumbers: { dex: string; number: number }[] }>;
const names = (id: string) => neaTargets(id)!.map((t) => t.name);

describe("Name 'em All: target lists match the Pokédex data", () => {
  it("has every category, and each is non-empty with unique slots", () => {
    for (const c of NEA_CATEGORIES) {
      const list = neaTargets(c.id)!;
      expect(list.length, c.id).toBeGreaterThan(0);
      expect(new Set(list.map((t) => t.id)).size, c.id).toBe(list.length);
    }
    expect(neaTargets("hisui-dex")).toBeNull();
    // No Hisui-only or Legends: Z-A-only categories.
    expect(NEA_CATEGORIES.some((c) => /hisui|z-a|lumiose/i.test(c.id + c.label))).toBe(false);
  });

  it("All is the 1,025 species in national order", () => {
    const all = neaTargets("all")!;
    expect(all).toHaveLength(1025);
    expect(all.length).toBe(DEX.length);
    all.forEach((t, i) => expect(t.num).toBe(i + 1));
    expect(all[0].name).toBe("Bulbasaur");
    expect(all[1024].name).toBe("Pecharunt");
  });

  it("each generation holds exactly that generation's species", () => {
    const expected = [151, 100, 135, 107, 156, 72, 88, 96, 120];
    let sum = 0;
    for (let g = 1; g <= 9; g++) {
      const list = neaTargets(`gen-${g}`)!;
      expect(list.length).toBe(DEX.filter((p) => p.gen === g).length);
      expect(list.length).toBe(expected[g - 1]);
      expect(list.every((t) => t.gen === g)).toBe(true);
      sum += list.length;
    }
    expect(sum).toBe(1025);
  });

  it("each of the 18 types holds every species with that type", () => {
    expect(NEA_TYPES).toHaveLength(18);
    for (const type of NEA_TYPES) {
      const want = DEX.filter((p) => p.types.includes(type)).map((p) => p.id);
      expect(neaTargets(`type-${type}`)!.map((t) => t.species), type).toEqual(want);
    }
    // Dual types count once per type: the sum is the number of type slots in the data.
    const slots = NEA_TYPES.reduce((n, t) => n + neaTargets(`type-${t}`)!.length, 0);
    expect(slots).toBe(DEX.reduce((n, p) => n + p.types.length, 0));
  });

  it("special categories follow the data's flags and the vetted lists", () => {
    expect(neaTargets("legendary")!.length).toBe(DEX.filter((p) => p.legendary).length);
    expect(neaTargets("legendary")!.length).toBe(71);
    expect(neaTargets("mythical")!.length).toBe(DEX.filter((p) => p.mythical).length);
    expect(neaTargets("mythical")!.length).toBe(23);
    // Every headline Legendary is a Legendary in the data; the sub-legendaries are the rest.
    for (const id of RESTRICTED_LEGENDARY_IDS) expect(DEX.find((p) => p.id === id)!.legendary).toBe(true);
    expect(neaTargets("sub-legendary")!.length).toBe(71 - RESTRICTED_LEGENDARY_IDS.length);
    expect(names("sub-legendary")).toEqual(expect.arrayContaining(["Articuno", "Tapu Koko", "Type: Null", "Chi-Yu", "Ogerpon", "Kubfu"]));
    expect(names("sub-legendary")).not.toContain("Mewtwo");
    expect(neaTargets("ultra-beasts")!.length).toBe(ULTRA_BEAST_IDS.length);
    expect(names("ultra-beasts")).toEqual(["Nihilego", "Buzzwole", "Pheromosa", "Xurkitree", "Celesteela", "Kartana", "Guzzlord", "Poipole", "Naganadel", "Stakataka", "Blacephalon"]);
    expect(neaTargets("paradox")!.length).toBe(PARADOX_IDS.length);
    expect(names("paradox")).toEqual(expect.arrayContaining(["Great Tusk", "Iron Valiant", "Walking Wake", "Iron Crown", "Gouging Fire"]));
    // Paradox and Ultra Beasts aren't Legendary in the data.
    expect(DEX.filter((p) => PARADOX_IDS.includes(p.id) || ULTRA_BEAST_IDS.includes(p.id)).every((p) => !p.legendary && !p.mythical)).toBe(true);
  });

  it("form categories hold the data's Megas, Gigantamax and regional forms", () => {
    for (const [cat, kind, n] of [["mega-evolutions", "mega", 48], ["gigantamax", "gmax", 34], ["regional-forms", "regional", 58]] as const) {
      const list = neaTargets(cat)!;
      const want = FORMS.filter((r) => r[4] === kind);
      expect(list.length, cat).toBe(want.length);
      expect(list.length, cat).toBe(n);
      expect(new Set(list.map((t) => t.id))).toEqual(new Set(want.map((r) => r[0])));
      expect(list.every((t) => t.form?.kind === kind)).toBe(true);
    }
  });

  it("regional dexes match the data's regional numbers", () => {
    for (const dex of NEA_DEXES) {
      const list = neaTargets(dex.id)!;
      const ids = new Set(Object.values(DETAILS).length ? Object.entries(DETAILS).filter(([, d]) => d.dexNumbers.some((n) => dex.sources.includes(n.dex))).map(([id]) => Number(id)) : []);
      expect(list.length, dex.id).toBe(ids.size);
      expect(new Set(list.map((t) => t.species))).toEqual(ids);
      // Numbered in the game's order, never repeating.
      for (let i = 1; i < list.length; i++) expect(list[i].num).toBeGreaterThan(list[i - 1].num);
    }
    expect(neaTargets("kanto-dex")!.length).toBe(151);
    expect(neaTargets("paldea-dex")!.length).toBe(400);
    expect(neaTargets("galar-dex")!.length).toBe(400);
    expect(neaTargets("unova-dex")![0]).toMatchObject({ num: 0, name: "Victini" });
  });

  it("counts and outsiders line up", () => {
    const counts = neaCounts();
    expect(counts.all).toBe(1025);
    expect(neaOutsiders("gen-1")).toHaveLength(1025 - 151);
    expect(neaOutsiders("gen-1")).toContain("Chikorita");
    expect(neaOutsiders("mega-evolutions")).toEqual([]);
    expect(neaOutsiders("all")).toEqual([]);
  });
});

describe("Name 'em All: matching", () => {
  it("normalizes case, accents, spaces, punctuation and gender symbols", () => {
    expect(normalizeName("Mr. Mime")).toBe("mrmime");
    expect(normalizeName("Flabébé")).toBe("flabebe");
    expect(normalizeName("Type: Null")).toBe("typenull");
    expect(normalizeName("Nidoran♀")).toBe("nidoranf");
    expect(normalizeName("Farfetch’d")).toBe("farfetchd");
    expect(normalizeName("  HO-OH ")).toBe("hooh");
  });

  it("every accepted spelling in every category resolves to exactly one slot, and every slot has its full name", () => {
    for (const c of NEA_CATEGORIES) {
      const list = neaTargets(c.id)!;
      const m = buildMatcher(list);
      const claimed = new Map<string, number>();
      m.bySlot.forEach((keys, slot) => {
        expect(keys.length, `${c.id}: ${list[slot].name}`).toBeGreaterThan(0);
        expect(keys[0], `${c.id}: ${list[slot].name}`).toBe(normalizeName(list[slot].name));
        for (const k of keys) {
          expect(claimed.has(k), `${c.id}: "${k}" claimed twice`).toBe(false);
          claimed.set(k, slot);
          expect(m.keys.get(k)).toBe(slot);
        }
      });
      expect(claimed.size).toBe(m.keys.size);
      for (const k of m.dropped) expect(m.keys.has(k)).toBe(false);
    }
  });

  it("no species name is ambiguous in All (each species name names exactly that species)", () => {
    const all = neaTargets("all")!;
    const m = buildMatcher(all);
    all.forEach((t, slot) => expect(matchName(m, t.name)).toBe(slot));
    expect(m.dropped).toEqual([]);
  });

  const allM = buildMatcher(neaTargets("all")!);
  const nameOf = (input: string) => {
    const slot = matchName(allM, input);
    return slot === undefined ? undefined : neaTargets("all")![slot].name;
  };

  it.each([
    ["Mr. Mime", "Mr. Mime"],
    ["mr mime", "Mr. Mime"],
    ["mrmime", "Mr. Mime"],
    ["MR.MIME", "Mr. Mime"],
    ["mime jr", "Mime Jr."],
    ["mr rime", "Mr. Rime"],
    ["nidoran f", "Nidoran♀"],
    ["nidoranf", "Nidoran♀"],
    ["Nidoran female", "Nidoran♀"],
    ["nidoran m", "Nidoran♂"],
    ["nidoranm", "Nidoran♂"],
    ["Nidoran♂", "Nidoran♂"],
    ["farfetchd", "Farfetch’d"],
    ["Farfetch'd", "Farfetch’d"],
    ["sirfetch'd", "Sirfetch’d"],
    ["type null", "Type: Null"],
    ["typenull", "Type: Null"],
    ["flabebe", "Flabébé"],
    ["Flabébé", "Flabébé"],
    ["porygon-z", "Porygon-Z"],
    ["porygonz", "Porygon-Z"],
    ["porygon2", "Porygon2"],
    ["ho oh", "Ho-Oh"],
    ["hooh", "Ho-Oh"],
    ["jangmo-o", "Jangmo-o"],
    ["jangmoo", "Jangmo-o"],
    ["hakamo o", "Hakamo-o"],
    ["kommoo", "Kommo-o"],
    ["tapu koko", "Tapu Koko"],
    ["TapuLele", "Tapu Lele"],
    ["chien pao", "Chien-Pao"],
    ["iron valiant", "Iron Valiant"],
  ])("%s names %s", (input, want) => {
    expect(nameOf(input)).toBe(want);
  });

  it("does not name anything for a bare Nidoran or a near miss", () => {
    expect(nameOf("nidoran")).toBeUndefined();
    expect(nameOf("pikachuu")).toBeUndefined();
    expect(nameOf("")).toBeUndefined();
  });

  const formName = (cat: string, input: string) => {
    const list = neaTargets(cat)!;
    const slot = matchName(buildMatcher(list), input);
    return slot === undefined ? undefined : list[slot].name;
  };

  it("names forms the ways people write them", () => {
    expect(formName("mega-evolutions", "Mega Venusaur")).toBe("Mega Venusaur");
    expect(formName("mega-evolutions", "venusaur mega")).toBe("Mega Venusaur");
    expect(formName("mega-evolutions", "venusaur")).toBe("Mega Venusaur");
    expect(formName("mega-evolutions", "mega charizard x")).toBe("Mega Charizard X");
    expect(formName("mega-evolutions", "charizard y")).toBe("Mega Charizard Y");
    expect(formName("mega-evolutions", "charizard")).toBeUndefined();
    expect(formName("mega-evolutions", "mega charizard")).toBeUndefined();
    expect(formName("gigantamax", "gmax snorlax")).toBe("Gigantamax Snorlax");
    expect(formName("gigantamax", "Gigantamax Snorlax")).toBe("Gigantamax Snorlax");
    expect(formName("gigantamax", "snorlax")).toBe("Gigantamax Snorlax");
    expect(formName("gigantamax", "gmax toxtricity")).toBe("Gigantamax Amped Toxtricity");
    expect(formName("gigantamax", "gmax toxtricity low key")).toBe("Gigantamax Low Key Toxtricity");
    expect(formName("gigantamax", "rapid strike urshifu")).toBe("Gigantamax Rapid Strike Urshifu");
    expect(formName("regional-forms", "alolan vulpix")).toBe("Alolan Vulpix");
    expect(formName("regional-forms", "vulpix alola")).toBe("Alolan Vulpix");
    expect(formName("regional-forms", "galarian mr. mime")).toBe("Galarian Mr. Mime");
    expect(formName("regional-forms", "galarian farfetchd")).toBe("Galarian Farfetch'd");
    expect(formName("regional-forms", "meowth")).toBeUndefined();
    expect(formName("regional-forms", "galarian meowth")).toBe("Galarian Meowth");
    expect(formName("regional-forms", "paldean tauros")).toBe("Paldean Tauros (Combat Breed)");
    expect(formName("regional-forms", "paldean tauros aqua breed")).toBe("Paldean Tauros (Aqua Breed)");
    expect(formName("regional-forms", "tauros blaze")).toBe("Paldean Tauros (Blaze Breed)");
    expect(formName("regional-forms", "galarian darmanitan")).toBe("Standard Galarian Darmanitan");
    expect(formName("regional-forms", "zen galarian darmanitan")).toBe("Zen Galarian Darmanitan");
    expect(formName("regional-forms", "hisuian zorua")).toBe("Hisuian Zorua");
  });

  it("keeps typing alive when a name is the start of another, and suggests close spellings", () => {
    const list = neaTargets("gen-1")!;
    const m = buildMatcher(list);
    const open = () => true;
    expect(couldGrow(m, "mew", open)).toBe(true); // Mewtwo
    expect(couldGrow(m, "kabuto", open)).toBe(true); // Kabutops
    expect(couldGrow(m, "pikachu", open)).toBe(false);
    expect(list[closestName(m, "pikachoo", open)!].name).toBe("Pikachu");
    expect(list[closestName(m, "charmandr", open)!].name).toBe("Charmander");
    expect(closestName(m, "pika", open)).toBeUndefined(); // still typing
    expect(closestName(m, "zzzzzzzz", open)).toBeUndefined();
    expect(editDistance("abcd", "abdc")).toBe(1);
    expect(editDistance("kitten", "sitting")).toBe(3);
  });
});

describe("Name 'em All: the daily, timers and sharing", () => {
  it("deals the daily from the pool, the same for a date, without repeats inside a cycle", () => {
    expect(neaDailyCategory("2026-10-26")).toBe(neaDailyCategory("2026-10-26"));
    const seen = new Set<string>();
    const start = Date.parse("2026-01-01T00:00:00Z");
    for (let d = 0; d < NEA_DAILY_POOL.length; d++) seen.add(neaDailyCategory(new Date(start + d * 86_400_000).toISOString().slice(0, 10)));
    expect(seen.size).toBe(NEA_DAILY_POOL.length);
    for (const id of seen) expect(neaCategory(id)).toBeDefined();
    expect(NEA_DAILY_POOL).not.toContain("all");
  });

  it("gives every category a sensible standard time", () => {
    expect(standardMinutes(151)).toBe(13);
    expect(standardMinutes(11)).toBe(2);
    expect(standardMinutes(1025)).toBe(60);
  });

  it("writes the share card", () => {
    expect(neaClock(372_000)).toBe("6:12");
    expect(neaClock(3_723_000)).toBe("1:02:03");
    expect(neaShareText({ label: "Gen 1", named: 151, total: 151, ms: 372_000, mode: "regular" })).toBe("Name 'em All · Gen 1 · 151/151 in 6:12 🏆");
    expect(neaShareText({ label: "Fire", named: 40, total: 85, ms: 60_000, mode: "chaos", url: "https://x.test/q" })).toBe("Name 'em All · Fire · Chaos · 40/85 in 1:00\nhttps://x.test/q");
  });
});

describe("Name 'em All: server checks", () => {
  it("ranks a fair run and refuses paused, edited or superhuman ones", () => {
    const named = [0, 1, 2];
    const ok = checkRun({ total: 3, limitMs: 120_000, named, times: [2000, 4000, 130_000], ms: 130_000, wallMs: 131_000 });
    expect(ok).toEqual({ ok: true, clear: 130_000, count: { named: 2, ms: 4000 } });
    expect(checkRun({ total: 3, limitMs: 120_000, named, times: [2000, 4000, 6000], ms: 6000, wallMs: 200_000 })).toMatchObject({ ok: false, reason: expect.stringMatching(/Paused/) });
    expect(checkRun({ total: 3, limitMs: 120_000, named, times: [10, 20, 30], ms: 30, wallMs: 40 })).toMatchObject({ ok: false, reason: expect.stringMatching(/faster/) });
    expect(checkRun({ total: 3, limitMs: 120_000, named: [0, 0, 1], times: [2000, 4000, 6000], ms: 6000, wallMs: 6000 })).toMatchObject({ ok: false });
    expect(checkRun({ total: 3, limitMs: 120_000, named: [0, 5], times: [2000, 4000], ms: 6000, wallMs: 6000 })).toMatchObject({ ok: false });
    expect(checkRun({ total: 3, limitMs: 120_000, named: [0, 1], times: [4000, 2000], ms: 6000, wallMs: 6000 })).toMatchObject({ ok: false });
    expect(checkRun({ total: 3, limitMs: 120_000, named: [0, 1], times: [2000, 4000], ms: 60_000, wallMs: 30_000 })).toMatchObject({ ok: false });
    expect(checkRun({ total: 3, limitMs: 120_000, named: [], times: [], ms: 5000, wallMs: 5000 })).toEqual({ ok: true, clear: null, count: null });
  });

  it("signs start times and claims for one scope and player", () => {
    const k = "k".repeat(20);
    const t = neaStartToken("gen-1", k, 1_000);
    expect(neaElapsed(t, "gen-1", k, 61_000)).toBe(60_000);
    expect(neaElapsed(t, "gen-2", k, 61_000)).toBeNull();
    expect(neaElapsed(t, "gen-1", "j".repeat(20), 61_000)).toBeNull();
    expect(neaElapsed(`${t}x`, "gen-1", k, 61_000)).toBeNull();
    const c = signClaim({ s: "gen-1", k, daily: false, total: 151, clear: null, count: { named: 3, ms: 1 }, t: 1_000 });
    expect(readClaim(c, 2_000)?.count?.named).toBe(3);
    expect(readClaim(c, 1_000 + 61 * 60_000)).toBeNull();
  });

  it("keeps each trainer's best (the first for the daily) and sorts the board", async () => {
    clearMemoryNea();
    const s = memoryNeaStore();
    expect(await s.submit("gen-1", "count", { player: "a", name: "Ash", named: 50, total: 151, ms: 9000 }, false)).toBe(true);
    expect(await s.submit("gen-1", "count", { player: "a", name: "Ash", named: 40, total: 151, ms: 1000 }, false)).toBe(false);
    expect(await s.submit("gen-1", "count", { player: "a", name: "Ash", named: 60, total: 151, ms: 9000 }, false)).toBe(true);
    await s.submit("gen-1", "count", { player: "b", name: "Misty", named: 60, total: 151, ms: 8000 }, false);
    expect((await s.board("gen-1", "count"))!.map((r) => r.name)).toEqual(["Misty", "Ash"]);
    expect(await s.submit("daily:2026-10-26", "count", { player: "a", name: "Ash", named: 1, total: 9, ms: 1 }, true)).toBe(true);
    expect(await s.submit("daily:2026-10-26", "count", { player: "a", name: "Ash", named: 9, total: 9, ms: 1 }, true)).toBe(false);
  });

  it("reads scopes: categories and the day's daily", () => {
    const now = Date.parse("2026-10-26T12:00:00Z");
    expect(parseScope("gen-1", now)).toMatchObject({ category: "gen-1", total: 151, limitMs: 13 * 60_000, daily: null });
    expect(parseScope("daily:2026-10-26", now)).toMatchObject({ category: neaDailyCategory("2026-10-26"), daily: "2026-10-26" });
    expect(parseScope("daily:2026-09-01", now)).toBeNull();
    expect(parseScope("nope", now)).toBeNull();
  });

  it("runs a race: lobby, start, names, a winner, and the clock", () => {
    let now = 1_000_000;
    const { race, playerId: host } = createRace("Red", "abcdefgh", "ultra-beasts", 11, 5, now);
    const joined = joinRace(race, "Blue", now);
    if (!joined.ok) throw new Error(joined.error);
    expect(joinRace(joined.race, "blue", now)).toMatchObject({ ok: false });
    expect(startRace(joined.race, host, now)).toMatchObject({ ok: false, status: 409 });
    const ready = readyRace(joined.race, joined.playerId, true, now);
    if (!ready.ok) throw new Error(ready.error);
    expect(startRace(ready.race, joined.playerId, now)).toMatchObject({ ok: false, status: 403 });
    const started = startRace(ready.race, host, now);
    if (!started.ok) throw new Error(started.error);
    const t0 = started.race.startsAt!;
    expect(nameInRace(started.race, host, [0], now)).toMatchObject({ ok: false });
    expect(nameInRace(started.race, host, Array.from({ length: 11 }, (_, i) => i), t0 + 500)).toMatchObject({ ok: false, status: 429 });
    now = t0 + 10_000;
    let r = nameInRace(started.race, joined.playerId, [0, 1, 2, 2, 99], now);
    if (!r.ok) throw new Error(r.error);
    expect(raceView(r.race, joined.playerId, now, 1).mine).toEqual([0, 1, 2]);
    expect(raceView(r.race, host, now, 1).standings[0]).toMatchObject({ name: "Blue", named: 3, place: 1 });
    expect(raceView(r.race, host, now, 1).mine).toEqual([]);
    const afterBlue = r.race;
    now += 10_000;
    r = nameInRace(afterBlue, host, Array.from({ length: 11 }, (_, i) => i), now);
    if (!r.ok) throw new Error(r.error);
    expect(r.race.status).toBe("finished");
    expect(r.race.end?.winner).toBe(0);
    // Without a clear, the clock ends it and the most named wins (both kept polling).
    const live = { ...afterBlue, players: afterBlue.players.map((p) => ({ ...p, seenAt: t0 + 5 * 60_000 })) };
    const timed = advanceRace(live, t0 + 5 * 60_000 + 1);
    expect(timed.status).toBe("finished");
    expect(timed.end?.winner).toBe(1);
  });
});
