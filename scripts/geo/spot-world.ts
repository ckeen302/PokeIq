/**
 * PokéGuessr exact spots: the sprite games' own overworld layouts, so a spot
 * on one place's map rip can be carried onto our atlas by a piecewise fit
 * with many control points (scripts/geo/spot-warp.ts).
 *
 * The overworld of Red / Blue / Yellow, Gold / Silver / Crystal, Ruby /
 * Sapphire / Emerald and FireRed / LeafGreen is a set of rectangular maps
 * joined edge to edge by "connections" (north / south / west / east, with an
 * offset along the shared edge). The pret disassemblies (github.com/pret:
 * pokered, pokecrystal, pokeemerald, pokefirered) list every map's size and
 * connections, so laying the maps out from one of them gives each map its
 * place in one continuous game world (native pixels: a Game Boy block is
 * 32 px, a Game Boy Advance metatile 16 px). Every connection is then a
 * control point: the middle of the edge two places share in the game, and
 * where the same two places meet on our atlas.
 *
 * Files come from raw.githubusercontent.com (plain GETs, a few at a time) and
 * are cached outside the repo.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type PretGame = "red" | "crystal" | "emerald" | "firered";
export type Dir = "north" | "south" | "west" | "east";

export interface GameMap {
  /** pret's map name (Route110, OneIsland_KindleRoad, VioletCity). */
  name: string;
  /** Size in native pixels. */
  w: number;
  h: number;
  conns: {
    to: string;
    dir: Dir;
    /** Native px along the shared edge: the target's left (north / south) or top (west / east) relative to this map's. */ offset: number;
  }[];
  /** Doors and cave mouths: where (native px from the map's top-left, the tile's middle) and pret's name for the map they lead to (MT_MOON_1F, MAP_ROUTE2_VIRIDIAN_FOREST_SOUTH_ENTRANCE). */
  warps: { at: [number, number]; dest: string }[];
  /** Placed in the game world (native px); maps joined by connections share a component. */
  x: number;
  y: number;
  comp: number;
}

const REPO: Record<PretGame, string> = {
  red: "pokered",
  crystal: "pokecrystal",
  emerald: "pokeemerald",
  firered: "pokefirered",
};
const RAW = (game: PretGame, file: string) => `https://raw.githubusercontent.com/pret/${REPO[game]}/master/${file}`;
/** Native px per unit of map size (Game Boy blocks, Game Boy Advance metatiles). */
const UNIT: Record<PretGame, number> = {
  red: 32,
  crystal: 32,
  emerald: 16,
  firered: 16,
};

const curl = (url: string, file: string) => new Promise<boolean>((resolve) => execFile("curl", ["-sS", "-f", "-m", "60", "-o", file, url], (err) => resolve(!err)));

const camel = (constant: string) =>
  constant
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");

/** Downloads what loadWorld needs into `<cache>/pret/<game>/` (skips files already there). */
export async function fetchPret(cache: string, game: PretGame) {
  const dir = path.join(cache, "pret", game);
  mkdirSync(dir, { recursive: true });
  const get = async (file: string, out = path.join(dir, file.replace(/\//g, "__"))) => (existsSync(out) ? true : curl(RAW(game, file), out));
  const many = async (files: string[]) => {
    for (let i = 0; i < files.length; i += 6) await Promise.all(files.slice(i, i + 6).map((f) => get(f)));
  };
  if (game === "crystal") {
    await get("data/maps/attributes.asm");
    await get("constants/map_constants.asm");
    // The outdoor maps' events (their warps): every map with a connection.
    const attrs = readFileSync(path.join(dir, "data__maps__attributes.asm"), "utf8");
    const outdoor = [...attrs.matchAll(/\tmap_attributes (\w+), \w+, \$\w+\n\tconnection/g)].map((m) => m[1]);
    await many(outdoor.map((n) => `maps/${n}.asm`));
  } else if (game === "red") {
    await get("constants/map_constants.asm");
    const consts = readFileSync(path.join(dir, "constants__map_constants.asm"), "utf8");
    // The overworld: towns and routes come first, up to the first indoor map.
    const names: string[] = [];
    for (const m of consts.matchAll(/map_const (\w+),\s+(\d+),\s+(\d+)/g)) {
      if (m[1] === "REDS_HOUSE_1F") break;
      if (Number(m[2]) > 0) names.push(camel(m[1]));
    }
    await many(names.map((n) => `data/maps/headers/${n}.asm`));
    await many(names.map((n) => `data/maps/objects/${n}.asm`));
  } else {
    await get("data/maps/map_groups.json");
    await get("data/layouts/layouts.json");
    const groups = JSON.parse(readFileSync(path.join(dir, "data__maps__map_groups.json"), "utf8")) as Record<string, string[]>;
    const names = ["gMapGroup_TownsAndRoutes", "gMapGroup_Dungeons", "gMapGroup_SpecialArea"].flatMap((g) => groups[g] ?? []);
    await many(names.map((n) => `data/maps/${n}/map.json`));
  }
}

const DIRS: Record<string, Dir> = {
  north: "north",
  south: "south",
  west: "west",
  east: "east",
  up: "north",
  down: "south",
  left: "west",
  right: "east",
};

/** The game's maps with their sizes and connections, laid out (see the top of the file). */
export function loadWorld(cache: string, game: PretGame): Map<string, GameMap> {
  const dir = path.join(cache, "pret", game);
  const read = (file: string) => readFileSync(path.join(dir, file.replace(/\//g, "__")), "utf8");
  const u = UNIT[game];
  const maps = new Map<string, GameMap>();
  const add = (name: string, w: number, h: number) =>
    maps.set(name, {
      name,
      w: w * u,
      h: h * u,
      conns: [],
      warps: [],
      x: NaN,
      y: NaN,
      comp: -1,
    });
  /** A warp's tile → native px (Game Boy warps count 16 px steps, GBA ones 16 px metatiles). */
  const warpAt = (x: number, y: number): [number, number] => [x * 16 + 8, y * 16 + 8];
  if (game === "red" || game === "crystal") {
    const sizes = new Map<string, [number, number]>();
    for (const m of read("constants/map_constants.asm").matchAll(/map_const (\w+),\s+(\d+),\s+(\d+)/g)) sizes.set(m[1], [Number(m[2]), Number(m[3])]);
    // Each map's block: its header line, then its connection lines.
    const blocks: { name: string; id: string; body: string }[] = [];
    if (game === "crystal") {
      for (const b of read("data/maps/attributes.asm").split(/\n(?=\tmap_attributes )/)) {
        const m = b.match(/^\tmap_attributes (\w+), (\w+),/);
        if (m) blocks.push({ name: m[1], id: m[2], body: b });
      }
    } else {
      for (const f of [...sizes.keys()].map(camel)) {
        const file = path.join(dir, `data__maps__headers__${f}.asm`);
        if (!existsSync(file)) continue;
        const body = readFileSync(file, "utf8");
        const m = body.match(/map_header (\w+), (\w+),/);
        if (m) blocks.push({ name: m[1], id: m[2], body });
      }
    }
    const nameOfId = new Map(blocks.map((b) => [b.id, b.name]));
    for (const b of blocks) {
      const s = sizes.get(b.id);
      if (s && s[0] > 0) add(b.name, s[0], s[1]);
    }
    for (const b of blocks) {
      const map = maps.get(b.name);
      if (!map) continue;
      const events = path.join(dir, game === "crystal" ? `maps__${b.name}.asm` : `data__maps__objects__${b.name}.asm`);
      if (existsSync(events))
        for (const w of readFileSync(events, "utf8").matchAll(/^\twarp_event\s+(\d+),\s+(\d+),\s+(\w+)/gm))
          map.warps.push({
            at: warpAt(Number(w[1]), Number(w[2])),
            dest: w[3],
          });
      for (const c of b.body.matchAll(/^\tconnection (north|south|west|east), (\w+), (\w+), (-?\d+)/gm)) {
        const to = nameOfId.get(c[3]) ?? c[2];
        map.conns.push({ to, dir: c[1] as Dir, offset: Number(c[4]) * u });
      }
    }
  } else {
    const layouts = new Map<string, { width: number; height: number }>();
    for (const l of (
      JSON.parse(read("data/layouts/layouts.json")) as {
        layouts: { id: string; width: number; height: number }[];
      }
    ).layouts)
      if (l?.id) layouts.set(l.id, l);
    const groups = JSON.parse(read("data/maps/map_groups.json")) as Record<string, string[]>;
    const names = ["gMapGroup_TownsAndRoutes", "gMapGroup_Dungeons", "gMapGroup_SpecialArea"].flatMap((g) => groups[g] ?? []);
    const nameOfId = new Map<string, string>();
    const raw: {
      name: string;
      json: {
        id: string;
        layout: string;
        connections?: { map: string; offset: number; direction: string }[] | null;
        warp_events?: { x: number; y: number; dest_map: string }[];
      };
    }[] = [];
    for (const n of names) {
      const file = path.join(dir, `data__maps__${n}__map.json`);
      if (!existsSync(file)) continue;
      const json = JSON.parse(readFileSync(file, "utf8"));
      raw.push({ name: n, json });
      nameOfId.set(json.id, n);
      const l = layouts.get(json.layout);
      if (l) add(n, l.width, l.height);
    }
    for (const { name, json } of raw) {
      const map = maps.get(name);
      if (!map) continue;
      for (const w of json.warp_events ?? []) map.warps.push({ at: warpAt(w.x, w.y), dest: w.dest_map });
      for (const c of json.connections ?? []) {
        const dir2 = DIRS[c.direction];
        const to = nameOfId.get(c.map);
        if (dir2 && to) map.conns.push({ to, dir: dir2, offset: c.offset * u });
      }
    }
  }
  layout(maps);
  return maps;
}

/** Where `to` sits given `from`'s place and their connection. */
function placeFrom(from: GameMap, to: GameMap, c: GameMap["conns"][number]): [number, number] {
  if (c.dir === "north") return [from.x + c.offset, from.y - to.h];
  if (c.dir === "south") return [from.x + c.offset, from.y + from.h];
  if (c.dir === "west") return [from.x - to.w, from.y + c.offset];
  return [from.x + from.w, from.y + c.offset];
}

/** Lays every connected group of maps out from its first map (breadth first); a connection that disagrees with the layout is dropped. */
function layout(maps: Map<string, GameMap>) {
  let comp = 0;
  for (const start of maps.values()) {
    if (start.comp >= 0 || !start.conns.length) continue;
    start.x = 0;
    start.y = 0;
    start.comp = comp;
    const queue = [start];
    while (queue.length) {
      const a = queue.shift()!;
      for (const c of a.conns) {
        const b = maps.get(c.to);
        if (!b) continue;
        const [x, y] = placeFrom(a, b, c);
        if (b.comp < 0) {
          [b.x, b.y, b.comp] = [x, y, comp];
          queue.push(b);
        } else if (b.x !== x || b.y !== y) {
          c.offset = NaN;
        }
      }
    }
    comp++;
  }
  for (const m of maps.values()) m.conns = m.conns.filter((c) => Number.isFinite(c.offset));
}

/** The box of several maps (game-world px: left, top, width, height). */
export function unionRect(maps: GameMap[]): [number, number, number, number] {
  const x0 = Math.min(...maps.map((m) => m.x));
  const y0 = Math.min(...maps.map((m) => m.y));
  const x1 = Math.max(...maps.map((m) => m.x + m.w));
  const y1 = Math.max(...maps.map((m) => m.y + m.h));
  return [x0, y0, x1 - x0, y1 - y0];
}

/**
 * A place's connections to other places, as edges of its maps: the side,
 * the edge's coordinate and its extent along the side (game-world px), and
 * the neighbouring place. Connections between two maps of the same place
 * are left out.
 */
export function placeEdges(world: Map<string, GameMap>, maps: GameMap[], placeOfMap: (name: string) => string | undefined, self: string) {
  const out: {
    neighbour: string;
    side: Dir;
    edge: number;
    from: number;
    to: number;
  }[] = [];
  for (const m of maps)
    for (const c of m.conns) {
      const b = world.get(c.to);
      const other = b && placeOfMap(b.name);
      if (!b || !other || other === self) continue;
      const ns = c.dir === "north" || c.dir === "south";
      const [from, to] = ns ? [Math.max(m.x, b.x), Math.min(m.x + m.w, b.x + b.w)] : [Math.max(m.y, b.y), Math.min(m.y + m.h, b.y + b.h)];
      if (to <= from) continue;
      const edge = c.dir === "north" ? m.y : c.dir === "south" ? m.y + m.h : c.dir === "west" ? m.x : m.x + m.w;
      out.push({ neighbour: other, side: c.dir, edge, from, to });
    }
  return out;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * A place's doors and cave mouths that lead to one of `places` (game-world
 * px, averaged per place): a warp leads to a place when pret's name for the
 * map it opens (or the gate before it: ROUTE_2_VIRIDIAN_FOREST_SOUTH_GATE)
 * names the place (Mt. Moon for MT_MOON_1F). The longest name wins.
 */
export function placeWarps(maps: GameMap[], places: { key: string; name: string }[]): { place: string; at: [number, number]; n: number }[] {
  const names = places
    .map((p) => ({
      ...p,
      sq: squash(p.name.replace(/^Mt\. /, "Mt ").replace(/'/g, "")),
    }))
    .sort((a, b) => b.sq.length - a.sq.length);
  const acc = new Map<string, { sx: number; sy: number; n: number }>();
  for (const m of maps)
    for (const w of m.warps) {
      const dest = squash(w.dest.replace(/^MAP_/, ""));
      // The name, not followed by a digit (Route 1 isn't ROUTE_12_GATE).
      const hit = names.find((p) => p.sq.length >= 5 && new RegExp(`${p.sq}(?![0-9])`).test(dest));
      if (!hit) continue;
      const a = acc.get(hit.key) ?? { sx: 0, sy: 0, n: 0 };
      acc.set(hit.key, {
        sx: a.sx + m.x + w.at[0],
        sy: a.sy + m.y + w.at[1],
        n: a.n + 1,
      });
    }
  return [...acc].map(([place, a]) => ({
    place,
    at: [a.sx / a.n, a.sy / a.n],
    n: a.n,
  }));
}

/**
 * pret's maps for one of our places (a place can be several maps: Route 21
 * North and South, Saffron City and its connection strip). Matched on the
 * name with any island prefix dropped (OneIsland_KindleRoad is Kindle Road).
 */
export function mapsForPlace(world: Map<string, GameMap>, place: string): GameMap[] {
  const want = squash(place.replace(/^Mt\. /, "Mt ").replace(/\bIsle\b/, "Island"));
  const alias: Record<string, string[]> = {
    mtember: ["MtEmber_Exterior"],
    canyonentrance: ["SevenIsland_SevaultCanyon_Entrance"],
    fiveislemeadow: ["FiveIsland_Meadow"],
    fiveislandmeadow: ["FiveIsland_Meadow"],
    threeisleport: ["ThreeIsland_Port"],
    threeislandport: ["ThreeIsland_Port"],
    indigoplateau: ["IndigoPlateau_Exterior", "IndigoPlateau"],
    saffroncity: ["SaffronCity", "SaffronCity_Connection"],
    mtpyre: ["MtPyre_Exterior", "MtPyre_Summit"],
    battlefrontier: ["BattleFrontier_OutsideWest", "BattleFrontier_OutsideEast"],
    safarizone: [
      "SafariZone_Southwest",
      "SafariZone_South",
      "SafariZone_Southeast",
      "SafariZone_Northwest",
      "SafariZone_North",
      "SafariZone_Northeast",
      "SafariZone_Center",
      "SafariZone_East",
      "SafariZone_West",
    ],
  };
  const out: GameMap[] = [];
  for (const n of alias[want] ?? []) if (world.has(n)) out.push(world.get(n)!);
  if (out.length) return out;
  for (const m of world.values()) {
    const short = squash(m.name.replace(/^(One|Two|Three|Four|Five|Six|Seven)Island_/, ""));
    const full = squash(m.name);
    if (short === want || full === want || full === `${want}north` || full === `${want}south`) out.push(m);
  }
  return out;
}
