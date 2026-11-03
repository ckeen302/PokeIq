/**
 * The far atlas of /pokedex/sizes (baked by scripts/sizes-art.ts): every
 * figure's HOME render and relief map, small, on two shared sheets, so the
 * low-detail relief figures far from the camera are all available after two
 * downloads. Cells run in art-id order, `cols` to a row; inside its cell a
 * figure's visible box is fitted (aspect kept), centred and standing on the
 * cell's floor, with a transparent margin so mipmaps don't bleed.
 */

export interface FarSpec {
  /** Cell size (px). */
  cell: number;
  /** Margin inside the cell (px). */
  pad: number;
}

export interface FarRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FAR = {
  cols: 32,
  art: { cell: 64, pad: 3 } as FarSpec,
  depth: { cell: 32, pad: 1 } as FarSpec,
  /** Grid resolution of a far figure's relief mesh (cells on the box's longest side). */
  segments: 12,
  /** Where figure number `k` (in art-id order) with a visible box of bw × bh sits on a sheet. */
  rect(k: number, bw: number, bh: number, spec: FarSpec): FarRect {
    const inner = spec.cell - spec.pad * 2;
    const fit = inner / Math.max(1e-6, bw, bh);
    const w = Math.max(1, Math.round(bw * fit)), h = Math.max(1, Math.round(bh * fit));
    const col = k % FAR.cols, row = Math.floor(k / FAR.cols);
    return { x: col * spec.cell + spec.pad + Math.floor((inner - w) / 2), y: row * spec.cell + spec.pad + (inner - h), w, h };
  },
};

/** The bundled index of the sheets (src/data/sizes-far.json). */
export interface FarManifest {
  art: string;
  depth: string;
  artW: number;
  artH: number;
  depthW: number;
  depthH: number;
  /** Art ids, cell by cell. */
  ids: number[];
}
