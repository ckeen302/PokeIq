/**
 * Starting points: the official balls, a theme for each type, a blank ball, Randomise, and a ball made from a
 * Pokémon's own colours and types.
 *
 * There are no official hex values for any ball: every colour here was matched by eye to the official artwork, and
 * the markings are our own simple recreations made from the pattern masks and stickers (no game models or textures).
 */
import { lchToRgb, maxChroma, rgbToLch, wrapHue } from "@/lib/shiny-maker/color";
import { blankDesign, cloneDesign, rgbOf, type Design, type Effect, type Finish, type Part, type RGB, type Sticker } from "./design";
import { patternId, PATTERNS } from "./patterns";
import { glyphIndex } from "./glyphs";

/** The official balls, in the order the Start tab shows them. `item` is the item's key in the games' item lists. */
export const BALL_IDS = [
  "poke", "great", "ultra", "master", "premier", "safari", "sport", "park", "dream", "beast", "cherish", "fast", "friend", "heavy",
  "level", "love", "lure", "moon", "net", "dive", "nest", "repeat", "timer", "luxury", "dusk", "heal", "quick", "strange", "origin",
  "hisui-poke", "hisui-great", "hisui-ultra", "hisui-heavy", "feather", "wing", "jet", "leaden", "gigaton",
] as const;
export type BallId = (typeof BALL_IDS)[number];

export const TYPES = ["normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy"] as const;
export type TypeName = (typeof TYPES)[number];

type Layer = [key: string, c1: string, c2?: string, c3?: string, scale?: number, rot?: number];
interface Spec {
  top: string;
  bottom?: string;
  band?: string;
  ring?: string;
  button?: string;
  inner?: string;
  fin?: Partial<Record<Part, Finish>>;
  pt?: Layer;
  pb?: Layer;
  shape?: Design["shape"];
  btn?: Design["button"];
  band_?: number;
  stickers?: (Omit<Sticker, "colour"> & { colour: string })[];
  effect?: [Effect, string, string, string];
}

const WHITE = "#f6f6f2", BLACK = "#1b1b1f";
/** Hisuian balls: an apricorn-like top, a wooden lower half and band, a bronze clasp. */
const HISUI: Partial<Spec> = { bottom: "#c79a62", band: "#8a6a40", ring: "#5a4630", button: "#e6d7ae", inner: "#6b4f31", fin: { bottom: "wood", band: "metal", ring: "metal", button: "matte", inner: "wood" }, shape: "hisui", btn: "latch", band_: 170 };

const at = (polDeg: number, azDeg: number) => ({ pol: Math.round((polDeg / 180) * 65535), az: Math.round((((azDeg % 360) + 360) % 360) / 360 * 65536) % 65536 });

const SPECS: Record<BallId, Spec> = {
  poke: { top: "#e3262f" },
  great: { top: "#2f6fe0", pt: ["great", "#e3262f"] },
  ultra: { top: "#24252b", pt: ["ultra", "#f2c230"] },
  master: { top: "#7b3fc6", pt: ["master", "#ef6fb0"], stickers: [{ glyph: glyphIndex.letter("M"), ...at(30, 0), size: 70, rot: 0, colour: "#ffffff" }] },
  premier: { top: WHITE, band: "#d8262f", ring: "#d8262f" },
  safari: { top: "#7fa34a", bottom: "#e8dcb0", pt: ["safari", "#4e6b2a"] },
  sport: { top: "#f39a2b", pt: ["rings", "#b8452a", "#7a2a18", undefined, 70] },
  park: { top: "#f2c94c", pt: ["zigzag", "#3a7fd8", "#2a5fb8"], bottom: "#f6f0d8" },
  dream: { top: "#ef7fc0", bottom: "#f9d6ea", pt: ["argyle", "#c46bd8", "#f7a8d6", "#ffffff"], fin: { top: "pearl", bottom: "pearl" } },
  beast: { top: "#2d55c8", bottom: "#2d55c8", pt: ["beast", "#f2c230"], pb: ["beast", "#f2c230"] },
  cherish: { top: "#d3242c", bottom: "#2a2224", pt: ["rings", "#a8161f", "#f27b7b", undefined, 80] },
  fast: { top: "#f6c02a", pt: ["chevrons", "#e3262f"] },
  friend: { top: "#3fae4a", pt: ["great", "#e8562f"] },
  heavy: { top: "#8c96a8", pt: ["beast", "#3a4050"], fin: { top: "metal" } },
  level: { top: "#f2c230", pt: ["rings", "#e3262f", "#1b1b1f", undefined, 60] },
  love: { top: "#f07fb4", pt: ["heart", "#e8336f"] },
  lure: { top: "#3a7fd8", pt: ["waves", "#e3262f", "#7fd3e8"] },
  moon: { top: "#2a3a7a", pt: ["crescent", "#ffd23a"] },
  net: { top: "#2a8fb8", pt: ["net", "#1b2a36"] },
  dive: { top: "#2a6fd1", pt: ["dive", "#bfe8ff", "#ffffff"] },
  nest: { top: "#9ac43a", pt: ["rings", "#4e7a2a", "#c8e070", undefined, 60] },
  repeat: { top: "#f39a2b", pt: ["rings", "#f2c230", "#e3262f", undefined, 90] },
  timer: { top: WHITE, pt: ["stripes", "#d8262f", "#1b1b1f", undefined, 120] },
  luxury: { top: "#24252b", bottom: "#24252b", ring: "#e0b33a", pt: ["rings", "#d8262f", "#e0b33a", undefined, 50], fin: { ring: "metal" } },
  dusk: { top: "#26292b", bottom: "#26292b", ring: "#5bc04d", pt: ["rings", "#5bc04d", "#2f8a3a", undefined, 50] },
  heal: { top: "#f27fb2", pt: ["rings", "#ffd0e4", "#ffffff", undefined, 50] },
  quick: { top: "#3a7fd8", pt: ["quick", "#f5d132"] },
  strange: { top: "#7fe0d6", bottom: "#b8f0ea", band: "#2a8f88", ring: "#2a8f88", pt: ["sunburst", "#a8f4ec", "#ffffff"], fin: { top: "glass", bottom: "glass" } },
  origin: { top: "#30357a", bottom: "#30357a", band: "#d9b54a", ring: "#d9b54a", button: "#8fd3ff", pt: ["galaxy", "#5a4fd8", "#9a7ae8", "#ffffff"], pb: ["galaxy", "#5a4fd8", "#9a7ae8", "#ffffff"], fin: { top: "pearl", bottom: "pearl", band: "metal", ring: "metal", button: "glass" }, shape: "faceted", btn: "gem" },
  "hisui-poke": { ...HISUI, top: "#c8342c" },
  "hisui-great": { ...HISUI, top: "#3a68b0", pt: ["rings", "#c8342c", "#8a6a40", undefined, 50] },
  "hisui-ultra": { ...HISUI, top: "#e0a92a", pt: ["ultra", "#2a2a2a"] },
  "hisui-heavy": { ...HISUI, top: "#5a5f68", pt: ["beast", "#2a2f3a"], fin: { ...HISUI.fin, top: "metal" } },
  feather: { ...HISUI, top: "#9fc8e8", pt: ["chevrons", "#ffffff"] },
  wing: { ...HISUI, top: "#5fa86a", pt: ["chevrons", "#ffffff"] },
  jet: { ...HISUI, top: "#4a78c8", pt: ["chevrons", "#f2c230"] },
  leaden: { ...HISUI, top: "#6a6e76", pt: ["rings", "#3a3e46", undefined, undefined, 60], fin: { ...HISUI.fin, top: "stone" } },
  gigaton: { ...HISUI, top: "#4a4e56", pt: ["hexagons", "#2a2e36", "#1a1c22"], fin: { ...HISUI.fin, top: "stone" } },
};

/** The item key in src/data/i18n/<locale>/items.json for a ball's official name (Hisuian balls add "Hisuian"). */
export const ITEM_KEY: Record<BallId, string> = Object.fromEntries(BALL_IDS.map((id) => [id, `${id.replace(/^hisui-/, "")}ball`])) as Record<BallId, string>;

function layer(l: Layer | undefined): Design["patterns"]["top"] {
  const base = blankDesign().patterns.top;
  if (!l) return base;
  const id = patternId(l[0]);
  const def = PATTERNS[id].colours;
  return { id, colours: [rgbOf(l[1]), rgbOf(l[2] ?? def[1]), rgbOf(l[3] ?? def[2])], scale: l[4] ?? PATTERNS[id].scale ?? 102, rot: l[5] ?? 0 };
}

function fromSpec(s: Spec): Design {
  const d = blankDesign();
  d.colours = {
    top: rgbOf(s.top),
    bottom: rgbOf(s.bottom ?? WHITE),
    band: rgbOf(s.band ?? BLACK),
    ring: rgbOf(s.ring ?? s.band ?? BLACK),
    button: rgbOf(s.button ?? WHITE),
    inner: rgbOf(s.inner ?? "#34343a"),
  };
  d.finishes = { ...d.finishes, ...s.fin };
  d.patterns = { top: layer(s.pt), bottom: layer(s.pb) };
  if (s.shape) d.shape = s.shape;
  if (s.btn) d.button = s.btn;
  if (s.band_ !== undefined) d.band = s.band_;
  if (s.stickers) d.stickers = s.stickers.map((st) => ({ ...st, colour: rgbOf(st.colour) }));
  if (s.effect) d.effect = { kind: s.effect[0], colours: [rgbOf(s.effect[1]), rgbOf(s.effect[2]), rgbOf(s.effect[3])] };
  return d;
}

export function ballPreset(id: BallId): Design {
  return fromSpec(SPECS[id]);
}

/** Each type's theme: its colours, a pattern in its spirit, a finish, and an opening effect. */
const THEMES: Record<TypeName, Spec> = {
  normal: { top: "#d8cfb4", pt: ["dots", "#ffffff"], effect: ["confetti", "#ffffff", "#e8d8a8", "#c8b890"] },
  fire: { top: "#e8452a", pt: ["flames", "#ff8a1f", "#ffc02e", "#fff1a8"], effect: ["fire", "#ff5a1f", "#ffb02e", "#fff1a8"] },
  water: { top: "#2f7fe0", pt: ["waves", "#9bd8ff", "#ffffff"], effect: ["bubbles", "#bfe8ff", "#ffffff", "#5fb0ff"] },
  grass: { top: "#3fae5a", pt: ["scales", "#1f7a3a", "#a8e8a8"], effect: ["petals", "#ff9ac0", "#ffffff", "#a8e870"] },
  electric: { top: "#ffd23a", pt: ["lightning", "#1b1b1f", "#3a3a40"], effect: ["lightning", "#fff4a0", "#ffd23a", "#ffffff"] },
  ice: { top: "#9fdcf0", bottom: "#e8f8ff", pt: ["stars", "#ffffff", "#d8f4ff"], fin: { top: "pearl" }, effect: ["stars", "#ffffff", "#bfeeff", "#8fd8f8"] },
  fighting: { top: "#c8452a", pt: ["chevrons", "#f2c230"], fin: { top: "matte" }, effect: ["stars", "#ffd23a", "#ff8a3d", "#ffffff"] },
  poison: { top: "#9a4fc8", pt: ["dots", "#d58af0"], effect: ["bubbles", "#d58af0", "#9a4fc8", "#f0c8ff"] },
  ground: { top: "#c9a25a", bottom: "#e8d8b0", pt: ["camo", "#a8823a", "#7a5a2a", "#e0c890"], fin: { top: "matte" }, effect: ["smoke", "#c9a25a", "#e8d8b0", "#8a6a3a"] },
  flying: { top: "#8fb0f0", pt: ["chevrons", "#ffffff"], effect: ["confetti", "#ffffff", "#bcd2ff", "#8fb0f0"] },
  psychic: { top: "#f05a9a", pt: ["spiral", "#ff9ac8"], fin: { top: "pearl" }, effect: ["stars", "#ff9ac8", "#ffffff", "#c88af0"] },
  bug: { top: "#9ac43a", pt: ["hexagons", "#6a8a1a", "#d8f07a"], effect: ["petals", "#d8f07a", "#9ac43a", "#ffffff"] },
  rock: { top: "#a8955a", bottom: "#d8ccaa", pt: ["rings", "#7a6a3a", undefined, undefined, 60], fin: { top: "stone", bottom: "stone" }, effect: ["smoke", "#a8955a", "#d8ccaa", "#6a5a3a"] },
  ghost: { top: "#6a4fa0", bottom: "#3a2f5a", pt: ["gradient", "#2a1f4a", "#14101f"], effect: ["smoke", "#9a7ad8", "#4a3a7a", "#d8c8ff"] },
  dragon: { top: "#5a4fd8", pt: ["scales", "#3a2fa8", "#9a8af0"], fin: { top: "pearl" }, effect: ["fire", "#8a6af0", "#5a4fd8", "#ffb02e"] },
  dark: { top: "#3a3440", bottom: "#2a262e", pt: ["crescent", "#e8c84a"], fin: { top: "matte", bottom: "matte" }, effect: ["smoke", "#3a3440", "#6a6070", "#e8c84a"] },
  steel: { top: "#b8c0cc", bottom: "#dde2ea", pt: ["hexagons", "#8a94a4", "#5a6270"], fin: { top: "metal", bottom: "metal" }, effect: ["stars", "#ffffff", "#c8d0dc", "#8a94a4"] },
  fairy: { top: "#f4a8c8", pt: ["hearts", "#ffffff", "#ff7aa8"], fin: { top: "pearl" }, effect: ["hearts", "#ff7aa8", "#ffffff", "#ffc8e0"] },
};

export function typePreset(t: TypeName): Design {
  return fromSpec(THEMES[t]);
}

const rgb = (l: number, c: number, h: number): RGB => lchToRgb(l, Math.min(c, maxChroma(l, h)), wrapHue(h));

/** A random ball: a colour harmony, a pattern most of the time, a finish, sometimes an effect. `rnd` for tests. */
export function randomDesign(rnd: () => number = Math.random, keep?: Design): Design {
  const d = keep ? cloneDesign(keep) : blankDesign();
  const h = rnd() * 360;
  const harmony = [0, 180, 150, 120, 30][Math.floor(rnd() * 5)];
  const vivid = 0.13 + rnd() * 0.07;
  const top = rgb(0.5 + rnd() * 0.25, vivid, h);
  const light = rnd() < 0.55;
  const bottom = light ? rgb(0.95, 0.01, h) : rgb(0.45 + rnd() * 0.35, vivid * 0.8, h + harmony);
  const dark = rnd() < 0.8;
  const band = dark ? rgb(0.2, 0.01, h) : rgb(0.8, 0.12, h + harmony);
  d.colours = { top, bottom, band, ring: band, button: rgb(0.97, 0.005, h), inner: rgb(0.3, 0.03, h) };
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const fin: Finish[] = ["gloss", "gloss", "gloss", "matte", "metal", "pearl", "holo", "glitter"];
  d.finishes = { top: pick(fin), bottom: rnd() < 0.7 ? "gloss" : pick(fin), band: rnd() < 0.7 ? "matte" : "metal", ring: "gloss", button: rnd() < 0.15 ? "glow" : "gloss", inner: "matte" };
  const pat = rnd() < 0.75 ? 1 + Math.floor(rnd() * (PATTERNS.length - 1)) : 0;
  d.patterns.top = pat
    ? { id: pat, colours: [rgb(0.88, vivid * 0.6, h + harmony), rgb(0.3, vivid, h + harmony), rgb(0.7, vivid, h - harmony)], scale: 60 + Math.floor(rnd() * 110), rot: rnd() < 0.7 ? 0 : Math.floor(rnd() * 256) }
    : blankDesign().patterns.top;
  d.patterns.bottom = !light && rnd() < 0.3 && pat ? { ...d.patterns.top, colours: [...d.patterns.top.colours] as Design["patterns"]["top"]["colours"] } : blankDesign().patterns.bottom;
  const effects: Effect[] = ["hearts", "stars", "fire", "bubbles", "lightning", "petals", "confetti", "smoke"];
  d.effect = rnd() < 0.6 ? { kind: pick(effects), colours: [rgb(0.9, 0.08, h), top, rgb(0.85, 0.14, h + harmony)] } : d.effect;
  d.shape = rnd() < 0.85 ? "classic" : pick(["hisui", "faceted"] as const);
  d.button = d.shape === "hisui" ? "latch" : rnd() < 0.8 ? "classic" : pick(["gem", "glow"] as const);
  d.band = 60 + Math.floor(rnd() * 120);
  return d;
}

/** What a Pokémon-made ball takes from that Pokémon: its colours (largest area first), types and name. */
export interface PokemonLook {
  id: number;
  types: string[];
  /** Its own colours, largest share of the picture first. */
  colours: RGB[];
}

const PATTERN_FOR: Record<string, string> = {
  normal: "dots", fire: "flames", water: "waves", grass: "scales", electric: "lightning", ice: "stars", fighting: "chevrons", poison: "dots", ground: "camo",
  flying: "chevrons", psychic: "spiral", bug: "hexagons", rock: "rings", ghost: "gradient", dragon: "scales", dark: "crescent", steel: "hexagons", fairy: "hearts",
};
const FINISH_FOR: Record<string, Finish> = { steel: "metal", rock: "stone", ice: "pearl", psychic: "pearl", fairy: "pearl", ghost: "matte", dark: "matte", ground: "matte" };

/**
 * A ball made from a Pokémon: its most colourful large colour on top, a lighter or contrasting one below, its darkest
 * for the band, a pattern for its first type in its other colours, a finish and an effect for its types, and the
 * Pokémon itself inside.
 */
export function pokemonPreset(p: PokemonLook): Design {
  const type = (TYPES as readonly string[]).includes(p.types[0]) ? (p.types[0] as TypeName) : "normal";
  const theme = typePreset(type);
  const cols = p.colours.length ? p.colours : [theme.colours.top];
  const lch = cols.map((c) => ({ c, v: rgbToLch(c[0], c[1], c[2]) }));
  // The main colour: the most colourful of the larger ones (the first few by area), unless all are grey.
  const big = lch.slice(0, Math.min(4, lch.length));
  const main = big.slice().sort((a, b) => b.v.c - a.v.c)[0];
  const rest = lch.filter((x) => x !== main);
  const lightest = rest.slice().sort((a, b) => b.v.l - a.v.l)[0];
  const darkest = lch.slice().sort((a, b) => a.v.l - b.v.l)[0];
  const second = rest.slice().sort((a, b) => Math.abs(b.v.l - main.v.l) * 0.6 + b.v.c - (Math.abs(a.v.l - main.v.l) * 0.6 + a.v.c))[0];
  const d = theme;
  const top = main.c;
  const bottom = lightest && lightest.v.l > 0.72 ? lightest.c : rgb(0.95, 0.012, main.v.h);
  const band = darkest && darkest.v.l < 0.4 ? darkest.c : rgb(0.22, 0.02, main.v.h);
  d.colours = { top, bottom, band, ring: band, button: rgb(0.97, 0.008, main.v.h), inner: rgb(0.3, 0.03, main.v.h) };
  const pid = patternId(PATTERN_FOR[type] ?? "dots");
  const accent = second?.c ?? rgb(Math.min(0.92, main.v.l + 0.25), main.v.c * 0.7, main.v.h);
  const accent2 = (rest[1] ?? second ?? main).c;
  d.patterns.top = { id: pid, colours: [accent, accent2, lightest?.c ?? bottom], scale: PATTERNS[pid].scale ?? 102, rot: 0 };
  d.patterns.bottom = blankDesign().patterns.bottom;
  d.finishes = { ...d.finishes, top: FINISH_FOR[type] ?? "gloss", bottom: FINISH_FOR[type] === "metal" ? "metal" : "gloss" };
  if (p.types[1] && FINISH_FOR[p.types[1]] && d.finishes.top === "gloss") d.finishes.top = FINISH_FOR[p.types[1]];
  d.effect = { kind: d.effect.kind === "none" ? "stars" : d.effect.kind, colours: [accent, top, rgb(0.95, 0.03, main.v.h)] };
  d.inside = { id: p.id, shiny: false, custom: null };
  return d;
}
