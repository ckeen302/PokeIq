import type { Formation } from "./types";

/**
 * Where each army starts: side A west of the centre facing east, side B
 * east facing west, their front ranks a charge apart. Line, wedge and swarm
 * are blocks of their own; surround rings the other army. Units sit by
 * species (smallest at the front), each with room for its own body.
 * Pure: the same input always gives the same positions.
 */

/** Open ground between the two front ranks (m), before either army's size. */
export const START_GAP = 40;
/** Each body keeps this much room around it in a formation (share of its diameter). */
const ROOM = 1.35;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export interface Placement {
  x: Float64Array;
  z: Float64Array;
  /** Battlefield radius (m): everyone starts inside it with room to spare. */
  arena: number;
}

interface Body {
  i: number;
  r: number;
}

/** Positions for one army as a block whose front faces +x, its front rank at x = 0 and centred on z = 0. */
function block(bodies: Body[], formation: Exclude<Formation, "surround">, jitter: () => number): { x: number[]; z: number[] } {
  const n = bodies.length;
  const x = new Array<number>(n).fill(0), z = new Array<number>(n).fill(0);
  if (!n) return { x, z };
  const pitch = (b: Body) => Math.max(0.3, 2 * b.r * ROOM);
  const area = bodies.reduce((a, b) => a + pitch(b) ** 2, 0);
  if (formation === "swarm") {
    // A loose disc (a sunflower spiral), smallest in the middle front, edges ragged.
    const mean = Math.sqrt(area / n);
    const disc = Math.sqrt(area / Math.PI) * 1.05;
    bodies.forEach((b, k) => {
      const rho = mean * 0.56 * Math.sqrt(k + 0.5) * 1.06;
      const a = k * GOLDEN;
      x[k] = -disc + Math.cos(a) * rho + jitter() * mean * 0.35;
      z[k] = Math.sin(a) * rho + jitter() * mean * 0.35;
    });
    // Its front edge at x = 0.
    let front = -Infinity;
    bodies.forEach((b, k) => (front = Math.max(front, x[k] + b.r)));
    for (let k = 0; k < n; k++) x[k] -= front;
    return { x, z };
  }
  // Ranks: across the field (z), front to back (−x).
  const width = formation === "line" ? Math.max(4, Math.sqrt(area) * 2.4) : Math.max(4, Math.sqrt(area) * 1.6);
  let depth = 0;
  let k = 0;
  let rank = 0;
  while (k < n) {
    const span = formation === "wedge" ? Math.min(width, pitch(bodies[k]) * (1 + rank * 2)) : width;
    const start = k;
    let used = 0;
    while (k < n && (k === start || used + pitch(bodies[k]) <= span)) {
      used += pitch(bodies[k]);
      k++;
    }
    let rowDepth = 0;
    for (let j = start; j < k; j++) rowDepth = Math.max(rowDepth, pitch(bodies[j]));
    let at = -used / 2;
    for (let j = start; j < k; j++) {
      const p = pitch(bodies[j]);
      x[j] = -(depth + rowDepth / 2) + jitter() * p * 0.12;
      z[j] = at + p / 2 + jitter() * p * 0.12;
      at += p;
    }
    depth += rowDepth;
    rank++;
  }
  return { x, z };
}

/**
 * Starting positions. `radius[i]` and `side[i]` per unit, in the order the
 * armies list them (each army's species in order); `rand` is the battle's
 * seeded random source.
 */
export function placeArmies(radius: ArrayLike<number>, side: ArrayLike<number>, formations: [Formation, Formation], rand: () => number): Placement {
  const n = radius.length;
  const X = new Float64Array(n), Z = new Float64Array(n);
  const jitter = () => rand() * 2 - 1;
  const bodiesOf = (s: number) => {
    const out: Body[] = [];
    for (let i = 0; i < n; i++) if (side[i] === s) out.push({ i, r: radius[i] });
    // Smallest at the front; the sort is stable, so a species stays together.
    return out.sort((a, b) => a.r - b.r);
  };
  const armies = [bodiesOf(0), bodiesOf(1)];
  const biggest = armies.map((a) => a.reduce((m, b) => Math.max(m, b.r), 0));
  // A surround needs the other army's footprint first: place the blocks, then the rings.
  const order = formations[0] === "surround" && formations[1] !== "surround" ? [1, 0] : [0, 1];
  const extent: { cx: number; cz: number; r: number }[] = [{ cx: 0, cz: 0, r: 0 }, { cx: 0, cz: 0, r: 0 }];
  for (const s of order) {
    const bodies = armies[s];
    const f = formations[s];
    const other = 1 - s;
    if (f === "surround" && formations[other] !== "surround" && armies[other].length) {
      // Rings round the other army, starting a charge away from its edge.
      const o = extent[other];
      let ringR = o.r + START_GAP * 0.75 + (bodies[0]?.r ?? 0);
      let k = 0;
      while (k < bodies.length) {
        const pitch = Math.max(0.3, 2 * bodies[k].r * ROOM);
        const fits = Math.max(6, Math.floor((2 * Math.PI * ringR) / pitch));
        const take = Math.min(fits, bodies.length - k);
        const phase = rand() * Math.PI * 2;
        let deepest = 0;
        for (let j = 0; j < take; j++) {
          const b = bodies[k + j];
          const a = phase + (j / take) * Math.PI * 2;
          X[b.i] = o.cx + Math.cos(a) * ringR;
          Z[b.i] = o.cz + Math.sin(a) * ringR;
          deepest = Math.max(deepest, 2 * b.r * ROOM);
        }
        k += take;
        ringR += Math.max(0.4, deepest);
      }
      extent[s] = { cx: o.cx, cz: o.cz, r: ringR };
      continue;
    }
    const shape = f === "surround" ? "swarm" : f;
    const { x, z } = block(bodies, shape, jitter);
    // Front ranks START_GAP apart (plus the biggest bodies), mirrored for side B.
    const front = START_GAP / 2 + biggest[s] * 0.5;
    const dir = s === 0 ? 1 : -1;
    let cx = 0, cz = 0, r = 0;
    bodies.forEach((b, k) => {
      X[b.i] = dir * (x[k] - front);
      Z[b.i] = z[k];
      cx += X[b.i];
      cz += Z[b.i];
    });
    if (bodies.length) { cx /= bodies.length; cz /= bodies.length; }
    for (const b of bodies) r = Math.max(r, Math.hypot(X[b.i] - cx, Z[b.i] - cz) + b.r);
    extent[s] = { cx, cz, r };
  }
  let reach = 0;
  for (let i = 0; i < n; i++) reach = Math.max(reach, Math.hypot(X[i], Z[i]) + radius[i]);
  return { x: X, z: Z, arena: Math.max(40, reach * 1.25 + 12) };
}
