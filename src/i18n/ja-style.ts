/**
 * Japanese pages only (app/[locale] adds it as a <style> when the page is in Japanese, so English CSS is unchanged):
 * our Latin fonts first (names, numbers, the logo), then the system's Japanese fonts for kana and kanji, with no extra
 * download. Kana and kanji take no spaced-out capitals, so the letter-spacing the Latin headings use is reset.
 */
const JA = `"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI","Yu Gothic","Meiryo","Noto Sans JP","Noto Sans CJK JP",sans-serif`;

export const JA_CSS = [
  `html:lang(ja) body{font-family:var(--font-body),${JA}}`,
  `html:lang(ja) .font-sans{font-family:var(--font-body),${JA}}`,
  `html:lang(ja) .font-display{font-family:var(--font-display),var(--font-body),${JA}}`,
  `html:lang(ja) .font-pixel{font-family:var(--font-pixel),${JA}}`,
  `html:lang(ja) body *{letter-spacing:normal!important;word-break:auto-phrase}`,
  `html:lang(ja) body{line-break:strict}`,
].join("");
