/**
 * The font the scene's signs and the broadcast graphics draw with: the site's display font (Latin only), followed on a
 * Japanese page by the system's Japanese fonts (the same list as the page's own CSS, src/i18n/ja-style.ts), so kana
 * and kanji drawn on a canvas never fall back to a box. Every other page gets the font exactly as before.
 */
const JA = `"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI","Yu Gothic","Meiryo","Noto Sans JP","Noto Sans CJK JP",sans-serif`;

export const sceneFont = (font: string, locale: string): string => (locale === "ja" ? `${font},${JA}` : font);
