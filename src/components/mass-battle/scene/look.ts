import type { ArenaId, BattleSpec } from "@/lib/mass-battle/types";

/**
 * How each battlefield is lit: sky, sun, fog and the frame's grade, for the
 * arena, the time of day and the weather. Weather here is only what it
 * looks like (rain, harsh sunlight, a sandstorm, snow); what it does to
 * the battle is the battle's business.
 */

export type Weather = "none" | "rain" | "sun" | "sand" | "snow";
export type TerrainLook = "none" | "electric" | "grassy" | "psychic" | "misty";

export function normTerrain(t: unknown): TerrainLook {
  const s = String(t ?? "").toLowerCase();
  if (s.includes("electric")) return "electric";
  if (s.includes("grass")) return "grassy";
  if (s.includes("psych")) return "psychic";
  if (s.includes("mist")) return "misty";
  return "none";
}

/** Terrain over the battleground: its glow and the motes over it. */
export const TERRAIN_COLOR: Record<Exclude<TerrainLook, "none">, string> = { electric: "#ffe23a", grassy: "#5ad84a", psychic: "#ff4fb8", misty: "#ffb8f0" };
export type TimeOfDay = "day" | "dusk" | "night";

export const WEATHERS: Weather[] = ["none", "rain", "sun", "sand", "snow"];
export const TIMES: TimeOfDay[] = ["day", "dusk", "night"];

/** Reads a weather from whatever the battle calls it (Rain Dance, Drizzle, Sunny Day, Sandstorm, Hail, Snowscape…). */
export function normWeather(w: unknown): Weather {
  const s = String(w ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s || s === "none" || s === "clear") return "none";
  if (/rain|drizzle|storm(?!sand)|primordial|heavyrain/.test(s) && !/sand/.test(s)) return "rain";
  if (/sun|drought|harsh|desolate|orichalcum/.test(s)) return "sun";
  if (/sand/.test(s)) return "sand";
  if (/snow|hail|blizzard/.test(s)) return "snow";
  return "none";
}

export function normTime(t: unknown): TimeOfDay {
  const s = String(t ?? "").toLowerCase();
  if (/night|midnight|moon/.test(s)) return "night";
  if (/dusk|sunset|evening|dawn|sunrise|golden/.test(s)) return "dusk";
  return "day";
}

export interface Look {
  /** Sky: zenith, horizon, and the glow round the sun. */
  skyTop: string;
  skyHorizon: string;
  sunGlow: string;
  /** 0 clear … 1 overcast. */
  clouds: number;
  cloudColor: string;
  stars: number;
  fog: string;
  /** Fog density (exponential, per m, scaled by the arena's size). */
  fogDensity: number;
  sun: string;
  sunIntensity: number;
  /** Degrees above the horizon, and the compass bearing (degrees). */
  sunElevation: number;
  sunAzimuth: number;
  /** The sun's disc in the sky (0 hides it: the moon at night is smaller and paler). */
  sunDisc: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  exposure: number;
  /** Rim light on the figures. */
  rim: string;
  rimStrength: number;
  saturation: number;
  contrast: number;
  warmth: number;
  vignette: number;
  bloom: number;
  threshold: number;
  /** Ground wetness (rain): 0 dry … 1 soaked. */
  wet: number;
}

const BASE: Record<ArenaId, Look> = {
  plains: {
    skyTop: "#2f7fe0", skyHorizon: "#cfe8ff", sunGlow: "#fff2d0", clouds: 0.38, cloudColor: "#ffffff", stars: 0,
    fog: "#c4def4", fogDensity: 0.55, sun: "#fff1d8", sunIntensity: 2.8, sunElevation: 36, sunAzimuth: 35, sunDisc: 1,
    hemiSky: "#bcdcff", hemiGround: "#5c7a3a", hemiIntensity: 1.0, exposure: 0.96, rim: "#fff4dc", rimStrength: 0.45,
    saturation: 1.14, contrast: 1.06, warmth: 0.02, vignette: 0.32, bloom: 0.2, threshold: 1.6, wet: 0,
  },
  volcano: {
    skyTop: "#160404", skyHorizon: "#d8501e", sunGlow: "#ff9a50", clouds: 0.7, cloudColor: "#4a2a24", stars: 0,
    fog: "#5a2216", fogDensity: 0.9, sun: "#ffd8b8", sunIntensity: 2.4, sunElevation: 30, sunAzimuth: 210, sunDisc: 0.25,
    hemiSky: "#ffb890", hemiGround: "#3a1a12", hemiIntensity: 1.1, exposure: 1.08, rim: "#ff9a5a", rimStrength: 0.75,
    saturation: 1.12, contrast: 1.1, warmth: 0.05, vignette: 0.4, bloom: 0.32, threshold: 1.25, wet: 0,
  },
  snowfield: {
    skyTop: "#6f93c4", skyHorizon: "#e4edf7", sunGlow: "#fff8ea", clouds: 0.55, cloudColor: "#f4f8ff", stars: 0,
    fog: "#dce6f0", fogDensity: 0.75, sun: "#fff8f0", sunIntensity: 2.3, sunElevation: 24, sunAzimuth: 150, sunDisc: 0.7,
    hemiSky: "#e0ecff", hemiGround: "#8ea3b8", hemiIntensity: 1.0, exposure: 0.9, rim: "#e8f2ff", rimStrength: 0.5,
    saturation: 1.08, contrast: 1.05, warmth: -0.03, vignette: 0.3, bloom: 0.18, threshold: 2.2, wet: 0,
  },
  colosseum: {
    skyTop: "#2c6cd0", skyHorizon: "#ffe2b8", sunGlow: "#fff0d0", clouds: 0.25, cloudColor: "#ffffff", stars: 0,
    fog: "#f0d8b4", fogDensity: 0.35, sun: "#fff0d6", sunIntensity: 2.8, sunElevation: 36, sunAzimuth: 120, sunDisc: 1,
    hemiSky: "#ffeedc", hemiGround: "#a08058", hemiIntensity: 1.0, exposure: 0.95, rim: "#fff0d8", rimStrength: 0.45,
    saturation: 1.06, contrast: 1.08, warmth: 0.0, vignette: 0.34, bloom: 0.18, threshold: 1.8, wet: 0,
  },
};

const mixHex = (a: string, b: string, k: number) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (p: number, s: number) => (p >> s) & 255;
  const m = (s: number) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * k);
  return `#${((m(16) << 16) | (m(8) << 8) | m(0)).toString(16).padStart(6, "0")}`;
};

/** The look for an arena at a time of day, in a weather. */
export function lookFor(arena: ArenaId, time: TimeOfDay, weather: Weather): Look {
  const l: Look = { ...BASE[arena] };
  if (time === "dusk") {
    Object.assign(l, {
      skyTop: arena === "volcano" ? "#12030a" : "#2a2c6a",
      skyHorizon: arena === "volcano" ? "#ff5a1e" : "#ff8a4a",
      sunGlow: "#ffb060",
      sun: "#ffb27a",
      sunIntensity: l.sunIntensity * 0.85,
      sunElevation: 9,
      sunDisc: 1.2,
      hemiSky: "#9a8ac8",
      hemiGround: mixHex(l.hemiGround, "#3a2030", 0.5),
      hemiIntensity: l.hemiIntensity * 0.75,
      fog: mixHex(l.fog, "#d88a6a", 0.6),
      cloudColor: "#ffb08a",
      rim: "#ffb070",
      rimStrength: 0.9,
      warmth: l.warmth + 0.06,
      exposure: l.exposure * 1.05,
      bloom: l.bloom + 0.08,
    });
  } else if (time === "night") {
    Object.assign(l, {
      skyTop: "#02040c",
      skyHorizon: arena === "volcano" ? "#5a1406" : "#16264a",
      sunGlow: "#8aa8ff",
      sun: "#a8c0ff",
      sunIntensity: 1.25,
      sunElevation: 38,
      sunDisc: 0.45,
      stars: 1,
      hemiSky: "#3a5088",
      hemiGround: "#141a28",
      hemiIntensity: 0.75,
      fog: arena === "volcano" ? "#2a0a06" : "#0c1426",
      cloudColor: "#2a3450",
      clouds: l.clouds * 0.6,
      rim: "#8ab0ff",
      rimStrength: 0.9,
      warmth: l.warmth - 0.05,
      exposure: l.exposure * 1.35,
      bloom: l.bloom + 0.14,
      threshold: Math.max(0.9, l.threshold * 0.6),
      saturation: l.saturation * 0.95,
    });
  }
  if (weather === "rain") {
    Object.assign(l, {
      skyTop: mixHex(l.skyTop, "#3a4250", 0.7),
      skyHorizon: mixHex(l.skyHorizon, "#7a8494", 0.7),
      sunGlow: mixHex(l.sunGlow, "#9aa4b4", 0.7),
      clouds: 1,
      cloudColor: mixHex(l.cloudColor, "#5a6270", 0.75),
      fog: mixHex(l.fog, "#6a7484", 0.65),
      fogDensity: l.fogDensity * 1.6,
      sunIntensity: l.sunIntensity * 0.45,
      sunDisc: 0,
      hemiIntensity: l.hemiIntensity * 1.05,
      hemiSky: mixHex(l.hemiSky, "#8a94a8", 0.5),
      saturation: l.saturation * 0.88,
      warmth: l.warmth - 0.05,
      contrast: l.contrast * 1.02,
      wet: 1,
      stars: 0,
    });
  } else if (weather === "sun") {
    Object.assign(l, {
      skyTop: mixHex(l.skyTop, "#1a6af0", 0.3),
      skyHorizon: mixHex(l.skyHorizon, "#fff0c0", 0.5),
      sunGlow: "#fff4c0",
      clouds: Math.min(l.clouds, 0.12),
      sun: mixHex(l.sun, "#fff0b0", 0.6),
      sunIntensity: l.sunIntensity * 1.35,
      sunElevation: Math.max(l.sunElevation, time === "dusk" ? 16 : 58),
      sunDisc: 2.2,
      exposure: l.exposure * 1.08,
      warmth: l.warmth + 0.08,
      saturation: l.saturation * 1.08,
      contrast: l.contrast * 1.05,
      bloom: l.bloom + 0.12,
      threshold: l.threshold * 0.85,
      fogDensity: l.fogDensity * 0.8,
      fog: mixHex(l.fog, "#fff0c8", 0.35),
    });
  } else if (weather === "sand") {
    Object.assign(l, {
      skyTop: mixHex(l.skyTop, "#a07040", 0.75),
      skyHorizon: mixHex(l.skyHorizon, "#d8a868", 0.8),
      sunGlow: "#ffd89a",
      clouds: 0.85,
      cloudColor: "#c89a68",
      fog: mixHex(l.fog, "#c8965a", 0.8),
      fogDensity: l.fogDensity * 2.6,
      sunIntensity: l.sunIntensity * 0.7,
      sunDisc: 0.35,
      sun: mixHex(l.sun, "#ffd8a0", 0.6),
      hemiSky: mixHex(l.hemiSky, "#e0b080", 0.6),
      warmth: l.warmth + 0.06,
      saturation: l.saturation * 0.9,
      stars: 0,
    });
  } else if (weather === "snow") {
    Object.assign(l, {
      skyTop: mixHex(l.skyTop, "#8a9ab0", 0.6),
      skyHorizon: mixHex(l.skyHorizon, "#e8eef6", 0.6),
      clouds: 0.95,
      cloudColor: mixHex(l.cloudColor, "#d8e0ea", 0.7),
      fog: mixHex(l.fog, "#dfe6ee", 0.7),
      fogDensity: l.fogDensity * 1.7,
      sunIntensity: l.sunIntensity * 0.6,
      sunDisc: 0.15,
      sun: mixHex(l.sun, "#f0f6ff", 0.6),
      hemiSky: mixHex(l.hemiSky, "#e8f0ff", 0.5),
      warmth: l.warmth - 0.06,
      saturation: l.saturation * 0.92,
      stars: 0,
    });
  }
  return l;
}

/**
 * The sky over a battle: its weather, terrain and time of day from the battle's field. ?tod= (day, dusk, night)
 * picks the time of day, which is only how it looks; ?wx= and ?tr= preview a weather's or a terrain's look on test
 * pages (?debug=1) only, since they change the battle's maths.
 */
export function envOf(spec: BattleSpec): { weather: unknown; time: unknown; terrain: unknown } {
  const f = spec.field;
  let weather: unknown = f?.weather, time: unknown = f?.time;
  let terrain: unknown = f?.terrain;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get("tod")) time = q.get("tod");
    if (q.get("debug") === "1" && q.get("wx")) weather = q.get("wx");
    if (q.get("debug") === "1" && q.get("tr")) terrain = q.get("tr");
  } catch {
    /* no address */
  }
  return { weather, time, terrain };
}
