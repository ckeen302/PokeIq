import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VIDEO_GAMES } from "@/lib/dex/video-games";
import { MOVIES } from "@/lib/movies/data";
import { CASES } from "@/lib/theories/data";
import type { GameTexts } from "@/lib/dex/video-games-i18n";
import type { MovieText } from "@/lib/movies/i18n";
import type { CaseText } from "@/lib/theories/i18n";

/**
 * The Pokédex guides in every language (src/data/i18n/<locale>/content/{games,movies,theories}.json): each file
 * covers exactly the English entries, keyed by slug, with the same shape (evidence, what's new, DLC, characters),
 * and every highlighted word is in the text it highlights.
 */

const LOCALES = ["ja", "es", "fr", "de", "it"] as const;
const read = <T>(locale: string, name: string): T => JSON.parse(readFileSync(join(process.cwd(), "src/data/i18n", locale, "content", `${name}.json`), "utf8")) as T;
const filled = (s: unknown) => typeof s === "string" && s.trim().length > 0;

describe.each(LOCALES)("Pokédex guides in %s", (locale) => {
  it("games: every game, no extra, same sections", () => {
    const tx = read<GameTexts>(locale, "games");
    expect(Object.keys(tx.games).sort()).toEqual(VIDEO_GAMES.map((g) => g.slug).sort());
    for (const g of VIDEO_GAMES) {
      const x = tx.games[g.slug];
      expect(filled(x.name) && filled(x.summary), g.slug).toBe(true);
      expect(x.alts.length, `${g.slug}: alts`).toBe(g.cover.kind === "box" ? g.cover.alts.length : 1);
      expect(Boolean(x.firstIn), `${g.slug}: firstIn`).toBe(Boolean(g.firstIn));
      expect(Boolean(x.releasedAs), `${g.slug}: releasedAs`).toBe(Boolean(g.releasedAs));
      expect(Boolean(x.region), `${g.slug}: region`).toBe(Boolean(g.region));
      expect(x.versions?.length ?? 0, `${g.slug}: versions`).toBe(g.exclusives?.length ?? 0);
      expect(x.whatsNew?.length ?? 0, `${g.slug}: what's new`).toBe(g.whatsNew?.length ?? 0);
      expect(x.dlc?.length ?? 0, `${g.slug}: DLC`).toBe(g.dlc?.length ?? 0);
      for (const n of [...(x.whatsNew ?? []), ...(x.dlc ?? []).map((d) => ({ title: d.name, text: d.text }))]) expect(filled(n.title) && filled(n.text), g.slug).toBe(true);
    }
    for (const g of VIDEO_GAMES) for (const p of [g.platform, ...g.platforms]) expect(filled(tx.platforms[p]), `platform ${p}`).toBe(true);
  });

  it("movies: every film, no extra, characters keyed by their English names", () => {
    const tx = read<Record<string, MovieText>>(locale, "movies");
    expect(Object.keys(tx).sort()).toEqual(MOVIES.map((m) => m.slug).sort());
    for (const m of MOVIES) {
      const x = tx[m.slug];
      expect(filled(x.title) && filled(x.fullTitle) && filled(x.summary), m.slug).toBe(true);
      expect(Boolean(x.setting), `${m.slug}: setting`).toBe(Boolean(m.setting));
      expect(Boolean(x.trilogy), `${m.slug}: trilogy`).toBe(Boolean(m.trilogy));
      expect(Boolean(x.kicker), `${m.slug}: kicker`).toBe(Boolean(m.kicker));
      const names = new Set(m.characters.map((c) => c.name));
      for (const k of Object.keys(x.characters)) expect(names.has(k), `${m.slug}: ${k}`).toBe(true);
    }
  });

  it("theories: every case, no extra, the same evidence, quotes where English has them, highlights inside them", () => {
    const tx = read<Record<string, CaseText>>(locale, "theories");
    expect(Object.keys(tx).sort()).toEqual(CASES.map((c) => c.slug).sort());
    for (const c of CASES) {
      const x = tx[c.slug];
      for (const f of ["title", "era", "summary", "claim", "origin", "confirmed", "verdictText"] as const) expect(filled(x[f]), `${c.slug}: ${f}`).toBe(true);
      expect(x.links.length, `${c.slug}: links`).toBe(c.links.length);
      for (const [mine, theirs] of [
        [x.evidenceFor, c.evidenceFor],
        [x.evidenceAgainst, c.evidenceAgainst],
      ] as const) {
        expect(mine.length, `${c.slug}: evidence`).toBe(theirs.length);
        mine.forEach((e, i) => {
          expect(filled(e.text) && filled(e.source), `${c.slug}: evidence ${i}`).toBe(true);
          expect(Boolean(e.quote), `${c.slug}: evidence ${i} quote`).toBe(Boolean(theirs[i].quote));
          for (const m of e.mark ?? []) expect(e.quote, `${c.slug}: highlight "${m}"`).toContain(m);
        });
      }
      expect(Boolean(x.silhouettes), `${c.slug}: silhouettes`).toBe(Boolean(c.silhouettes));
      expect(Boolean(x.board), `${c.slug}: board`).toBe(Boolean(c.board));
      if (x.board && c.board) {
        expect(x.board.keys).toHaveLength(3);
        expect(Boolean(x.board.b.quote), `${c.slug}: board quote`).toBe(Boolean(c.board.b.quote));
        if (x.board.b.quote) {
          const quotes = [...x.evidenceFor, ...x.evidenceAgainst].map((e) => e.quote);
          expect(quotes, `${c.slug}: the board quotes the case's own evidence`).toContain(x.board.b.quote);
          for (const m of x.board.b.mark ?? []) expect(x.board.b.quote).toContain(m);
        }
        for (const m of x.board.c.bold ?? []) expect(x.board.c.text).toContain(m);
      }
    }
  });
});
