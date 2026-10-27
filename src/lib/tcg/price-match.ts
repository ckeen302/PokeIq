/**
 * Matching our cards (Pokémon TCG API ids, e.g. "sv3pt5-6") to TCGplayer
 * products as published by TCGCSV. Pure functions: no I/O, so the same code
 * runs in the app, in tests and in scripts/build-tcg-price-sets.ts.
 *
 * Set → TCGplayer group(s) comes from the committed table price-sets.json.
 * Card → product: same collector number ("004/165" ≡ "4", "TG07/TG30" ≡ "TG07",
 * "SV001" ≡ "SV1") and the same name once punctuation, "-GX"/" GX", δ, ★ and
 * the like are normalised. Stamped / promo / pattern variants of a card are
 * separate TCGplayer products and never count as the card itself. Anything
 * ambiguous is left unmatched: no price is better than a wrong one.
 */

/** A TCGplayer product, trimmed to what matching needs. */
export interface TcgcsvProduct {
  productId: number;
  name: string;
  /** extendedData "Number", e.g. "004/165", "TG07/TG30", "SWSH001"; null for sealed product. */
  number: string | null;
  rarity: string | null;
}

/** "004/165" → "4", "TG07/TG30" → "TG7", "SV001" → "SV1", "swsh020" → "SWSH20", "15a" → "15A". */
export function normNumber(raw: string | null | undefined): string {
  if (!raw) return "";
  const head = raw.split("/")[0].trim().toUpperCase().replace(/\s+/g, "");
  const m = head.match(/^([A-Z-]*?)0*(\d+)([A-Z]*)$/);
  return m ? `${m[1].replace(/-/g, "")}${m[2]}${m[3]}` : head;
}

/**
 * Lower-case words only: accents, punctuation, "-GX" vs " GX", ★ / ◇ / ♀ / ♂ /
 * Greek letters and apostrophes all agree. δ becomes "delta" (TCGplayer spells
 * it out: "Delta Rainbow Energy", "Gardevoir ex (Delta Species)").
 */
export function normName(raw: string): string {
  return raw
    .replace(/δ/g, " delta ")
    .replace(/α/g, " alpha ")
    .replace(/β/g, " beta ")
    .replace(/γ/g, " gamma ")
    .replace(/[ωΩ]/g, " omega ")
    .replace(/◇/g, " prism star ")
    .replace(/★/g, " star ")
    .replace(/♀/g, " f ")
    .replace(/♂/g, " m ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Bracketed notes that describe the card itself (TCGplayer adds them to tell
 * printings in a set apart, e.g. "Venusaur EX (141 Full Art)").
 */
const DESCRIPTIVE = new Set(
  [
    "full art",
    "secret",
    "secret rare",
    "team plasma",
    "prime",
    "shiny",
    "alternate art",
    "alternate full art",
    "alternate art secret",
    "trainer gallery",
    "galarian gallery",
    "radiant collection",
    "classic collection",
    "star",
    "gold star",
    "legend",
    "holo common",
    "holo rare",
    "lv x",
    "break",
  ].map(normName)
);

/** Descriptive notes that are part of how we spell the name: "Pichu (Delta Species)" ≡ "Pichu δ". */
const NAME_NOTES: Record<string, string> = { "delta species": "delta" };

/**
 * Notes that mark a different printing of the card: stamps, promo and event
 * versions, foil patterns, misprints, oversize, edition. Such a product is
 * never taken for the card.
 */
const VARIANT =
  /prerelease|pre-release|staff|winner|cosmos|cracked ice|pattern|misprint|error|jumbo|oversize|1st edition|unlimited|shadowless|non.?holo|reverse|holo|stamp|set of \d|sealed|league|championship|participation|finalist|place|top \d|regional|national|worlds?\b|city|special event|e-?reader|gamestop|toys r us|target|walmart|best buy|costco|eb games|pokemon center|exclusive|calendar|blister|code card|display|\b1st\b|\b2nd\b|\b3rd\b|\b\d+th\b|w promo|sample|test print|japanese|international|korean|french|german|italian|spanish|portuguese/i;

export interface ParsedProductName {
  /** The card name with bracketed notes and a trailing " - 123/456" removed. */
  base: string;
  /** Notes marking a different printing (see VARIANT): never the card itself. */
  variants: string[];
  /** Other notes ("Omega", "Rocket's Secret Machine", "e-League"): fine when nothing else fits. */
  context: string[];
  /** Notes that may be part of the card's name ("Unown [J]", "Professor's Research [Professor Oak]", "Pichu (Delta Species)"). */
  nameNotes: string[];
}

const NUMBER_TAG = /^[a-z]{0,6}\s?\d{1,4}[a-z]?(\s?\/\s?[a-z]{0,6}\s?\d{1,4})?$/i;
const TRAILING_NUMBER = /\s+(?:-\s*)?#?([A-Za-z]{0,6}\d{1,4}[A-Za-z]?)(?:\/[A-Za-z]{0,6}\d{1,4})?\s*$/;

/** Splits a TCGplayer product name; `number` (the product's own) lets a bare trailing "60/197" go too. */
export function parseProductName(name: string, number?: string | null): ParsedProductName {
  const notes: string[] = [];
  let base = name
    .replace(/[([]([^)\]]*)[)\]]/g, (_, inner: string) => {
      notes.push(inner.trim());
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  // "Pikachu - 173/165", "Fuecoco - 002", "Rayquaza EX -BW47", "Finizen 60/197"
  const tail = base.match(TRAILING_NUMBER);
  if (tail && (/\s-\s*\S+$/.test(base) || (number && normNumber(tail[1]) === normNumber(number)))) base = base.slice(0, tail.index).trim();
  const variants: string[] = [];
  const context: string[] = [];
  const nameNotes: string[] = [];
  for (const raw of notes) {
    // "141 Full Art" → "Full Art"
    const n = raw.replace(/^[A-Za-z]{0,4}\d{1,4}[a-z]?\s+(?=\D)/, "");
    if (!n || NUMBER_TAG.test(n)) continue;
    const key = normName(n);
    if (NAME_NOTES[key]) nameNotes.push(NAME_NOTES[key]);
    else if (DESCRIPTIVE.has(key)) continue;
    else if (VARIANT.test(n)) variants.push(n);
    else {
      context.push(n);
      nameNotes.push(n);
    }
  }
  return { base, variants, context, nameNotes };
}

export interface MatchableCard {
  name: string;
  number?: string;
}

export type MatchResult =
  | { productId: number; how: "exact" | "context" }
  | { productId: null; why: "no-number" | "no-candidate" | "name-mismatch" | "only-variants" | "ambiguous" };

/** Trailing words the Pokémon TCG API puts in some names that TCGplayer leaves out. */
const NAME_SUFFIXES = /\s(team flare( hyper)? gear)$/;

/** Ways our name may be spelled on TCGplayer: as is, without δ, without a "(Ghetsis)"-style note. */
function cardForms(name: string): Set<string> {
  const forms = new Set<string>();
  for (const n of [name, name.replace(/δ/g, " "), name.replace(/\s*\([^)]*\)\s*/g, " ")]) forms.add(normName(n).replace(NAME_SUFFIXES, ""));
  forms.delete("");
  return forms;
}

/**
 * The one TCGplayer product that is this card, or null with a reason.
 * `products` is everything in the set's TCGplayer group(s).
 *
 * Same number and name (bracketed notes may be part of the name), not a
 * variant printing; then the one product with nothing else in brackets, else
 * the only remaining candidate. Two or more → ambiguous.
 *
 * In a Black Star Promo set a prerelease promo *is* the card (its only
 * printing carries the stamp), so there "(Prerelease)" alone is not a variant;
 * the Staff version still is.
 */
export function matchCard(card: MatchableCard, products: TcgcsvProduct[], opts: { promoSet?: boolean } = {}): MatchResult {
  const num = normNumber(card.number);
  if (!num) return { productId: null, why: "no-number" };
  const sameNumber = products.filter((p) => p.number && normNumber(p.number) === num);
  if (!sameNumber.length) return { productId: null, why: "no-candidate" };
  const want = cardForms(card.name);
  const named = sameNumber.flatMap((p) => {
    const parsed = parseProductName(p.name, p.number);
    if (want.has(normName(parsed.base))) return [{ p, parsed, bare: parsed.context.length === 0 }];
    // The notes spell out part of the name: "Unown [J]", "Professor's Research [Professor Sada]", "Pichu (Delta Species)".
    if (parsed.nameNotes.length && want.has(normName(`${parsed.base} ${parsed.nameNotes.join(" ")}`))) return [{ p, parsed, bare: true }];
    return [];
  });
  if (!named.length) return { productId: null, why: "name-mismatch" };
  const isPrereleasePromo = (v: string[]) => opts.promoSet === true && v.length === 1 && /^pre-?release$/i.test(v[0]);
  const usable = named.filter((x) => x.parsed.variants.length === 0 || isPrereleasePromo(x.parsed.variants));
  if (!usable.length) return { productId: null, why: "only-variants" };
  const bare = usable.filter((x) => x.bare && x.parsed.variants.length === 0);
  if (bare.length === 1) return { productId: bare[0].p.productId, how: "exact" };
  if (bare.length === 0 && usable.length === 1) return { productId: usable[0].p.productId, how: "context" };
  return { productId: null, why: "ambiguous" };
}

/** TCGplayer subTypeName → the variant keys the Pokémon TCG API uses (and prices.ts labels). */
const SUBTYPE_KEYS: Record<string, string> = {
  Normal: "normal",
  Holofoil: "holofoil",
  "Reverse Holofoil": "reverseHolofoil",
  "1st Edition": "1stEdition",
  "1st Edition Normal": "1stEditionNormal",
  "1st Edition Holofoil": "1stEditionHolofoil",
  Unlimited: "unlimited",
  "Unlimited Holofoil": "unlimitedHolofoil",
};

export function variantKey(subTypeName: string): string {
  return SUBTYPE_KEYS[subTypeName] ?? subTypeName.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : "")).replace(/^./, (c) => c.toLowerCase());
}

/** A TCGplayer group (≈ a set) from TCGCSV's /groups. */
export interface TcgcsvGroup {
  groupId: number;
  name: string;
  abbreviation?: string | null;
  /** "2023-09-22T00:00:00" — when TCGplayer created the group, usually the release date. */
  publishedOn?: string | null;
}

export interface SetLike {
  id: string;
  name: string;
  ptcgoCode?: string;
  /** "YYYY/MM/DD" */
  releaseDate?: string;
}

/** "SWSH12: Silver Tempest" → "silver tempest", "SM - Burning Shadows" → "burning shadows", "EX Ruby and Sapphire" → "ruby and sapphire". */
export function normSetName(raw: string): string {
  const stripped = raw
    .replace(/^(SWSH\d*|SV\d*|SM\d*|ME\d*|XY|SVE|MEE|HS)\s*(:|-|—)\s*/i, "")
    .replace(/^(SWSH|SV|ME|SM|XY)\s*(:|-|—)\s*/i, "")
    .replace(/^EX\s+(?!Trainer)/i, "");
  return normName(stripped);
}

const day = (s: string | null | undefined) => {
  const m = s?.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000 : NaN;
};

/**
 * Best-guess TCGplayer group for a set the table doesn't know yet (one released
 * after price-sets.json was built): the same name, else the same code, released
 * within a month or so. Null unless exactly one group fits.
 */
export function guessGroup(set: SetLike, groups: TcgcsvGroup[]): number | null {
  const d = day(set.releaseDate);
  if (Number.isNaN(d)) return null;
  const close = (g: TcgcsvGroup) => Math.abs(day(g.publishedOn) - d) <= 45;
  const want = normSetName(set.name);
  const byName = groups.filter((g) => normSetName(g.name) === want && close(g));
  if (byName.length === 1) return byName[0].groupId;
  if (byName.length > 1) return null;
  const code = set.ptcgoCode?.toUpperCase();
  const byCode = code ? groups.filter((g) => g.abbreviation?.trim().toUpperCase() === code && close(g)) : [];
  return byCode.length === 1 ? byCode[0].groupId : null;
}
