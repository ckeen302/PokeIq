/**
 * The review of the reviewed-fallback 3D masks (hd-auto.ts; contact sheets from hd-sheet.ts): per species, a build
 * setting that fixed what the automatic choice got wrong, or "one-piece" where no setting reached the bar. A
 * one-piece species still has 3D, drawn safely: its whole figure is its largest part (pupils and other dark details
 * drawn as rendered), so recolouring that part recolours the Pokémon with its shading kept, while its other parts
 * change only the Pixel style there.
 * Pure data: the tests read it.
 */
export type HdFix = { wl: number; k: number } | "one-piece";

export const HD_FIXES: Record<number, HdFix> = {
  11: "one-piece",
  20: { wl: 0.25, k: 1 },
  21: { wl: 0.25, k: 1 },
  41: { wl: 0.5, k: 0.6 },
  50: { wl: 0.25, k: 1 },
  58: "one-piece",
  83: "one-piece",
  108: { wl: 0.5, k: 1 },
  111: "one-piece",
  121: { wl: 0.25, k: 1 },
  167: { wl: 0.5, k: 0.6 },
  202: { wl: 0.1, k: 0.6 },
  231: { wl: 0.5, k: 1 },
  245: { wl: 1, k: 0.6 },
  268: { wl: 0.5, k: 0.6 },
  356: "one-piece",
  408: "one-piece",
  409: "one-piece",
  437: "one-piece",
  609: { wl: 1, k: 0.6 },
  615: "one-piece",
  671: { wl: 1, k: 0.6 },
  858: { wl: 0.5, k: 0.6 },
  919: { wl: 1, k: 0.6 },
  975: "one-piece",
};

export const HD_ONE_PIECE = Object.entries(HD_FIXES).filter(([, v]) => v === "one-piece").map(([k]) => Number(k));
