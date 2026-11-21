import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import details from "@/data/pokedex-details.json";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { CASES, CASE_BY_SLUG } from "@/lib/theories/data";
import { caseOfTheWeek, filterCases, filterQuery, parseFilter, relatedCases, weekIndex } from "@/lib/theories/logic";
import { THEORIES_PATH, casePath } from "@/lib/theories/types";

const entries = details as unknown as Record<string, { entries: { text: string; games: string[] }[] }>;
const norm = (s: string) => s.replace(/[’‘]/g, "'").replace(/\s+/g, " ").toLowerCase();

describe("the case files", () => {
  it("has exactly ten cases per verdict, numbered 1 to 30 with no gaps", () => {
    for (const v of ["confirmed", "fan", "debunked"] as const) expect(CASES.filter((c) => c.verdict === v)).toHaveLength(10);
    expect(CASES.map((c) => c.n).sort((a, b) => a - b)).toEqual(Array.from({ length: CASES.length }, (_, i) => i + 1));
  });

  it("slugs and titles are unique, so no theory is filed twice", () => {
    expect(new Set(CASES.map((c) => c.slug)).size).toBe(CASES.length);
    expect(new Set(CASES.map((c) => c.title.toLowerCase())).size).toBe(CASES.length);
    for (const c of CASES) expect(c.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("every case is complete: era, claim, origin, at least two pieces of evidence, the confirmed facts, a verdict and a source URL", () => {
    for (const c of CASES) {
      expect(c.era, c.slug).toMatch(/\S/);
      expect(c.claim.length, c.slug).toBeGreaterThan(40);
      expect(c.origin.length, c.slug).toBeGreaterThan(40);
      expect(c.summary.length, c.slug).toBeGreaterThan(20);
      expect(c.evidenceFor.length + c.evidenceAgainst.length, c.slug).toBeGreaterThanOrEqual(2);
      expect(c.evidenceFor.length, c.slug).toBeGreaterThanOrEqual(1);
      expect(c.evidenceAgainst.length, c.slug).toBeGreaterThanOrEqual(1);
      for (const e of [...c.evidenceFor, ...c.evidenceAgainst]) {
        expect(e.text, c.slug).toMatch(/\S/);
        expect(e.source, c.slug).toMatch(/\S/);
        for (const m of e.mark ?? []) expect(e.quote, `${c.slug}: highlight "${m}"`).toContain(m);
      }
      expect(c.confirmed.length, c.slug).toBeGreaterThan(20);
      expect(c.verdictText.length, c.slug).toBeGreaterThan(20);
      expect(c.links.length, c.slug).toBeGreaterThanOrEqual(1);
      for (const l of c.links) expect(() => new URL(l.url), `${c.slug}: ${l.url}`).not.toThrow();
      for (const l of c.links) expect(l.url, c.slug).toMatch(/^https:\/\//);
      expect(c.sources.length, c.slug).toBeGreaterThanOrEqual(1);
    }
  });

  it("every Pokémon pictured exists, under its real name, with a board picture", () => {
    const byId = new Map(POKEDEX.map((p) => [p.id, p.name]));
    for (const c of CASES) {
      expect(c.glitch || c.art.length >= 1, c.slug).toBe(true);
      expect(c.art.length, c.slug).toBeLessThanOrEqual(2);
      for (const a of [...c.art, ...(c.silhouettes?.pair ?? [])]) {
        expect(byId.get(a.id), `${c.slug}: #${a.id}`).toBe(a.name);
        expect(existsSync(join(process.cwd(), "public/art/160", `${a.id}.webp`)), `${c.slug}: art for #${a.id}`).toBe(true);
      }
    }
  });

  it("every Pokédex quote is word for word the entry of the game it names", () => {
    let checked = 0;
    for (const c of CASES) {
      for (const e of [...c.evidenceFor, ...c.evidenceAgainst]) {
        if (!e.dex) continue;
        expect(e.quote, c.slug).toBeTruthy();
        const texts = entries[String(e.dex.id)].entries.filter((x) => x.games.includes(e.dex!.game)).map((x) => norm(x.text));
        expect(texts.length, `${c.slug}: no ${e.dex.game} entry for #${e.dex.id}`).toBeGreaterThan(0);
        expect(texts.some((t) => t.includes(norm(e.quote!))), `${c.slug}: "${e.quote}" isn't #${e.dex.id}'s ${e.dex.game} entry`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("related cases point at real cases", () => {
    for (const c of CASES) {
      for (const r of c.related ?? []) expect(CASE_BY_SLUG.has(r), `${c.slug} → ${r}`).toBe(true);
      const rel = relatedCases(c, CASES);
      expect(rel.length, c.slug).toBe(3);
      expect(rel.some((r) => r.slug === c.slug)).toBe(false);
    }
  });

  it("the board's quotes come from the case's own evidence", () => {
    for (const c of CASES.filter((x) => x.board)) {
      const quotes = [...c.evidenceFor, ...c.evidenceAgainst].map((e) => e.quote).filter(Boolean);
      if (c.board!.b.quote) expect(quotes, c.slug).toContain(c.board!.b.quote);
      for (const m of c.board!.b.mark ?? []) expect(c.board!.b.quote, c.slug).toContain(m);
      for (const b of c.board!.c.bold ?? []) expect(c.board!.c.text, c.slug).toContain(b);
    }
  });

  it("UI copy never shows a count of cases or uses banned words", () => {
    const copy = JSON.stringify(CASES);
    expect(copy).not.toMatch(/olympic/i);
    expect(copy).not.toMatch(/\b\d+ (cases|theories|case files)\b/i);
  });
});

describe("case of the week", () => {
  it("is the same all week and the same for everyone, changing on Mondays (UTC)", () => {
    const mon = new Date(Date.UTC(2026, 10, 16, 0, 0));
    const sun = new Date(Date.UTC(2026, 10, 22, 23, 59));
    const nextMon = new Date(Date.UTC(2026, 10, 23, 0, 0));
    expect(caseOfTheWeek(CASES, mon).slug).toBe(caseOfTheWeek(CASES, sun).slug);
    expect(caseOfTheWeek(CASES, mon).slug).toBe(caseOfTheWeek([...CASES].reverse(), mon).slug);
    expect(weekIndex(nextMon)).toBe(weekIndex(mon) + 1);
    expect(caseOfTheWeek(CASES, nextMon).slug).not.toBe(caseOfTheWeek(CASES, mon).slug);
  });

  it("only picks cases with board data, and gets to every one of them", () => {
    const boarded = CASES.filter((c) => c.board).map((c) => c.slug);
    expect(boarded.length).toBeGreaterThanOrEqual(4);
    const seen = new Set<string>();
    for (let w = 0; w < boarded.length; w++) seen.add(caseOfTheWeek(CASES, new Date(Date.UTC(2024, 0, 1 + 7 * w, 12))).slug);
    expect([...seen].sort()).toEqual([...boarded].sort());
    expect(caseOfTheWeek(CASES, new Date(Date.UTC(2020, 0, 1))).board).toBeTruthy();
  });
});

describe("filters", () => {
  it("read and write the URL query, ignoring unknown values", () => {
    const f = parseFilter(new URLSearchParams("v=fan&src=anime,bogus,games&q=gengar"));
    expect(f).toEqual({ verdict: "fan", sources: ["games", "anime"], q: "gengar" });
    expect(filterQuery(f)).toBe("?v=fan&src=games%2Canime&q=gengar");
    expect(parseFilter(new URLSearchParams("v=nope"))).toEqual({ verdict: null, sources: [], q: "" });
    expect(filterQuery({ verdict: null, sources: [], q: " " })).toBe("");
  });

  it("filter by verdict, source and search", () => {
    expect(filterCases(CASES, { verdict: "debunked", sources: [], q: "" })).toHaveLength(10);
    expect(filterCases(CASES, { verdict: null, sources: ["anime"], q: "" }).every((c) => c.sources.includes("anime"))).toBe(true);
    expect(filterCases(CASES, { verdict: null, sources: [], q: "clefable" }).map((c) => c.slug)).toContain("gengar-is-clefables-shadow");
    expect(filterCases(CASES, { verdict: "confirmed", sources: [], q: "clefable" })).toHaveLength(0);
    expect(filterCases(CASES, { verdict: null, sources: [], q: "pokedex mew" }).map((c) => c.slug)).toContain("complete-the-pokedex-and-you-get-mew");
  });
});

describe("theories pages in the sitemap", () => {
  it("lists the case files and every case", async () => {
    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map((e) => new URL(e.url).pathname);
    expect(urls).toContain(THEORIES_PATH);
    for (const c of CASES) expect(urls).toContain(casePath(c.slug));
  });
});
