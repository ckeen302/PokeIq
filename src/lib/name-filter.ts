import { ANYWHERE, IN_WORD, SAFE, WORD } from "./name-filter-terms";

/**
 * Keeps slurs and obscenities out of names other trainers see: leaderboard
 * entries, duel and battle names, trainer accounts, challenge links. Pure and
 * dependency-free, so a form can check a name before it's sent and the API
 * checks it again.
 *
 * A name is folded first: accents (é → e), look-alike letters (Cyrillic а,
 * Greek ο, fullwidth and fancy Unicode letters), leetspeak (0 → o, 1 → i or
 * l, 3 → e, 4 → a, 5 → s, 7 → t, @ → a, $ → s…) and case, with apostrophes
 * dropped and everything else that isn't a letter splitting words. A letter
 * may repeat ("fuuuck"). Then each term matches as freely as its list allows
 * (see name-filter-terms.ts), once everyday words that hide a term are set
 * aside, so "Cockatiel", "Scunthorpe" and every Pokémon pass.
 */

/** What a form or the API says about a name that won't do. */
export const NAME_REJECTED = "Pick a different name.";
/** Shown instead of a name that won't do, where there's no one to ask for another. */
export const SAFE_NAME = "Trainer";

/** Letters from other scripts (and a few symbols) that pass for Latin ones. Keys are lowercase. */
const LOOKALIKES: Record<string, string> = {
  // Cyrillic
  а: "a", в: "b", е: "e", ё: "e", з: "e", к: "k", м: "m", н: "h", о: "o", п: "n", р: "p", с: "c", т: "t", у: "y", х: "x",
  ѕ: "s", і: "i", ї: "i", ј: "j", ԁ: "d", һ: "h", ӏ: "l", ү: "y", ԛ: "q", ԝ: "w", ь: "b",
  // Greek
  α: "a", β: "b", γ: "y", ε: "e", η: "n", ι: "i", κ: "k", μ: "u", ν: "v", ο: "o", ρ: "p", σ: "s", ς: "s", τ: "t", υ: "u", χ: "x", ω: "w",
  // Latin letters Unicode doesn't decompose
  ß: "ss", æ: "ae", œ: "oe", ø: "o", đ: "d", ð: "d", ħ: "h", ı: "i", ł: "l", ŀ: "l", ƒ: "f", ɑ: "a", ɡ: "g", ʋ: "v", ŋ: "n", þ: "th",
};

/** Leetspeak. */
const LEET: Record<string, string> = {
  "0": "o", "3": "e", "4": "a", "5": "s", "6": "g", "7": "t", "8": "b", "9": "g",
  "@": "a", "$": "s", "+": "t", "€": "e", "£": "l", "¥": "y", "!": "i", "¡": "i", "(": "c", "¢": "c",
};
/** Symbols that read as either of two letters: both readings are checked. */
const AMBIGUOUS: Record<string, [string, string]> = { "1": ["i", "l"], "|": ["l", "i"] };

/**
 * "fuck" → /f+u+c+k+/: each letter may repeat ("fuuuck"), and a double
 * letter needs two ("nigg"). `strict`, for short whole words: a single
 * letter only once or three times and more, so "rapping" and "annals" pass.
 */
function pattern(term: string, strict = false): string {
  return term.replace(/(.)\1*/g, (run) => {
    const c = run[0];
    if (run.length > 1) return `${c}{${run.length},}`;
    return strict ? `${c}(?:${c}{2,})?` : `${c}+`;
  });
}
const anywhereRe = new RegExp(ANYWHERE.map((t) => pattern(t)).join("|"));
const inWordRe = new RegExp([...ANYWHERE, ...IN_WORD].map((t) => pattern(t)).join("|"));
/** A whole word, or its plural. */
const wordRe = new RegExp(`^(?:${WORD.map((t) => pattern(t, true)).join("|")})[sz]?$`);
const safeRe = new RegExp(SAFE.join("|"), "g");

/** Sets the everyday words that hide a term aside (as a break, so the letters around them don't join up). */
const withoutSafe = (letters: string) => letters.replace(safeRe, "|");

/** The name as words of a–z letters, case kept (for camelCase), in each reading of 1 and |. */
function readings(raw: string): string[][] {
  const plain = raw
    .slice(0, 200)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/['’‘`´ʼ]/g, "");
  const variants = /[1|]/.test(plain) ? [0, 1] : [0];
  return variants.map((v) => {
    let out = "";
    for (const ch of plain) {
      const lower = ch.toLowerCase();
      const mapped = AMBIGUOUS[ch]?.[v] ?? LEET[ch] ?? LOOKALIKES[lower];
      out += mapped === undefined ? ch : ch === lower ? mapped : mapped.toUpperCase();
    }
    return out.split(/[^A-Za-z]+/).filter(Boolean);
  });
}

/** "MassHitter" → ["Mass", "Hitter"]. */
const camelParts = (word: string) => word.split(/(?<=[a-z])(?=[A-Z])/);
/** Capitalised words run together ("MassHitter"), as opposed to a word with odd capitals ("ShiT", "xXShitXx"). */
const isTitleRun = (parts: string[]) => parts.length > 1 && parts.every((p) => /^[A-Z][a-z]+$/.test(p));

function offensive(words: string[]): boolean {
  const lower = words.map((w) => w.toLowerCase());
  if (anywhereRe.test(withoutSafe(lower.join("")))) return true;

  for (const word of words) {
    const parts = camelParts(word);
    const units = isTitleRun(parts) ? parts : [word];
    if (units.some((u) => inWordRe.test(withoutSafe(u.toLowerCase())))) return true;
    if (wordRe.test(word.toLowerCase()) || parts.some((p) => wordRe.test(p.toLowerCase()))) return true;
  }

  // Letters typed one or two at a time read as one word: "s h i t", "a.s.s", "fu ck".
  for (let i = 0; i < lower.length; i++) {
    let run = "";
    let count = 0;
    for (let j = i; j < lower.length && lower[j].length <= 2; j++) {
      run += lower[j];
      count++;
      if (count > 1 && (inWordRe.test(withoutSafe(run)) || wordRe.test(run))) return true;
    }
  }
  return false;
}

/** True when nothing in `name` is a slur, hate term or obscenity, however it's spelled. */
export function isCleanName(name: string): boolean {
  if (/1\s*4\s*8\s*8/.test(name)) return false;
  return !readings(name).some(offensive);
}

/** `name` if it's fit to show, otherwise `fallback`. For names already stored, or shared before the filter existed. */
export function publicName(name: string, fallback = SAFE_NAME): string {
  return isCleanName(name) ? name : fallback;
}

/** An optional name, dropped when it isn't fit to show. */
export function optionalName(name: string | undefined): string | undefined {
  return name && isCleanName(name) ? name : undefined;
}
