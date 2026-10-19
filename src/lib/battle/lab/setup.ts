import { z } from "zod";
import { completeSet, fitSetToGen, MAX_IV, normalizeSet, STATS, type TeamSet } from "@/lib/battle/sets";
import {
  BOOST_IDS,
  doublesAllowed,
  EMPTY_SIDE_FIELD,
  isLabGen,
  isLabStrategy,
  LAB_STATUSES,
  LAB_TEAM_SIZE,
  LAB_TERRAINS,
  LAB_WEATHERS,
  sideFieldFor,
  terrainsFor,
  weathersFor,
  type BoostId,
  type LabMon,
  type LabSetup,
  type LabSide,
  type LabSideField,
  type LabStatus,
  type LabTerrain,
  type LabWeather,
} from "./types";

/**
 * Building, cleaning and sharing a Battle Lab setup. A share link carries
 * the whole setup in its query string: the setup as compact JSON (defaults
 * left out), deflated and base64url-encoded where the browser can, plain
 * base64url JSON otherwise. Decoding accepts either and trusts nothing.
 */

export function labMon(set: TeamSet, script: string[] = []): LabMon {
  return { set, script, hp: 100, status: "", boosts: {} };
}

export function emptySide(): LabSide {
  return { team: [], strategy: "smart", loop: false, field: { ...EMPTY_SIDE_FIELD } };
}

const iv = { hp: MAX_IV, atk: MAX_IV, def: MAX_IV, spa: MAX_IV, spd: MAX_IV, spe: MAX_IV };

/** The example matchup: Gen 4, a level 5 Piplup holding an Oran Berry against a level 5 Turtwig holding nothing. */
export function defaultSetup(): LabSetup {
  const piplup = completeSet({ species: "Piplup", level: 5, item: "Oran Berry", ability: "Torrent", nature: "Hardy", moves: ["Pound", "Growl", "Bubble"], ivs: iv });
  const turtwig = completeSet({ species: "Turtwig", level: 5, ability: "Overgrow", nature: "Hardy", moves: ["Tackle", "Withdraw"], ivs: iv });
  return {
    gen: 4,
    doubles: false,
    sides: [
      { ...emptySide(), team: [labMon(piplup)] },
      { ...emptySide(), team: [labMon(turtwig)] },
    ],
    weather: "",
    weatherTurns: 5,
    terrain: "",
    terrainTurns: 5,
  };
}

// ---------------------------------------------------------------------------
// Cleaning: whatever comes in (a link, storage), a setup the rules allow
// ---------------------------------------------------------------------------

const clampInt = (n: unknown, lo: number, hi: number, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;

function cleanBoosts(raw: unknown): Partial<Record<BoostId, number>> {
  const out: Partial<Record<BoostId, number>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const id of BOOST_IDS) {
    const v = clampInt((raw as Record<string, unknown>)[id], -6, 6, 0);
    if (v) out[id] = v;
  }
  return out;
}

function cleanMon(raw: unknown): LabMon | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const set = normalizeSet(r.set);
  if (!set) return null;
  const script = Array.isArray(r.script) ? r.script.filter((m): m is string => typeof m === "string" && m.length > 0 && m.length <= 60).slice(0, 8) : [];
  const status = (LAB_STATUSES as readonly unknown[]).includes(r.status) ? (r.status as LabStatus) : "";
  return { set, script, hp: clampInt(r.hp, 1, 100, 100), status, boosts: cleanBoosts(r.boosts) };
}

function cleanField(raw: unknown): LabSideField {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    stealthrock: r.stealthrock === true,
    spikes: clampInt(r.spikes, 0, 3, 0),
    toxicspikes: clampInt(r.toxicspikes, 0, 2, 0),
    stickyweb: r.stickyweb === true,
    reflect: r.reflect === true,
    lightscreen: r.lightscreen === true,
    auroraveil: r.auroraveil === true,
  };
}

function cleanSide(raw: unknown): LabSide {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const team = (Array.isArray(r.team) ? r.team : []).map(cleanMon).filter((m): m is LabMon => m !== null).slice(0, LAB_TEAM_SIZE);
  return { team, strategy: isLabStrategy(r.strategy) ? r.strategy : "smart", loop: r.loop === true, field: cleanField(r.field) };
}

/**
 * Keeps a setup to what its generation has: no doubles before Gen 3, no
 * Snow in Gen 4, no 3 layers of Gen 2 Spikes, no abilities or natures
 * before Gen 3, and Gen 1-2 DVs and stat experience as those games have
 * them (one Special, a derived HP DV)…
 */
export function fitToGen(setup: LabSetup): LabSetup {
  const { gen } = setup;
  const allowed = new Map(sideFieldFor(gen).map((f) => [f.key, f.layers]));
  const stats = (mon: LabMon): LabMon => ({ ...mon, set: fitSetToGen(mon.set, gen) });
  const field = (f: LabSideField): LabSideField => {
    const out = { ...EMPTY_SIDE_FIELD };
    for (const [key, layers] of allowed) {
      const v = f[key];
      (out as Record<string, number | boolean>)[key] = typeof v === "number" ? Math.min(layers, v) : v;
    }
    return out;
  };
  return {
    ...setup,
    doubles: setup.doubles && doublesAllowed(gen),
    weather: weathersFor(gen).includes(setup.weather) ? setup.weather : "",
    terrain: terrainsFor(gen).includes(setup.terrain) ? setup.terrain : "",
    sides: [
      { ...setup.sides[0], team: setup.sides[0].team.map(stats), field: field(setup.sides[0].field) },
      { ...setup.sides[1], team: setup.sides[1].team.map(stats), field: field(setup.sides[1].field) },
    ],
  };
}

/** A setup from untrusted data, or null if it isn't one. */
export function normalizeSetup(raw: unknown): LabSetup | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isLabGen(r.gen) || !Array.isArray(r.sides) || r.sides.length !== 2) return null;
  return fitToGen({
    gen: r.gen,
    doubles: r.doubles === true,
    sides: [cleanSide(r.sides[0]), cleanSide(r.sides[1])],
    weather: (LAB_WEATHERS as readonly unknown[]).includes(r.weather) ? (r.weather as LabWeather) : "",
    weatherTurns: clampInt(r.weatherTurns, 0, 8, 5),
    terrain: (LAB_TERRAINS as readonly unknown[]).includes(r.terrain) ? (r.terrain as LabTerrain) : "",
    terrainTurns: clampInt(r.terrainTurns, 0, 8, 5),
  });
}

/** Why the setup can't run yet (null when it can). */
export function setupProblem(setup: LabSetup): string | null {
  for (const s of [0, 1] as const) {
    const name = s === 0 ? "Side A" : "Side B";
    const team = setup.sides[s].team;
    if (!team.length) return `${name} needs a Pokémon.`;
    if (setup.doubles && team.length < 2) return `${name} needs two Pokémon for a double battle.`;
    const moveless = team.find((m) => !m.set.moves.filter(Boolean).length);
    if (moveless) return `${name}'s ${moveless.set.name || moveless.set.species} needs at least one move.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

/** A set with its defaults left out (completeSet puts them back). */
function compactSet(set: TeamSet): Record<string, unknown> {
  const out: Record<string, unknown> = { species: set.species, moves: set.moves };
  for (const key of ["name", "item", "ability", "nature", "gender", "teraType", "hpType", "pokeball"] as const) if (set[key]) out[key] = set[key];
  if (set.level !== 100) out.level = set.level;
  if (set.shiny) out.shiny = true;
  if (set.happiness !== undefined) out.happiness = set.happiness;
  if (set.dynamaxLevel !== undefined) out.dynamaxLevel = set.dynamaxLevel;
  if (set.gigantamax) out.gigantamax = true;
  const evs = Object.fromEntries(STATS.filter((s) => set.evs[s]).map((s) => [s, set.evs[s]]));
  if (Object.keys(evs).length) out.evs = evs;
  const ivs = Object.fromEntries(STATS.filter((s) => set.ivs[s] !== MAX_IV).map((s) => [s, set.ivs[s]]));
  if (Object.keys(ivs).length) out.ivs = ivs;
  return out;
}

function compactSide(side: LabSide): Record<string, unknown> {
  const out: Record<string, unknown> = {
    team: side.team.map((m) => {
      const mon: Record<string, unknown> = { set: compactSet(m.set) };
      if (m.script.length) mon.script = m.script;
      if (m.hp !== 100) mon.hp = m.hp;
      if (m.status) mon.status = m.status;
      if (Object.keys(m.boosts).length) mon.boosts = m.boosts;
      return mon;
    }),
  };
  if (side.strategy !== "smart") out.strategy = side.strategy;
  if (side.loop) out.loop = true;
  const field = Object.fromEntries(Object.entries(side.field).filter(([, v]) => v));
  if (Object.keys(field).length) out.field = field;
  return out;
}

/** The setup as compact JSON. */
export function setupJson(setup: LabSetup): string {
  const out: Record<string, unknown> = { gen: setup.gen, sides: setup.sides.map(compactSide) };
  if (setup.doubles) out.doubles = true;
  if (setup.weather) Object.assign(out, { weather: setup.weather, weatherTurns: setup.weatherTurns });
  if (setup.terrain) Object.assign(out, { terrain: setup.terrain, terrainTurns: setup.terrainTurns });
  return JSON.stringify(out);
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

const canDeflate = () => typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";

/** The setup for a share link's `setup=` parameter: "z…" deflated, "j…" plain. */
export async function encodeSetup(setup: LabSetup): Promise<string> {
  const json = new TextEncoder().encode(setupJson(setup));
  if (canDeflate()) {
    try {
      return `z${toBase64Url(await pipe(json, new CompressionStream("deflate-raw")))}`;
    } catch {
      // fall through to plain
    }
  }
  return `j${toBase64Url(json)}`;
}

/** A `setup=` parameter back to a setup; null for anything that isn't one. */
export async function decodeSetup(text: string): Promise<LabSetup | null> {
  if (!text || text.length > 20_000 || !/^[zj][A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    let bytes = fromBase64Url(text.slice(1));
    if (text[0] === "z") {
      if (!canDeflate()) return null;
      bytes = await pipe(bytes, new DecompressionStream("deflate-raw"));
    }
    return normalizeSetup(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/** Run settings that travel with a link: how many battles, and the master seed. */
export const runSettingsSchema = z.object({
  runs: z.coerce.number().int().min(1).max(50_000).optional(),
  seed: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).optional(),
});

/** The page's query string for a setup (and, to reproduce a run, its size and seed). */
export async function labQuery(setup: LabSetup, run?: { runs: number; seed: string }): Promise<string> {
  const params = new URLSearchParams({ setup: await encodeSetup(setup) });
  if (run) {
    params.set("runs", String(run.runs));
    params.set("seed", run.seed);
  }
  return params.toString();
}
