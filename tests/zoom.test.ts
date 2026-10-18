import { describe, expect, it } from "vitest";
import { pickZoomWindow, ZOOM_PADDING } from "@/lib/server/zoom";

/** A padded sprite, as the media route builds it: a shape plus a transparent margin. */
function padded(size: number, inside: (x: number, y: number) => boolean) {
  const pad = Math.round(size * ZOOM_PADDING);
  const n = size + 2 * pad;
  const alpha = new Uint8Array(n * n);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (inside(x, y)) alpha[(y + pad) * n + x + pad] = 255;
  return { alpha, n };
}

function windowStats(alpha: Uint8Array, n: number, win: { left: number; top: number; width: number; height: number }) {
  let filled = 0;
  for (let y = win.top; y < win.top + win.height; y++)
    for (let x = win.left; x < win.left + win.width; x++) if (alpha[y * n + x] > 127) filled++;
  return filled / (win.width * win.height);
}

describe("hard-mode zoom crop", () => {
  it("never returns a solid block, even for a perfect disc (Voltorb)", () => {
    const r = 100;
    const { alpha, n } = padded(2 * r, (x, y) => (x - r) ** 2 + (y - r) ** 2 <= r * r);
    for (let seed = 0; seed < 20; seed++) {
      const win = pickZoomWindow(alpha, n, n, seed);
      const fill = windowStats(alpha, n, win);
      expect(fill).toBeGreaterThan(0.15);
      expect(fill).toBeLessThan(0.85);
    }
  });

  it("prefers the window with distinctive outline (a spike) over plain body", () => {
    // A square body with a thin spike sticking up from the top-right corner.
    const { alpha, n } = padded(200, (x, y) => (y > 80 && x < 200) || (x > 150 && x < 165 && y > 0));
    const win = pickZoomWindow(alpha, n, n, 0);
    const spikeX = 157 + Math.round(200 * ZOOM_PADDING);
    expect(win.left).toBeLessThanOrEqual(spikeX);
    expect(win.left + win.width).toBeGreaterThan(spikeX);
    expect(win.top).toBeLessThan(80);
  });

  it("is deterministic and stays inside the image", () => {
    const { alpha, n } = padded(150, (x, y) => x + y < 200);
    const a = pickZoomWindow(alpha, n, n, 42);
    expect(pickZoomWindow(alpha, n, n, 42)).toEqual(a);
    expect(a.left).toBeGreaterThanOrEqual(0);
    expect(a.top).toBeGreaterThanOrEqual(0);
    expect(a.left + a.width).toBeLessThanOrEqual(n);
    expect(a.top + a.height).toBeLessThanOrEqual(n);
  });
});
