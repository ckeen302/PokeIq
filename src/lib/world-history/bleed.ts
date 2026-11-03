/**
 * Bleeds a cut-out's edge colours outwards into the transparent pixels
 * around it (a few rings of dilation), so the GPU's filtering and mip-maps
 * never mix the figure's edge with the render's invisible (often black)
 * background. Alpha is untouched. RGBA bytes, in place.
 */
export function bleedEdges(px: Uint8Array | Uint8ClampedArray | Buffer, w: number, h: number, rings = 6): void {
  const known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) known[i] = px[i * 4 + 3] > 8 ? 1 : 0;
  for (let ring = 0; ring < rings; ring++) {
    const add: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (known[i]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const j = yy * w + xx;
            if (!known[j]) continue;
            r += px[j * 4];
            g += px[j * 4 + 1];
            b += px[j * 4 + 2];
            n++;
          }
        }
        if (n) add.push(i, r / n, g / n, b / n);
      }
    }
    if (!add.length) break;
    for (let k = 0; k < add.length; k += 4) {
      const i = add[k];
      px[i * 4] = add[k + 1];
      px[i * 4 + 1] = add[k + 2];
      px[i * 4 + 2] = add[k + 3];
      known[i] = 2;
    }
  }
}
