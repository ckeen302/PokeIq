/* MOCK ONLY: OKLCH <-> sRGB for the Shiny Studio mock's colour wheel and swatches. */
const fromLin = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function oklabToLinear(L: number, a: number, b: number) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const inGamut = (rgb: number[]) => rgb.every((c) => c >= -0.0005 && c <= 1.0005);
/** sRGB 0..255 and whether the colour was inside the gamut (else chroma is reduced until it is). */
export function oklch(L: number, C: number, H: number): { rgb: [number, number, number]; inside: boolean } {
  const h = (H * Math.PI) / 180;
  let rgb = oklabToLinear(L, C * Math.cos(h), C * Math.sin(h));
  const inside = inGamut(rgb);
  if (!inside) {
    let lo = 0, hi = C;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLinear(L, mid * Math.cos(h), mid * Math.sin(h)))) lo = mid;
      else hi = mid;
    }
    rgb = oklabToLinear(L, lo * Math.cos(h), lo * Math.sin(h));
  }
  return { rgb: rgb.map((c) => Math.round(Math.min(1, Math.max(0, fromLin(Math.min(1, Math.max(0, c))))) * 255)) as [number, number, number], inside };
}
export const hexOf = (L: number, C: number, H: number) => "#" + oklch(L, C, H).rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
