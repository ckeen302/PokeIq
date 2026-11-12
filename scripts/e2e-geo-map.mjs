/**
 * The PokéGuessr guess map, for the e2e scripts. A tap places a pin only once
 * the map has loaded and been sized (GeoMap marks this with `data-ready`), and
 * only inside the map's own box (a region's map dims the world around it, and
 * a tap there does nothing). The desktop dock also grows when hovered, so the
 * map is measured once it has stopped moving.
 */

const READY = "[role=application][data-ready]";

/**
 * Waits until the guess map takes taps and has settled (same size, place and
 * framing over two looks), then returns it with the area where a tap places a
 * pin: px from the map's top-left, clipped to the map.
 */
export async function guessMapReady(p, { timeout = 30_000 } = {}) {
  const map = p.locator(READY);
  await map.waitFor({ timeout });
  const look = () =>
    map.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { key: `${r.x},${r.y},${r.width},${r.height}|${el.dataset.pickArea}`, w: r.width, h: r.height, area: el.dataset.pickArea };
    });
  let last = await look();
  for (let i = 0; i < 50; i++) {
    await p.waitForTimeout(120);
    const now = await look();
    if (now.key === last.key) break;
    last = now;
  }
  const [l, t, r, b] = (last.area ?? `0,0,${last.w},${last.h}`).split(",").map(Number);
  const area = { left: Math.max(0, l), top: Math.max(0, t), right: Math.min(last.w, r), bottom: Math.min(last.h, b) };
  if (area.right - area.left < 20 || area.bottom - area.top < 20) throw new Error(`the guess map has no room to pin (${last.key})`);
  return { map: p.locator("[role=application]"), area };
}

/** A spot `fx`, `fy` (0–1) of the way across the pin area, kept clear of its edges and the map's corner buttons. */
export function spotIn(area, fx, fy) {
  const f = (v) => 0.1 + Math.min(1, Math.max(0, v)) * 0.8;
  return { x: area.left + (area.right - area.left) * f(fx), y: area.top + (area.bottom - area.top) * f(fy) };
}

/** Waits for the guess map, then taps it at `fx`, `fy` of the way across its pin area. */
export async function tapGuessMap(p, fx, fy) {
  const { map, area } = await guessMapReady(p);
  const at = spotIn(area, fx, fy);
  await map.click({ position: at });
  return { area, at };
}
