/**
 * The Theories tab ("The case files"): Pokémon theories, urban legends and
 * beta myths, each filed as a case with its evidence and a verdict.
 * Client-safe: plain data, no Pokédex snapshot.
 */

/** Confirmed by the games, the anime, a developer or a datamine; a fan theory nobody official has settled; or disproven. */
export type Verdict = "confirmed" | "fan" | "debunked";

/** Where a case comes from (the filter chips). */
export type CaseSource = "games" | "anime" | "pokedex" | "internet" | "manga";

/** A Pokémon pictured on a case: its National Dex number and name. */
export interface CaseArt {
  id: number;
  name: string;
}

/** A Pokédex entry quoted as evidence: which species and which game's text (checked against the committed Pokédex in tests). */
export interface DexRef {
  id: number;
  game: string;
}

export interface Evidence {
  /** The point, in plain words. */
  text: string;
  /** Exact wording from a game, a Pokédex entry or an interview, shown as a highlighted quote. */
  quote?: string;
  /** Words in the quote to highlight. */
  mark?: string[];
  /** The Pokédex entry the quote comes from. */
  dex?: DexRef;
  /** Where this comes from, e.g. "Gengar · Pokédex · Red & Blue". */
  source: string;
}

export interface SourceLink {
  label: string;
  url: string;
}

/** The "Case of the week" evidence board. */
export interface Board {
  /** The dossier's big title. */
  question: string;
  /** One or two sentences under it. */
  hook: string;
  /** The line under the magnifying glass, e.g. "Same shadow?". */
  caption: string;
  /** The dossier's key evidence, one line each for exhibits A, B and C. */
  keys: [string, string, string];
  /** Exhibit B: a quote (or a key fact) with its label. */
  b: { label: string; quote?: string; text?: string; mark?: string[] };
  /** Exhibit C: a short supporting fact; words in `bold` are emphasised. */
  c: { icon: "moon" | "code" | "map" | "dna" | "skull" | "ball"; text: string; bold?: string[] };
}

export interface TheoryCase {
  /** Case number (shown as CASE 001). */
  n: number;
  slug: string;
  title: string;
  verdict: Verdict;
  /** Generation and year it started, e.g. "Gen I · 1996". */
  era: string;
  sources: CaseSource[];
  /** One line for the case folder. */
  summary: string;
  /** The theory, in plain words. */
  claim: string;
  /** Where it started and why it spread. */
  origin: string;
  evidenceFor: Evidence[];
  evidenceAgainst: Evidence[];
  /** Canon facts only, kept apart from what fans added. */
  confirmed: string;
  /** The verdict's reasoning. */
  verdictText: string;
  /** Pages behind the case. */
  links: SourceLink[];
  /** One or two Pokémon pictured on the case. */
  art: CaseArt[];
  /** A glitch case: drawn as a block of glitch tiles instead of artwork. */
  glitch?: boolean;
  /** Exhibit A on the case page: two outlines compared, for visual-comparison cases. */
  silhouettes?: { pair: [CaseArt, CaseArt]; title: string; text: string };
  /** Related case slugs (beyond the same verdict). */
  related?: string[];
  /** Data for the Case of the week board. */
  board?: Board;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  confirmed: "Confirmed",
  fan: "Fan theory",
  debunked: "Debunked",
};

export const SOURCE_LABEL: Record<CaseSource, string> = {
  games: "Games",
  anime: "Anime",
  pokedex: "Pokédex",
  internet: "Internet",
  manga: "Manga",
};

export const THEORIES_PATH = "/pokedex/theories";
export const casePath = (slug: string) => `${THEORIES_PATH}/${slug}`;
export const caseNumber = (n: number) => `CASE ${String(n).padStart(3, "0")}`;
