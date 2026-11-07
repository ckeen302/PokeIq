import { describe, expect, it } from "vitest";
import catalogJson from "@/data/pikadoku-catalog.json";
import { categoryById } from "@/lib/pikadoku/categories";
import { DEFAULT_PICK_IDS, PDK_CATALOG, PICK_LENGTH, decodePick, encodePick } from "@/lib/pikadoku/catalog";
import { catalogRows } from "@/lib/pikadoku/catalog-source";
import { BAND_RULES, generatePickedGrid, gridFromIds, noBoardMessage, type PickedOptions } from "@/lib/pikadoku/generator";
import { solveGrid } from "@/lib/pikadoku/solve";
import { decodeChallenge, encodeChallenge } from "@/lib/pikadoku/challenge";
import { DEFAULT_PDK_SETTINGS, type PdkFamily, type PdkSettings } from "@/lib/pikadoku/types";
import { PdkNoBoardError, parseSettings, practiceGrid } from "@/lib/server/pikadoku";
import { resolveGrid } from "@/lib/server/pikadoku-http";

const ofFamily = (...fams: PdkFamily[]) => PDK_CATALOG.filter((c) => fams.includes(c.family)).map((c) => c.id);
const base: Omit<PickedOptions, "allowed"> = { allowSingle: false, guard: true, band: "normal" };
const headers = (ids: { rows: string[]; cols: string[] }) => [...ids.rows, ...ids.cols];
const seeds = Array.from({ length: 12 }, (_, i) => `seed${i}`);

describe("the client catalog", () => {
  it("matches the categories exactly (regenerate with scripts/pikadoku-catalog.ts)", () => {
    expect(catalogJson).toEqual(catalogRows());
  });
  it("packs ticked categories and reads them back", () => {
    const ids = [...ofFamily("types"), "move:Surf", "ability:hidden"];
    const pick = encodePick(ids);
    expect(pick).toHaveLength(PICK_LENGTH);
    expect(new Set(decodePick(pick))).toEqual(new Set(ids));
    expect(decodePick(encodePick([]))).toEqual([]);
    for (const bad of [null, 3, "", "abc", `${pick}A`, pick.replace(/^./, "*")]) expect(decodePick(bad)).toBeNull();
  });
  it("ticks PokeDoku's mix by default", () => {
    expect(DEFAULT_PICK_IDS.every((id) => categoryById(id)?.classic)).toBe(true);
    expect(DEFAULT_PICK_IDS).toContain("type:fire");
  });
});

describe("boards from ticked categories", () => {
  it("only ever uses the categories allowed", () => {
    const sets = [ofFamily("types", "regions"), ofFamily("types", "evolution", "other"), [...DEFAULT_PICK_IDS], ofFamily("moves", "types"), ofFamily("types")];
    for (const allowed of sets) {
      const ok = new Set(allowed);
      for (const seed of seeds) {
        const out = generatePickedGrid(seed, { ...base, allowed });
        expect(out.ok, `${seed} ${allowed.length}`).toBe(true);
        if (out.ok) for (const id of headers(out.ids)) expect(ok.has(id), id).toBe(true);
      }
    }
  });
  it("gives every cell two answers, or one with single answers allowed, and a full solution with the guard on", () => {
    for (const allowSingle of [false, true]) {
      for (const seed of seeds) {
        const out = generatePickedGrid(seed, { ...base, allowSingle, allowed: [...DEFAULT_PICK_IDS] });
        expect(out.ok).toBe(true);
        if (!out.ok) continue;
        const g = gridFromIds(out.ids);
        expect(Math.min(...g.answers.map((a) => a.length))).toBeGreaterThanOrEqual(allowSingle ? 1 : 2);
        expect(solveGrid(g.answers)).not.toBeNull();
        // Two categories of one group never share a board.
        const groups = [...g.rows, ...g.cols].map((c) => c.group);
        expect(new Set(groups).size).toBe(6);
      }
    }
  });
  it("keeps the minimum with the guard off", () => {
    for (const seed of seeds) {
      const out = generatePickedGrid(seed, { ...base, guard: false, allowed: ofFamily("types", "moves") });
      expect(out.ok).toBe(true);
      if (out.ok) expect(gridFromIds(out.ids).answers.every((a) => a.length >= 2)).toBe(true);
    }
  });
  it("judges difficulty by the real answer counts", () => {
    for (const seed of seeds) {
      const easy = generatePickedGrid(seed, { ...base, band: "easy", allowed: [...DEFAULT_PICK_IDS] });
      expect(easy.ok).toBe(true);
      if (easy.ok) expect(gridFromIds(easy.ids).answers.every((a) => a.length >= BAND_RULES.easyMin)).toBe(true);
      const hard = generatePickedGrid(seed, { ...base, band: "hard", allowed: [...DEFAULT_PICK_IDS] });
      expect(hard.ok).toBe(true);
      if (hard.ok) expect(gridFromIds(hard.ids).answers.filter((a) => a.length <= BAND_RULES.hardSmall).length).toBeGreaterThanOrEqual(BAND_RULES.hardCells);
    }
  });
  it("is deterministic: the same seed and settings deal the same board", () => {
    const opts = { ...base, allowed: [...DEFAULT_PICK_IDS] };
    const a = generatePickedGrid("abc123", opts);
    expect(generatePickedGrid("abc123", opts)).toEqual(a);
    expect(generatePickedGrid("xyz789", opts)).not.toEqual(a);
  });
  it("says plainly when no board is possible, and quickly", () => {
    const t = Date.now();
    expect(generatePickedGrid("s", { ...base, allowed: ["type:fire", "type:water", "region:1", "region:2", "evo:basic"] })).toEqual({ ok: false, reason: "few" });
    expect(generatePickedGrid("s", { ...base, allowed: [] })).toEqual({ ok: false, reason: "few" });
    // Six groups that never overlap enough: babies, fossils, Paradox, Ultra Beasts, Mythicals, Gigantamax.
    expect(generatePickedGrid("s", { ...base, allowed: ["other:paradox", "other:ultrabeast", "other:fossil", "other:baby", "other:mythical", "other:gmax"] })).toEqual({ ok: false, reason: "none" });
    // Only regions: no Pokémon debuted in two.
    expect(generatePickedGrid("s", { ...base, allowed: ofFamily("regions").filter((id) => id.startsWith("region:")) })).toEqual({ ok: false, reason: "none" });
    expect(Date.now() - t).toBeLessThan(3000);
    expect(noBoardMessage("none", { allowSingle: false, band: "hard" })).toBe("No board fits those settings. To widen them, tick more categories, try Normal difficulty or allow one-answer cells.");
    expect(noBoardMessage("few", { allowSingle: false, band: "normal" })).toMatch(/Tick more categories/);
  });
});

describe("Unlimited settings on the server and in links", () => {
  const picked = (ids: string[], extra: Partial<PdkSettings> = {}): PdkSettings => ({ ...DEFAULT_PDK_SETTINGS, pick: encodePick(ids), band: "normal", ...extra });

  it("deals a practice board from the pack", () => {
    const allowed = ofFamily("types", "evolution");
    const g = practiceGrid("pick0001", picked(allowed));
    for (const c of [...g.rows, ...g.cols]) expect(allowed).toContain(c.id);
    expect(practiceGrid("pick0001", picked(allowed)).rows.map((c) => c.id)).toEqual(g.rows.map((c) => c.id));
  });
  it("answers an impossible choice with a message, not a crash", () => {
    const s = picked(["other:paradox", "other:ultrabeast", "other:fossil", "other:baby", "other:mythical", "other:gmax"]);
    expect(() => practiceGrid("pick0002", s)).toThrow(PdkNoBoardError);
    const found = resolveGrid({ practice: "pick0002", difficulty: "normal", settings: s });
    expect(found).toMatchObject({ noBoard: true });
    expect("error" in found && found.error).toMatch(/No board fits/);
  });
  it("reads pick and band from a request, and ignores a bad pack", () => {
    const s = parseSettings({ pick: encodePick(["type:fire"]), band: "hard" });
    expect(s.band).toBe("hard");
    expect(decodePick(s.pick)).toEqual(["type:fire"]);
    expect(parseSettings({ pick: "nope", band: "hard" }).pick).toBeUndefined();
    expect(parseSettings({ pick: encodePick(["type:fire"]), band: "silly" }).band).toBe("normal");
  });
  it("puts the pack and the difficulty in the share link, and replays the same board", () => {
    const s = picked(ofFamily("types", "other"), { band: "hard", unlimitedPP: true, families: ["types", "other"] });
    const code = encodeChallenge({ seed: "k3j9a8xq", settings: s, result: { solved: 7, guesses: 11 } });
    expect(code).toMatch(/^k3j9a8xq\.1100\.to\.h[A-Za-z0-9_-]+\.7\.11$/);
    const back = decodeChallenge(code)!;
    expect(back.settings).toMatchObject({ pick: s.pick, band: "hard", unlimitedPP: true });
    expect(back.result).toEqual({ solved: 7, guesses: 11 });
    expect(practiceGrid(back.seed, back.settings).rows.map((c) => c.id)).toEqual(practiceGrid("k3j9a8xq", s).rows.map((c) => c.id));
    // Without a result too.
    expect(decodeChallenge(encodeChallenge({ seed: "k3j9a8xq", settings: s, result: null }))?.settings.pick).toBe(s.pick);
  });
  it("leaves older links (no pack) dealing from their families as before", () => {
    const old = decodeChallenge("k3j9a8xq.1110.te.9.12")!;
    expect(old.settings.pick).toBeUndefined();
    expect(practiceGrid(old.seed, old.settings).rows.every((c) => ["types", "evolution"].includes(c.family))).toBe(true);
  });
});
