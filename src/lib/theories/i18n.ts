import "server-only";
import type { Locale } from "@/i18n/config";
import { speciesName } from "@/lib/names/species";
import type { Board, Evidence, TheoryCase } from "./types";

/**
 * The case files in another language: src/data/i18n/<locale>/content/theories.json holds each case's translated
 * text, keyed by slug (evidence and sources in the English order). Pokédex quotes use the language's official entry
 * where the data has one; other quotes are translated. Loaded on the server for that language only; English pages
 * never load it. Pictured Pokémon take their official names in the language.
 */

type EvidenceText = Pick<Evidence, "text" | "quote" | "mark" | "source">;

export interface CaseText {
  title: string;
  era: string;
  summary: string;
  claim: string;
  origin: string;
  evidenceFor: EvidenceText[];
  evidenceAgainst: EvidenceText[];
  confirmed: string;
  verdictText: string;
  /** The source links' labels, in the English order. */
  links: string[];
  silhouettes?: { title: string; text: string };
  board?: Omit<Board, "c"> & { c: Omit<Board["c"], "icon"> };
}

const loaded = new Map<Locale, Promise<Record<string, CaseText>>>();

/** A language's case texts (null for English). */
export function theoryTexts(locale: Locale): Promise<Record<string, CaseText> | null> {
  if (locale === "en") return Promise.resolve(null);
  let p = loaded.get(locale);
  if (!p) {
    p = import(`../../data/i18n/${locale}/content/theories.json`).then((m: { default: Record<string, CaseText> }) => m.default);
    loaded.set(locale, p);
  }
  return p;
}

const evidence = (list: Evidence[], tx: EvidenceText[] | undefined): Evidence[] =>
  list.map((e, i) => {
    const x = tx?.[i];
    return x ? { ...e, text: x.text, quote: e.quote && x.quote, mark: x.mark, source: x.source } : e;
  });

/** The case with its text in the language; English (no texts) comes back as it is. */
export function localizeCase(c: TheoryCase, tx: Record<string, CaseText> | null, locale: Locale): TheoryCase {
  const x = tx?.[c.slug];
  if (!x) return c;
  const name = (a: { id: number; name: string }) => ({ ...a, name: speciesName(a.id, a.name, locale) });
  return {
    ...c,
    title: x.title,
    era: x.era,
    summary: x.summary,
    claim: x.claim,
    origin: x.origin,
    evidenceFor: evidence(c.evidenceFor, x.evidenceFor),
    evidenceAgainst: evidence(c.evidenceAgainst, x.evidenceAgainst),
    confirmed: x.confirmed,
    verdictText: x.verdictText,
    links: c.links.map((l, i) => ({ ...l, label: x.links[i] ?? l.label })),
    art: c.art.map(name),
    silhouettes: c.silhouettes && { ...c.silhouettes, pair: [name(c.silhouettes.pair[0]), name(c.silhouettes.pair[1])], ...(x.silhouettes ?? {}) },
    board: c.board && x.board && { ...x.board, c: { ...x.board.c, icon: c.board.c.icon } },
  };
}
