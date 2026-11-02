import { effectiveness as chart, type PokemonType } from "@/lib/pokemon/type-matrix";
import { CONTACT_REACH, DT, EV, EVENT_INTS, MAX_SECONDS, RANGED_REACH, ROUND_TICKS, SPREAD_REACH, TICK_HZ } from "./constants";
import { DamageTable, type HitEntry, type HitState } from "./damage";
import { placeArmies } from "./formation";
import { expectedHitsOf } from "./moves";
import { battleStats, bodyMass, bodyRadius, runSpeed } from "./stats";
import type { BattleLevel, BattleOutcome, BattleSpec, Formation, MBMove, MBSpecies, Roster, Winner } from "./types";

/**
 * The Mass Battle simulation: thousands of Pokémon on an open field, every
 * hit worked out with the games' damage formula (see damage.ts).
 *
 * Rounds, like turns in the games: every Pokémon acts once a round (three
 * seconds of battle time). Within a round, priority moves go first, then
 * higher Speed (the battle stat), with ties broken at random, so the
 * actions are spread over the round in that order. A Pokémon picks, each
 * time it acts, the move that does the most expected damage (accuracy ×
 * average damage, over every foe a spread move would hit, never more than
 * the HP they have left) among the moves it can reach its target with.
 * Accuracy, critical hits (1 in 24, more for high-critical moves), the
 * 16 damage rolls, multi-hit counts, recoil, drain and Life Orb all follow
 * the games.
 *
 * Positioning is this page's own addition: Pokémon run at 10 m/s per 100
 * base Speed towards the nearest foe they can hurt; a move that makes
 * contact needs them next to it, any other move reaches 6 m; spread moves
 * (Earthquake, Surf…) hit every foe within 3 m of the user's body; bodies
 * push each other apart (heavier ones push harder) and a hit knocks its
 * target back by its damage over the target's weight.
 *
 * Struct-of-arrays in typed arrays, a uniform grid for neighbours and a
 * coarse one for finding foes, no allocation per tick: 10,000 units run
 * well inside real time. Deterministic: the same battle and seed play out
 * the same way, hit for hit.
 */

export { CONTACT_REACH, DT, EV, EVENT_INTS, MAX_SECONDS, RANGED_REACH, ROUND_TICKS, SPREAD_REACH, TICK_HZ };

/** Actions are spread over the first ticks of a round, fastest first. */
const ACT_TICKS = 50;
/** Coarse cells searched around a unit for its nearest foe; beyond them it heads for the other army's beacons. */
const LOCAL_RINGS = 4;
const BEACONS = 96;
/** Knockback: m/s per point of damage per kg, capped. */
const KNOCK = 1.1;
const KNOCK_MAX = 6;
const KNOCK_DECAY = 5;


/** The battle's species and their moves, resolved from the roster for this level. */
export interface Prepared {
  species: MBSpecies[];
  moves: MBMove[][];
  level: BattleLevel;
  /** Units per side, species by species: [species index, count]. */
  armies: [[number, number][], [number, number][]];
  formations: [Formation, Formation];
  seed: number;
}

/** Turns a battle spec into the species list and armies the engine uses. */
export function prepare(roster: Roster, spec: BattleSpec): Prepared {
  const byId = new Map(roster.species.map((s) => [s.id, s]));
  const species: MBSpecies[] = [];
  const index = new Map<number, number>();
  const armies: [[number, number][], [number, number][]] = [[], []];
  spec.sides.forEach((army, s) => {
    for (const u of army.units) {
      const sp = byId.get(u.id);
      if (!sp || u.count <= 0) continue;
      let k = index.get(u.id);
      if (k === undefined) {
        k = species.length;
        species.push(sp);
        index.set(u.id, k);
      }
      armies[s].push([k, Math.floor(u.count)]);
    }
  });
  const moves = species.map((s) => (s.moves[spec.level] ?? []).map((i) => roster.moves[i]));
  return { species, moves, level: spec.level, armies, formations: [spec.sides[0].formation, spec.sides[1].formation], seed: spec.seed >>> 0 };
}

const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Per-species numbers the engine reads every tick. */
interface SpeciesRow {
  maxHp: number;
  spe: number;
  radius: number;
  mass: number;
  vmax: number;
  ability: string;
  item: string;
  /** Crit stage bonus (Super Luck). */
  critBoost: number;
  /** No critical hits against it (Battle Armor, Shell Armor). */
  critImmune: boolean;
  /** Survives a hit from full HP with 1 HP (Sturdy). */
  sturdy: boolean;
  noRecoil: boolean;
  magicGuard: boolean;
  noGuard: boolean;
  accMul: number;
  /** Physical moves' accuracy multiplier (Hustle). */
  physAccMul: number;
  skillLink: boolean;
  loadedDice: boolean;
  lifeOrb: boolean;
}

export interface BattleStats {
  /** Most KOs by one unit, and that unit. */
  mvp: number;
  mvpKos: number;
  /** The biggest single hit: damage, attacker, target, move slot, crit. */
  big: { damage: number; actor: number; target: number; slot: number; crit: boolean } | null;
}

export class Battle {
  readonly prep: Prepared;
  readonly table: DamageTable;
  readonly n: number;
  readonly arena: number;
  readonly rows: SpeciesRow[];
  readonly sp: Uint16Array;
  readonly side: Uint8Array;
  readonly x: Float64Array;
  readonly z: Float64Array;
  /** Movement this tick (m/s), for drawing. */
  readonly vx: Float32Array;
  readonly vz: Float32Array;
  private kx: Float64Array;
  private kz: Float64Array;
  /** How far the crowd pushed each unit lately (decaying), so it stops pressing into it. */
  private lx: Float64Array;
  private lz: Float64Array;
  readonly hp: Int32Array;
  readonly alive: Uint8Array;
  readonly target: Int32Array;
  /** Planned move slot against the target (for priority and how close to go). */
  private plan: Int8Array;
  private actTick: Int32Array;
  readonly kos: Int32Array;
  readonly dealt: Float64Array;
  /** Tick each unit fainted, −1 while it stands. */
  readonly faintTick: Int32Array;
  tick = 0;
  ended = false;
  /** Set when both armies fall to the same move (recoil): that move's side wins. */
  private lastBlow = -1;
  winner: Winner = 2;
  readonly left: [number, number] = [0, 0];
  readonly sideKos: [number, number] = [0, 0];
  readonly sideDealt: [number, number] = [0, 0];
  readonly start: [number, number] = [0, 0];
  private bigHit: BattleStats["big"] = null;
  /** This tick's events (EVENT_INTS each). */
  events: Int32Array = new Int32Array(EVENT_INTS * 256);
  eventCount = 0;
  private actionId = 0;
  private rng: number;
  // Turn order for the current round.
  private order: Int32Array;
  private orderLen = 0;
  private orderAt = 0;
  private keys: Float64Array;
  // Grids.
  private cell: number;
  private cols: number;
  private cellStart: Int32Array;
  private cellItems: Int32Array;
  private cellOf: Int32Array;
  private bigUnits: Int32Array;
  private bigCount = 0;
  private small: Uint8Array;
  private coarse: number;
  private ccols: number;
  private cStart: Int32Array;
  private cItems: Int32Array;
  private cx: Float64Array;
  private cz: Float64Array;
  /** canHurt[a * S + d]: species a has a move that can damage species d. */
  private canHurt: Uint8Array;
  private aliveBySpecies: Int32Array;
  /** 1 while a unit is heading for a far beacon rather than a foe near it. */
  private far: Uint8Array;
  private beacons: [Int32Array, Int32Array] = [new Int32Array(BEACONS), new Int32Array(BEACONS)];
  private beaconCount: [number, number] = [0, 0];
  private state: HitState = { crit: false, spread: false, aHp: 1, aMax: 1, dHp: 1, dMax: 1 };
  private scratch: Int32Array = new Int32Array(1024);

  constructor(prep: Prepared, table?: DamageTable) {
    this.prep = prep;
    this.table = table ?? new DamageTable(prep.species, prep.moves, prep.level);
    this.rng = (prep.seed ^ 0x9e3779b9) >>> 0;
    const S = prep.species.length;
    this.rows = prep.species.map((s) => {
      const st = battleStats(s, prep.level);
      const ab = toId(s.ability);
      const it = toId(s.item);
      return {
        maxHp: st.hp,
        spe: st.spe,
        radius: bodyRadius(s),
        mass: bodyMass(s.kg),
        vmax: runSpeed(s.base.spe),
        ability: ab,
        item: it,
        critBoost: ab === "superluck" ? 1 : 0,
        critImmune: ab === "battlearmor" || ab === "shellarmor",
        sturdy: ab === "sturdy",
        noRecoil: ab === "rockhead" || ab === "magicguard",
        magicGuard: ab === "magicguard",
        noGuard: ab === "noguard",
        accMul: ab === "compoundeyes" ? 1.3 : 1,
        physAccMul: ab === "hustle" ? 0.8 : 1,
        skillLink: ab === "skilllink",
        loadedDice: it === "loadeddice",
        lifeOrb: it === "lifeorb",
      };
    });
    // Units, army by army, species by species.
    let n = 0;
    for (const army of prep.armies) for (const [, c] of army) n += c;
    this.n = n;
    this.sp = new Uint16Array(n);
    this.side = new Uint8Array(n);
    let k = 0;
    prep.armies.forEach((army, s) => {
      for (const [spi, c] of army) for (let j = 0; j < c; j++) { this.sp[k] = spi; this.side[k] = s; k++; }
    });
    const radius = new Float64Array(n);
    for (let i = 0; i < n; i++) radius[i] = this.rows[this.sp[i]].radius;
    const place = placeArmies(radius, this.side, prep.formations, () => this.random());
    this.x = place.x;
    this.z = place.z;
    this.arena = place.arena;
    this.vx = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.kx = new Float64Array(n);
    this.kz = new Float64Array(n);
    this.lx = new Float64Array(n);
    this.lz = new Float64Array(n);
    this.hp = new Int32Array(n);
    this.alive = new Uint8Array(n);
    this.target = new Int32Array(n).fill(-1);
    this.plan = new Int8Array(n).fill(-1);
    this.actTick = new Int32Array(n).fill(-1);
    this.kos = new Int32Array(n);
    this.dealt = new Float64Array(n);
    this.faintTick = new Int32Array(n).fill(-1);
    this.order = new Int32Array(n);
    this.keys = new Float64Array(n);
    this.aliveBySpecies = new Int32Array(S);
    for (let i = 0; i < n; i++) {
      this.hp[i] = this.rows[this.sp[i]].maxHp;
      this.alive[i] = 1;
      this.left[this.side[i]]++;
      this.aliveBySpecies[this.sp[i]]++;
    }
    this.start[0] = this.left[0];
    this.start[1] = this.left[1];
    // Damage between the sides, worked out before the first round.
    const sideSpecies = (s: number) => [...new Set(prep.armies[s].map(([spi]) => spi))];
    this.table.warm(sideSpecies(0), sideSpecies(1));
    this.canHurt = new Uint8Array(S * S);
    for (const a of sideSpecies(0)) for (const d of sideSpecies(1)) this.canHurt[a * S + d] = this.table.canDamage(a, d) ? 1 : 0;
    for (const a of sideSpecies(1)) for (const d of sideSpecies(0)) this.canHurt[a * S + d] = this.table.canDamage(a, d) ? 1 : 0;
    // Grids: fine cells sized for most bodies (bigger ones are checked on their own), coarse cells for finding foes.
    const radii = Array.from(radius).sort((a, b) => a - b);
    const rSmall = radii.length ? radii[Math.min(radii.length - 1, Math.floor(radii.length * 0.85))] : 0.5;
    this.cell = Math.max(0.5, 2 * rSmall);
    this.cols = Math.max(1, Math.ceil((2 * this.arena) / this.cell));
    this.cellStart = new Int32Array(this.cols * this.cols + 1);
    this.cellItems = new Int32Array(n);
    this.cellOf = new Int32Array(n);
    this.small = new Uint8Array(n);
    let big = 0;
    for (let i = 0; i < n; i++) {
      if (radius[i] * 2 <= this.cell + 1e-9) this.small[i] = 1;
      else big++;
    }
    this.bigUnits = new Int32Array(big);
    // Coarse cells hold a couple of dozen units of a packed army, so a search for a foe reads few of them.
    const rMid = radii.length ? radii[Math.floor(radii.length / 2)] : 0.5;
    this.coarse = Math.max(1, Math.max(this.cell, 2 * rMid * 1.35) * 4.5);
    this.ccols = Math.max(1, Math.ceil((2 * this.arena) / this.coarse));
    // One coarse grid per side (side B's cells after side A's), so a search reads only foes.
    this.cStart = new Int32Array(2 * this.ccols * this.ccols + 1);
    this.cItems = new Int32Array(n);
    this.cx = new Float64Array(n);
    this.cz = new Float64Array(n);
    this.far = new Uint8Array(n);
    this.rebuildGrids();
    this.refreshBeacons();
    for (let i = 0; i < n; i++) this.target[i] = this.findTarget(i);
  }

  /** Seeded uniform [0, 1) (mulberry32). */
  random(): number {
    this.rng = (this.rng + 0x6d2b79f5) >>> 0;
    let t = this.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  get seconds() {
    return this.tick / TICK_HZ;
  }

  // -------------------------------------------------------------------------
  // Grids
  // -------------------------------------------------------------------------

  private cellIndex(x: number, z: number, size: number, cols: number): number {
    const a = this.arena;
    const cx = Math.min(cols - 1, Math.max(0, Math.floor((x + a) / size)));
    const cz = Math.min(cols - 1, Math.max(0, Math.floor((z + a) / size)));
    return cz * cols + cx;
  }

  private rebuildGrids() {
    const { n, alive, x, z } = this;
    const fine = this.cellStart, coarse = this.cStart;
    fine.fill(0);
    coarse.fill(0);
    this.bigCount = 0;
    const cOf = this.cellOf;
    const cells = this.ccols * this.ccols;
    // Counting sort into cells (fine for small bodies, coarse per side for everyone).
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      if (this.small[i]) {
        const c = this.cellIndex(x[i], z[i], this.cell, this.cols);
        cOf[i] = c;
        fine[c + 1]++;
      } else {
        this.bigUnits[this.bigCount++] = i;
      }
      coarse[this.side[i] * cells + this.cellIndex(x[i], z[i], this.coarse, this.ccols) + 1]++;
    }
    for (let c = 1; c < fine.length; c++) fine[c] += fine[c - 1];
    for (let c = 1; c < coarse.length; c++) coarse[c] += coarse[c - 1];
    const fillF = this.scratchFill(fine.length);
    if (!this.fillC || this.fillC.length < coarse.length) this.fillC = new Int32Array(coarse.length);
    const fillC = this.fillC;
    fillC.fill(0);
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      if (this.small[i]) {
        const c = cOf[i];
        this.cellItems[fine[c] + fillF[c]++] = i;
      }
      const cc = this.side[i] * cells + this.cellIndex(x[i], z[i], this.coarse, this.ccols);
      this.cItems[coarse[cc] + fillC[cc]++] = i;
    }
  }

  private fillBuf: Int32Array | null = null;
  private fillC: Int32Array | null = null;
  private scratchFill(len: number): Int32Array {
    if (!this.fillBuf || this.fillBuf.length < len) this.fillBuf = new Int32Array(len);
    else this.fillBuf.fill(0, 0, len);
    return this.fillBuf;
  }

  /** The nearest foe `i` can hurt (or the nearest foe at all), −1 if none is left. */
  findTarget(i: number): number {
    const S = this.prep.species.length;
    const mySide = this.side[i], row = this.sp[i] * S;
    const xi = this.x[i], zi = this.z[i];
    const cols = this.ccols, size = this.coarse, a = this.arena;
    const px = xi + a, pz = zi + a;
    const ccx = Math.min(cols - 1, Math.max(0, Math.floor(px / size)));
    const ccz = Math.min(cols - 1, Math.max(0, Math.floor(pz / size)));
    let best = -1, bestD = Infinity, fallback = -1, fallbackD = Infinity;
    const { cStart, cItems, alive, sp, x, z, canHurt } = this;
    const base = (1 - mySide) * cols * cols;
    const scan = (gx: number, gz: number) => {
      // Skip a cell that can't hold anything nearer than what's been found.
      const bx = px < gx * size ? gx * size - px : px > (gx + 1) * size ? px - (gx + 1) * size : 0;
      const bz = pz < gz * size ? gz * size - pz : pz > (gz + 1) * size ? pz - (gz + 1) * size : 0;
      const lb = bx * bx + bz * bz;
      if (lb >= bestD && lb >= fallbackD) return;
      const c = base + gz * cols + gx;
      for (let k = cStart[c], e = cStart[c + 1]; k < e; k++) {
        const j = cItems[k];
        if (!alive[j]) continue;
        const dx = x[j] - xi, dz = z[j] - zi;
        const d = dx * dx + dz * dz;
        if (canHurt[row + sp[j]]) {
          if (d < bestD) { bestD = d; best = j; }
        } else if (d < fallbackD) { fallbackD = d; fallback = j; }
      }
    };
    for (let ring = 0; ring <= LOCAL_RINGS; ring++) {
      // Every cell of this ring is at least (ring − 1) cells away: stop once that is past the best found.
      const near = Math.max(0, ring - 1) * size;
      if (best >= 0 && near * near >= bestD) break;
      const z0 = ccz - ring, z1 = ccz + ring, x0 = ccx - ring, x1 = ccx + ring;
      if (z0 < 0 && z1 >= cols && x0 < 0 && x1 >= cols) break;
      for (let gx = Math.max(0, x0); gx <= Math.min(cols - 1, x1); gx++) {
        if (z0 >= 0) scan(gx, z0);
        if (ring > 0 && z1 < cols) scan(gx, z1);
      }
      for (let gz = Math.max(0, z0 + 1); gz <= Math.min(cols - 1, z1 - 1); gz++) {
        if (x0 >= 0) scan(x0, gz);
        if (ring > 0 && x1 < cols) scan(x1, gz);
      }
    }
    if (best >= 0) {
      this.far[i] = 0;
      return best;
    }
    // Nobody close: head for the nearest of the other army's beacons (a spread-out sample of it).
    const other = 1 - mySide;
    const beacons = this.beacons[other];
    let bb = -1, bbD = Infinity, fb = fallback, fbD = fallbackD;
    for (let k = 0; k < this.beaconCount[other]; k++) {
      const j = beacons[k];
      if (!alive[j]) continue;
      const dx = x[j] - xi, dz = z[j] - zi;
      const d = dx * dx + dz * dz;
      if (canHurt[row + sp[j]]) {
        if (d < bbD) { bbD = d; bb = j; }
      } else if (d < fbD) { fbD = d; fb = j; }
    }
    this.far[i] = 1;
    return bb >= 0 ? bb : fb;
  }

  /** A spread-out sample of each army that units far from any foe head for. */
  private refreshBeacons() {
    for (let s = 0; s < 2; s++) {
      const alive = this.left[s];
      const stride = Math.max(1, Math.floor(alive / BEACONS));
      let k = 0, seen = 0;
      for (let i = 0; i < this.n && k < BEACONS; i++) {
        if (!this.alive[i] || this.side[i] !== s) continue;
        if (seen++ % stride === 0) this.beacons[s][k++] = i;
      }
      this.beaconCount[s] = k;
    }
  }

  /** Foes of `i`'s side whose bodies are within `reach` of (x, z) (written to the scratch buffer); returns how many. */
  private foesNear(i: number, x: number, z: number, reach: number): number {
    const cols = this.ccols, size = this.coarse, a = this.arena;
    const base = (1 - this.side[i]) * cols * cols;
    const span = Math.ceil((reach + 16) / size);
    const ccx = Math.floor((x + a) / size), ccz = Math.floor((z + a) / size);
    let count = 0;
    for (let gz = Math.max(0, ccz - span); gz <= Math.min(cols - 1, ccz + span); gz++) {
      for (let gx = Math.max(0, ccx - span); gx <= Math.min(cols - 1, ccx + span); gx++) {
        const c = base + gz * cols + gx;
        for (let k = this.cStart[c]; k < this.cStart[c + 1]; k++) {
          const j = this.cItems[k];
          if (!this.alive[j]) continue;
          const dx = this.x[j] - x, dz = this.z[j] - z;
          const lim = reach + this.rows[this.sp[j]].radius;
          if (dx * dx + dz * dz <= lim * lim) {
            if (count >= this.scratch.length) {
              const grown = new Int32Array(this.scratch.length * 2);
              grown.set(this.scratch);
              this.scratch = grown;
            }
            this.scratch[count++] = j;
          }
        }
      }
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Moves
  // -------------------------------------------------------------------------

  private gap(i: number, j: number): number {
    const dx = this.x[j] - this.x[i], dz = this.z[j] - this.z[i];
    return Math.sqrt(dx * dx + dz * dz) - this.rows[this.sp[i]].radius - this.rows[this.sp[j]].radius;
  }

  private hitState(i: number, j: number, crit: boolean, spread: boolean): HitState {
    const st = this.state;
    st.crit = crit;
    st.spread = spread;
    st.aHp = this.hp[i];
    st.aMax = this.rows[this.sp[i]].maxHp;
    st.dHp = this.hp[j];
    st.dMax = this.rows[this.sp[j]].maxHp;
    return st;
  }

  private accuracy(i: number, j: number, mv: MBMove): number {
    if (!mv.acc) return 1;
    const a = this.rows[this.sp[i]], d = this.rows[this.sp[j]];
    if (a.noGuard || d.noGuard) return 1;
    return Math.min(1, (mv.acc / 100) * a.accMul * (mv.cat === "Physical" ? a.physAccMul : 1));
  }

  /** Expected damage of one use against one foe (capped at its HP). */
  private expected(i: number, slot: number, j: number, spread: boolean): number {
    const mv = this.prep.moves[this.sp[i]][slot];
    const e = this.table.entry(this.sp[i], slot, this.sp[j], this.hitState(i, j, false, spread));
    if (e.immune) return 0;
    const hits = this.rows[this.sp[i]].skillLink && mv.hits ? mv.hits[1] : expectedHitsOf(mv);
    return Math.min(this.hp[j], e.avg * hits) * this.accuracy(i, j, mv);
  }

  /** The move `i` plans against `j` (best expected damage, ignoring reach): for priority and how close to go. */
  private planMove(i: number, j: number): number {
    const moves = this.prep.moves[this.sp[i]];
    let best = -1, bestV = 0;
    for (let s = 0; s < moves.length; s++) {
      const v = this.expected(i, s, j, false);
      if (v > bestV) { bestV = v; best = s; }
    }
    return best;
  }

  private priority(i: number, slot: number): number {
    if (slot < 0) return 0;
    const mv = this.prep.moves[this.sp[i]][slot];
    const row = this.rows[this.sp[i]];
    let p = mv.pri;
    if (row.ability === "galewings" && mv.type === "Flying" && this.hp[i] >= row.maxHp) p += 1;
    if (row.ability === "triage" && mv.drain) p += 3;
    return p;
  }

  // -------------------------------------------------------------------------
  // The tick
  // -------------------------------------------------------------------------

  private pushEvent(actor: number, target: number, slot: number, damage: number, flags: number) {
    if ((this.eventCount + 1) * EVENT_INTS > this.events.length) {
      const grown = new Int32Array(this.events.length * 2);
      grown.set(this.events);
      this.events = grown;
    }
    const o = this.eventCount * EVENT_INTS;
    this.events[o] = actor;
    this.events[o + 1] = target;
    this.events[o + 2] = slot;
    this.events[o + 3] = damage;
    this.events[o + 4] = flags;
    this.events[o + 5] = this.actionId;
    this.eventCount++;
  }

  private startRound() {
    const { n, alive } = this;
    this.refreshBeacons();
    let len = 0;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      let t = this.target[i];
      if (t < 0 || !alive[t]) t = this.target[i] = this.findTarget(i);
      const slot = t >= 0 ? this.planMove(i, t) : -1;
      this.plan[i] = slot;
      // Priority, then the battle Speed stat, then a coin toss.
      this.keys[i] = this.priority(i, slot) * 100000 + this.rows[this.sp[i]].spe + this.random() * 0.999;
      this.order[len++] = i;
    }
    const keys = this.keys;
    const view = this.order.subarray(0, len);
    view.sort((a, b) => keys[b] - keys[a]);
    for (let r = 0; r < len; r++) this.actTick[view[r]] = this.tick + Math.floor((r * ACT_TICKS) / Math.max(1, len));
    this.orderLen = len;
    this.orderAt = 0;
  }

  private faint(j: number) {
    this.alive[j] = 0;
    this.hp[j] = 0;
    this.faintTick[j] = this.tick;
    this.left[this.side[j]]--;
    this.aliveBySpecies[this.sp[j]]--;
  }

  /** Number of hits for one use of a multi-hit move. */
  private hitCount(i: number, mv: MBMove): number {
    if (!mv.hits) return 1;
    const [lo, hi] = mv.hits;
    if (lo === hi) return lo;
    const row = this.rows[this.sp[i]];
    if (row.skillLink) return hi;
    if (lo === 2 && hi === 5) {
      if (row.loadedDice) return this.random() < 0.5 ? 4 : 5;
      const r = this.random();
      return r < 0.35 ? 2 : r < 0.7 ? 3 : r < 0.85 ? 4 : 5;
    }
    return lo + Math.floor(this.random() * (hi - lo + 1));
  }

  private critChance(i: number, j: number, mv: MBMove): number {
    if (this.rows[this.sp[j]].critImmune) return 0;
    const stage = mv.crit + this.rows[this.sp[i]].critBoost;
    return stage >= 3 ? 1 : stage === 2 ? 0.5 : stage === 1 ? 0.125 : 1 / 24;
  }

  /** One use of a move by `i` against `t` (and, for a spread move, everyone around). */
  private act(i: number) {
    let t = this.target[i];
    if (t < 0 || !this.alive[t]) {
      t = this.target[i] = this.findTarget(i);
      if (t < 0) return;
    }
    const spi = this.sp[i];
    const moves = this.prep.moves[spi];
    const row = this.rows[spi];
    const gapT = this.gap(i, t);
    // The best move it can use from where it stands.
    let best = -1, bestV = 0, bestSpreadCount = 0;
    for (let s = 0; s < moves.length; s++) {
      const mv = moves[s];
      if (gapT > (mv.contact ? CONTACT_REACH : RANGED_REACH)) continue;
      let v: number;
      let count = 0;
      if (mv.spread) {
        count = this.foesNear(i, this.x[i], this.z[i], row.radius + SPREAD_REACH);
        if (count >= 2) {
          v = 0;
          for (let k = 0; k < count; k++) v += this.expected(i, s, this.scratch[k], true);
        } else v = this.expected(i, s, t, false);
      } else v = this.expected(i, s, t, false);
      if (v > bestV) { bestV = v; best = s; bestSpreadCount = count; }
    }
    if (best < 0) return;
    const mv = moves[best];
    this.actionId++;
    let targets: number;
    if (mv.spread && bestSpreadCount >= 2) {
      targets = this.foesNear(i, this.x[i], this.z[i], row.radius + SPREAD_REACH);
    } else {
      this.scratch[0] = t;
      targets = 1;
    }
    const multi = targets >= 2;
    let total = 0;
    for (let k = 0; k < targets; k++) {
      const j = this.scratch[k];
      if (!this.alive[j]) continue;
      const flagsBase = multi ? EV.SPREAD : 0;
      if (this.random() >= this.accuracy(i, j, mv)) {
        this.pushEvent(i, j, best, 0, flagsBase | EV.MISS);
        continue;
      }
      const crit = this.random() < this.critChance(i, j, mv);
      const e: HitEntry = this.table.entry(spi, best, this.sp[j], this.hitState(i, j, crit, multi));
      if (e.immune) {
        this.pushEvent(i, j, best, 0, flagsBase | EV.IMMUNE);
        continue;
      }
      const nh = this.hitCount(i, mv);
      let dmg = 0;
      for (let h = 0; h < nh; h++) {
        if (h > 0 && mv.multiAcc && this.random() >= this.accuracy(i, j, mv)) break;
        const rolls = e.hits[Math.min(h, e.hits.length - 1)];
        dmg += rolls[Math.floor(this.random() * 16)];
      }
      const before = this.hp[j];
      const dRow = this.rows[this.sp[j]];
      if (dRow.sturdy && before >= dRow.maxHp && dmg >= before) dmg = before - 1;
      const done = Math.min(dmg, before);
      this.hp[j] = before - done;
      this.dealt[i] += done;
      this.sideDealt[this.side[i]] += done;
      total += done;
      let flags = flagsBase | (crit ? EV.CRIT : 0);
      const eff = e.avg > 0 ? this.effectiveness(spi, best, this.sp[j]) : 1;
      if (eff > 1) flags |= EV.SUPER;
      else if (eff < 1) flags |= EV.RESIST;
      // Knockback: damage over weight, away from the attacker.
      const dx = this.x[j] - this.x[i], dz = this.z[j] - this.z[i];
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      const kv = Math.min(KNOCK_MAX, (KNOCK * done) / dRow.mass);
      this.kx[j] += (dx / d) * kv;
      this.kz[j] += (dz / d) * kv;
      if (this.hp[j] <= 0) {
        flags |= EV.KO;
        this.faint(j);
        this.kos[i]++;
        this.sideKos[this.side[i]]++;
      }
      this.pushEvent(i, j, best, done, flags);
      if (!this.bigHit || done > this.bigHit.damage) this.bigHit = { damage: done, actor: i, target: j, slot: best, crit };
    }
    if (total > 0 && this.alive[i]) {
      const max = row.maxHp;
      let self = 0;
      if (mv.recoil && !row.noRecoil) self += Math.max(1, Math.round((total * mv.recoil[0]) / mv.recoil[1]));
      if (row.lifeOrb && !row.magicGuard) self += Math.floor(max / 10);
      if (mv.drain) this.hp[i] = Math.min(max, this.hp[i] + Math.max(1, Math.round((total * mv.drain[0]) / mv.drain[1])));
      if (self > 0) {
        this.hp[i] -= Math.min(self, this.hp[i]);
        if (this.hp[i] <= 0) {
          this.faint(i);
          this.pushEvent(i, i, -1, self, EV.KO | EV.RECOIL);
          // Both last Pokémon down at once: as in the games (Gen 5 on), the one whose move did it wins.
          if (!this.left[0] && !this.left[1]) this.lastBlow = this.side[i];
        }
      }
    }
  }

  private effCache = new Map<number, number>();
  /** Type effectiveness of a move on a species (for the hit's flash and sound). */
  private effectiveness(a: number, slot: number, d: number): number {
    const key = (a * 8 + slot) * 65536 + d;
    let v = this.effCache.get(key);
    if (v === undefined) {
      // Neutral damage against the same defender would be the move's average with the type factor removed; the
      // calculator doesn't expose the factor, so it's read off the type chart.
      v = typeFactor(this.prep.moves[a][slot].type, this.prep.species[d].types);
      this.effCache.set(key, v);
    }
    return v;
  }

  private move() {
    const { n, alive, x, z } = this;
    const decay = Math.exp(-KNOCK_DECAY * DT);
    for (let i = 0; i < n; i++) {
      if (!alive[i]) { this.vx[i] = this.vz[i] = 0; continue; }
      let t = this.target[i];
      if (t < 0 || !alive[t]) t = this.target[i] = this.findTarget(i);
      const row = this.rows[this.sp[i]];
      let mx = 0, mz = 0;
      if (t >= 0) {
        const dx = x[t] - x[i], dz = z[t] - z[i];
        const d = Math.sqrt(dx * dx + dz * dz);
        const gap = d - row.radius - this.rows[this.sp[t]].radius;
        const slot = this.plan[i];
        const ranged = slot >= 0 && !this.prep.moves[this.sp[i]][slot].contact;
        const want = ranged ? RANGED_REACH * 0.7 : 0.05;
        if (gap > want && d > 1e-6) {
          const ux = dx / d, uz = dz / d;
          // A unit the crowd pushed back last tick doesn't press on into it (no piling up behind the front).
          const pushedBack = Math.max(0, -(this.lx[i] * ux + this.lz[i] * uz));
          const step = Math.max(0, Math.min(row.vmax * DT, gap - want) - pushedBack * 1.2);
          // Someone right in front: step round them instead of into them.
          const side = this.small[i] ? this.blocker(i, t, ux, uz, step) : 0;
          if (side !== 0) {
            const slide = Math.min(step, row.vmax * DT) * 0.6;
            mx = -uz * side * slide;
            mz = ux * side * slide;
          } else {
            mx = ux * step;
            mz = uz * step;
          }
        }
      }
      x[i] += mx + this.kx[i] * DT;
      z[i] += mz + this.kz[i] * DT;
      this.vx[i] = mx / DT;
      this.vz[i] = mz / DT;
      this.kx[i] *= decay;
      this.kz[i] *= decay;
      if (Math.abs(this.kx[i]) < 1e-3) this.kx[i] = 0;
      if (Math.abs(this.kz[i]) < 1e-3) this.kz[i] = 0;
    }
  }

  /**
   * Whether a body blocks `i`'s way to `t` this step: 0 if the way is clear, otherwise the side (±1, across the
   * direction of travel) to step round it, away from the blocker.
   */
  private blocker(i: number, t: number, ux: number, uz: number, step: number): number {
    const cols = this.cols, a = this.arena, size = this.cell;
    const xi = this.x[i], zi = this.z[i], ri = this.rows[this.sp[i]].radius;
    const gx = Math.min(cols - 1, Math.max(0, Math.floor((xi + a) / size)));
    const gz = Math.min(cols - 1, Math.max(0, Math.floor((zi + a) / size)));
    let nearest = Infinity, lateral = 0;
    for (let zz = Math.max(0, gz - 1); zz <= Math.min(cols - 1, gz + 1); zz++) {
      for (let xx = Math.max(0, gx - 1); xx <= Math.min(cols - 1, gx + 1); xx++) {
        const c = zz * cols + xx;
        for (let k = this.cellStart[c], e = this.cellStart[c + 1]; k < e; k++) {
          const j = this.cellItems[k];
          if (j === i || j === t || !this.alive[j]) continue;
          const dx = this.x[j] - xi, dz = this.z[j] - zi;
          const ahead = dx * ux + dz * uz;
          if (ahead <= 0) continue;
          const across = -dx * uz + dz * ux;
          const reach = ri + this.rows[this.sp[j]].radius;
          if (Math.abs(across) >= reach * 0.85 || ahead > reach + step) continue;
          if (ahead < nearest) { nearest = ahead; lateral = across; }
        }
      }
    }
    if (nearest === Infinity) return 0;
    // Step to the side the blocker isn't on (a fixed side when it's dead ahead, by index, so crowds fan out).
    return lateral > 1e-6 ? -1 : lateral < -1e-6 ? 1 : (i & 1 ? 1 : -1);
  }

  /** Bodies push each other apart (heavier ones push harder), and everyone stays on the field. */
  private separate() {
    const { n, alive, x, z } = this;
    const cx = this.cx, cz = this.cz;
    cx.fill(0);
    cz.fill(0);
    const cols = this.cols;
    const pair = (i: number, j: number) => {
      const dx = x[j] - x[i], dz = z[j] - z[i];
      const ri = this.rows[this.sp[i]].radius, rj = this.rows[this.sp[j]].radius;
      const min = ri + rj;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) return;
      let d = Math.sqrt(d2), ux: number, uz: number;
      if (d < 1e-6) {
        // Exactly on top of each other: part them along a direction fixed by their indices.
        const a = ((i * 7919 + j * 104729) % 360) * (Math.PI / 180);
        ux = Math.cos(a);
        uz = Math.sin(a);
        d = 0;
      } else {
        ux = dx / d;
        uz = dz / d;
      }
      const push = (min - d) * 0.5;
      const mi = this.rows[this.sp[i]].mass, mj = this.rows[this.sp[j]].mass;
      const wi = mj / (mi + mj), wj = mi / (mi + mj);
      cx[i] -= ux * push * wi;
      cz[i] -= uz * push * wi;
      cx[j] += ux * push * wj;
      cz[j] += uz * push * wj;
    };
    // Small bodies against small bodies: their own cell and the neighbours ahead of it.
    for (let c = 0; c < cols * cols; c++) {
      const s0 = this.cellStart[c], s1 = this.cellStart[c + 1];
      if (s0 === s1) continue;
      const gx = c % cols, gz = (c - gx) / cols;
      for (let a = s0; a < s1; a++) {
        const i = this.cellItems[a];
        for (let b = a + 1; b < s1; b++) pair(i, this.cellItems[b]);
        // Neighbour cells: east, and the three below (each pair of cells is visited once).
        const east = gx + 1 < cols, below = gz + 1 < cols;
        if (east) for (let b = this.cellStart[c + 1]; b < this.cellStart[c + 2]; b++) pair(i, this.cellItems[b]);
        if (below) {
          const lo = gx > 0 ? c + cols - 1 : c + cols, hi = east ? c + cols + 1 : c + cols;
          for (let b = this.cellStart[lo]; b < this.cellStart[hi + 1]; b++) pair(i, this.cellItems[b]);
        }
      }
    }
    // Big bodies against everyone near them.
    for (let k = 0; k < this.bigCount; k++) {
      const i = this.bigUnits[k];
      if (!alive[i]) continue;
      const r = this.rows[this.sp[i]].radius + this.cell;
      const g0x = Math.max(0, Math.floor((x[i] - r + this.arena) / this.cell)), g1x = Math.min(cols - 1, Math.floor((x[i] + r + this.arena) / this.cell));
      const g0z = Math.max(0, Math.floor((z[i] - r + this.arena) / this.cell)), g1z = Math.min(cols - 1, Math.floor((z[i] + r + this.arena) / this.cell));
      for (let gz = g0z; gz <= g1z; gz++) {
        for (let gx = g0x; gx <= g1x; gx++) {
          const c = gz * cols + gx;
          for (let b = this.cellStart[c]; b < this.cellStart[c + 1]; b++) pair(i, this.cellItems[b]);
        }
      }
      for (let k2 = k + 1; k2 < this.bigCount; k2++) {
        const j = this.bigUnits[k2];
        if (alive[j]) pair(i, j);
      }
    }
    const lim = this.arena;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      x[i] += cx[i];
      z[i] += cz[i];
      this.lx[i] = this.lx[i] * 0.5 + cx[i];
      this.lz[i] = this.lz[i] * 0.5 + cz[i];
      const r = this.rows[this.sp[i]].radius;
      const d = Math.sqrt(x[i] * x[i] + z[i] * z[i]);
      const max = lim - r;
      if (d > max && d > 0) {
        x[i] *= max / d;
        z[i] *= max / d;
      }
    }
  }

  /** Whether either side can still hurt the other at all. */
  private canStillHurt(s: number): boolean {
    const S = this.prep.species.length;
    for (const [a] of this.prep.armies[s]) {
      if (!this.aliveBySpecies[a]) continue;
      for (const [d] of this.prep.armies[1 - s]) if (this.aliveBySpecies[d] && this.canHurt[a * S + d]) return true;
    }
    return false;
  }

  /** One tick (1/20 s). */
  step() {
    this.eventCount = 0;
    if (this.ended) return;
    if (this.tick % ROUND_TICKS === 0) {
      this.startRound();
      if (!this.canStillHurt(0) && !this.canStillHurt(1)) {
        this.ended = true;
        this.winner = 2;
        return;
      }
    }
    // Everyone whose turn has come this tick, in turn order.
    while (this.orderAt < this.orderLen) {
      const i = this.order[this.orderAt];
      if (this.actTick[i] > this.tick) break;
      this.orderAt++;
      if (this.alive[i]) this.act(i);
      if (!this.left[0] || !this.left[1]) break;
    }
    // Retargeting spread over the round: each unit looks for a nearer foe once a round, and more often while it's
    // still heading for a far one.
    for (let i = this.tick % ROUND_TICKS; i < this.n; i += ROUND_TICKS) if (this.alive[i]) this.target[i] = this.findTarget(i);
    for (let i = this.tick % TICK_HZ; i < this.n; i += TICK_HZ) if (this.alive[i] && this.far[i]) this.target[i] = this.findTarget(i);
    this.move();
    this.rebuildGrids();
    this.separate();
    this.separate();
    this.tick++;
    if (!this.left[0] || !this.left[1]) {
      this.ended = true;
      this.winner = !this.left[0] && !this.left[1] ? (this.lastBlow >= 0 ? (this.lastBlow as 0 | 1) : 2) : this.left[0] ? 0 : 1;
    } else if (this.tick >= MAX_SECONDS * TICK_HZ) {
      this.ended = true;
      this.winner = 2;
    }
  }

  outcome(): BattleOutcome {
    return { winner: this.winner, seconds: this.tick / TICK_HZ, left: [this.left[0], this.left[1]], kos: [this.sideKos[0], this.sideKos[1]], dealt: [Math.round(this.sideDealt[0]), Math.round(this.sideDealt[1])] };
  }

  stats(): BattleStats {
    let mvp = -1, mvpKos = 0;
    for (let i = 0; i < this.n; i++) if (this.kos[i] > mvpKos) { mvpKos = this.kos[i]; mvp = i; }
    return { mvp, mvpKos, big: this.bigHit };
  }

  /** Total HP left on a side, as a share of its starting HP. */
  hpShare(s: number): number {
    let cur = 0, max = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.side[i] !== s) continue;
      max += this.rows[this.sp[i]].maxHp;
      cur += this.hp[i];
    }
    return max ? cur / max : 0;
  }
}

/** The type chart, for the hit's look and sound (damage itself is the calculator's). */
export function typeFactor(moveType: string, defender: string[]): number {
  try {
    return chart(moveType.toLowerCase() as PokemonType, defender as PokemonType[]);
  } catch {
    return 1;
  }
}

/** Plays a battle to the end without drawing it. */
export function runHeadless(prep: Prepared, table?: DamageTable, maxTicks = MAX_SECONDS * TICK_HZ): Battle {
  const b = new Battle(prep, table);
  while (!b.ended && b.tick < maxTicks) b.step();
  return b;
}
