/**
 * The landing globe's geometry, without three.js: where a longitude and latitude sit on the turning, tilted planet,
 * and where that lands on the canvas. The live scene (scene.ts) draws with exactly this camera and these turns, so
 * the DOM overlays (region names, the Daily's pins) placed with it stay on the land; with no WebGL, the same maths
 * places them on the poster (the scene's own first frame).
 */

export const D2R = Math.PI / 180;
/** The axis's tilt (Earth's), and how far the view looks down on it, so the north and the south both show. */
export const TILT = 23.4 * D2R;
export const LOOK_DOWN = 9 * D2R;
/** A long lens, so the planet reads as a ball, not a bulge. */
export const FOV = 26;
/** Where the world faces when it appears (and on the poster): Johto and Kanto, front and centre. */
export const START_LON = 60;
/** The atlas's size in pixels (public/atlas/atlas.json). */
export const ATLAS = { W: 5850, H: 2565 };

export type Vec = [number, number, number];

/** A point of the globe (radius r) in the planet's own frame: the same mapping as three's SphereGeometry uv. */
export function toVec(lon: number, lat: number, r = 1): Vec {
  const phi = (90 - lat) * D2R, th = (lon + 180) * D2R;
  return [-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th)];
}

/** The spin that brings a longitude to the front. */
export const angleFacing = (lon: number) => -(lon + 90) * D2R;

/** The camera's distance, so the disc spans `frac` of the canvas's width. */
export const cameraZ = (frac: number) => Math.sqrt(1 + 1 / (frac * Math.tan((FOV / 2) * D2R)) ** 2);

/**
 * A planet point, turned by the day's spin (`angle`, about its axis) and the tilt (the axis's, plus `tiltX` from a
 * drag), in view space: three's Ry(angle), then the tilt group's Euler(LOOK_DOWN + tiltX, 0, -TILT, "XZY").
 */
export function turn(v: Vec, angle: number, tiltX: number): Vec {
  const [x0, y0, z0] = v;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const x1 = x0 * ca + z0 * sa, y1 = y0, z1 = -x0 * sa + z0 * ca;
  const cz = Math.cos(-TILT), sz = Math.sin(-TILT);
  const x2 = x1 * cz - y1 * sz, y2 = x1 * sz + y1 * cz, z2 = z1;
  const b = LOOK_DOWN + tiltX, cb = Math.cos(b), sb = Math.sin(b);
  return [x2, y2 * cb - z2 * sb, y2 * sb + z2 * cb];
}

export interface Screen {
  /** CSS pixels from the canvas's top left. */
  x: number;
  y: number;
  /** How squarely the point faces the camera (1 at the disc's centre, 0 at the limb, below 0 round the back). */
  facing: number;
}

/** A view-space point on a W×H canvas, seen by the camera at cameraZ(frac). */
export function project(p: Vec, camZ: number, W: number, H: number, out: Screen): Screen {
  const t2 = Math.tan((FOV / 2) * D2R);
  const [x, y, z] = p;
  const depth = camZ - z;
  const aspect = W / H || 1;
  out.x = ((x / (depth * t2 * aspect)) * 0.5 + 0.5) * W;
  out.y = (-(y / (depth * t2)) * 0.5 + 0.5) * H;
  // The surface normal (the point, on a unit sphere) against the direction to the camera.
  const len = Math.hypot(x, y, z) || 1;
  const cx = -x, cy = -y, cz = camZ - z;
  const cl = Math.hypot(cx, cy, cz) || 1;
  out.facing = (x * cx + y * cy + z * cz) / (len * cl);
  return out;
}
