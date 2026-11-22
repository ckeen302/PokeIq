/**
 * Name matching in every language (the guess boxes of Pokédle, Pikadoku, Name 'em All…): Latin letters lose their
 * accents and case, katakana become hiragana (so either kana finds a Japanese name), everything else is kept as the
 * letter it is. On English names this gives exactly what the old a-z-only folding gave. Client-safe and tiny.
 */
export function foldLetters(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** Everything that isn't a letter or a digit, in any script (the old folding's [^a-z0-9]). */
export const NOT_LETTER = /[^\p{L}\p{N}]/gu;
/** Runs of anything that isn't a letter or a digit (for folding that keeps word breaks). */
export const NOT_LETTERS = /[^\p{L}\p{N}]+/gu;
