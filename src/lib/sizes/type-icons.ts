/**
 * Type glyphs for the badges on /pokedex/sizes: simple original symbols
 * (a flame, a droplet, a leaf…) on a 24 × 24 grid, filled with the
 * even-odd rule so holes cut through. Not the games' type icons.
 */

const ring = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;

function snowflake(): string {
  const parts: string[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI) / 3;
    const c = Math.cos(a), s = Math.sin(a);
    const pt = (x: number, y: number) => `${(12 + x * c - y * s).toFixed(2)} ${(12 + x * s + y * c).toFixed(2)}`;
    const w = 1.05, L = 9.5;
    parts.push(`M${pt(-L, -w)}L${pt(L, -w)}L${pt(L, w)}L${pt(-L, w)}Z`);
    for (const e of [-1, 1]) {
      // Little chevrons near each tip.
      parts.push(`M${pt(e * 6.2, -w)}L${pt(e * 8.4, -3.6)}L${pt(e * 9.4, -2.8)}L${pt(e * 7.6, -w)}Z`);
      parts.push(`M${pt(e * 6.2, w)}L${pt(e * 8.4, 3.6)}L${pt(e * 9.4, 2.8)}L${pt(e * 7.6, w)}Z`);
    }
  }
  return parts.join("");
}

export const TYPE_GLYPHS: Record<string, string> = {
  normal: `${ring(12, 12, 8.5)}${ring(12, 12, 4.6)}`,
  fire: "M12 1.8c1.2 3.9 5.6 6 5.6 11.2A5.6 5.6 0 0 1 6.4 13c0-2.6 1.2-4.3 2.6-5.4-.1 1.9.6 3.3 1.9 3.9C10.3 7.5 11 4.4 12 1.8zm0 11.4c-.9 1.4-2 2.3-2 3.8a2 2 0 0 0 4 0c0-1.5-1.1-2.4-2-3.8z",
  water: `M12 2.2C9 6.8 6.2 10.3 6.2 14.3a5.8 5.8 0 0 0 11.6 0C17.8 10.3 15 6.8 12 2.2zM9.3 13.2c-.2 2.2.7 3.8 2.6 4.4-2.6.4-4.2-1.6-2.6-4.4z`,
  grass: "M4.2 19.8C4.2 10.6 9.4 4.6 20 3.9c-.3 10-5.9 15.6-14.4 16.1zm1.9-.9c2.9-4.4 6.4-7.6 11-10.9-5 2.5-8.6 5.8-11 10.9z",
  electric: "M13.8 1.8 4.8 13.6h5.8L9.1 22.2l10-13h-5.7z",
  ice: snowflake(),
  fighting: "M6.2 10.2c0-1.1.9-1.9 1.9-1.9h8.3c1.1 0 1.9.8 1.9 1.9v4.7a5.1 5.1 0 0 1-5.1 5.1h-1.9a5.1 5.1 0 0 1-5.1-5.1zM7.8 5.4a1.55 1.55 0 0 1 3.1 0v2.1H7.8zm3.5-.4a1.55 1.55 0 0 1 3.1 0v2.5h-3.1zm3.5.5a1.5 1.5 0 0 1 3 0v2h-3zM4.4 11.4c0-1 .8-1.7 1.8-1.7v4.4c-1 0-1.8-.8-1.8-1.7z",
  poison: `${ring(11, 14.5, 5.4)}${ring(17.6, 6.6, 2.6)}${ring(8.2, 5.2, 1.9)}${ring(11, 14.5, 2.2)}`,
  ground: "M1.8 19.6 8.2 9.4l4.1 5.2 3.2-4.4 6.7 9.4zM9.4 19.6l3.6-3.9 2.8 3.9z",
  flying: "M2.6 15.6c4.3-.8 7.4-3.9 9.6-9.4 1 3 .5 5.6-1 7.7 2.7-.4 5.2-1.9 7.3-4.6.3 3.1-1.3 6.2-4.2 8 2.1-.1 3.7-.6 5.2-1.7-1.8 3.7-6 5.8-11.4 5.2-2.4-.3-4-1.9-5.5-5.2z",
  psychic: "M1.8 12c3.1-5.1 6.7-7.4 10.2-7.4S19.1 6.9 22.2 12c-3.1 5.1-6.7 7.4-10.2 7.4S4.9 17.1 1.8 12zm10.2-4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z",
  bug: `M12 8c3.3 0 5.4 2.9 5.4 6.6S15.3 21 12 21s-5.4-2.7-5.4-6.4S8.7 8 12 8zm-.55 1.6v9.8h1.1V9.6z${ring(12, 5, 2.6)}M8.3 3.2 9.6 2l1.2 2-1 .8zM15.7 3.2 14.4 2l-1.2 2 1 .8z`,
  rock: "M3.6 15.4 6.9 6.6l7.2-3.2 6.2 5.2 1 8.3-6.2 4.6H8.2zm4.2-.2 1.4 3.6h5.5l3.7-2.9-.6-5.1-3.4-2.8z",
  ghost: `M5.8 21V11.2a6.2 6.2 0 0 1 12.4 0V21l-2.1-1.7-2 1.7-2.1-1.7-2 1.7-2.1-1.7zm3.9-11.6a1.3 1.8 0 1 0 0 3.6 1.3 1.8 0 0 0 0-3.6zm4.6 0a1.3 1.8 0 1 0 0 3.6 1.3 1.8 0 0 0 0-3.6z`,
  dragon: "M3.4 4.4c6.4.9 11.2 4.7 13.4 10.6l3.8 5.4-6.4-2.4C8 16.6 4.6 11.7 3.4 4.4zm4.2 3.1c1.3 3.8 3.7 6.4 7 7.6-1.2-3.4-3.6-6-7-7.6z",
  dark: "M15.4 2.6a9.4 9.4 0 1 0 6.3 16A7.9 7.9 0 0 1 15.4 2.6z",
  steel: `M12 2.2l8.5 4.9v9.8L12 21.8l-8.5-4.9V7.1z${ring(12, 12, 3.6)}`,
  fairy: "M12 1.6l2.4 7.9L22.4 12l-8 2.5L12 22.4l-2.4-7.9L1.6 12l8-2.5zM18.6 2.8l.8 2.3 2.3.8-2.3.8-.8 2.3-.8-2.3-2.3-.8 2.3-.8z",
};

const cache = new Map<string, Path2D>();
/** The glyph as a Path2D (browser only). */
export function typePath(type: string): Path2D | null {
  const d = TYPE_GLYPHS[type];
  if (!d || typeof Path2D === "undefined") return null;
  let p = cache.get(type);
  if (!p) { p = new Path2D(d); cache.set(type, p); }
  return p;
}
