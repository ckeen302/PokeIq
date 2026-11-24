import type { Box } from "@/components/atlas/atlas-engine";

/*
 * Desktop: GeoGuessr's guess map, measured off GeoGuessr itself: 16% of the
 * window's width by 17% of its height until the pointer reaches it (160×98 in
 * a 1000×578 window), then 30% by 36.4% (the default step).
 */
export const REST = { w: "16vw", h: "17vh" };
/** The smallest the map gets in a small window. */
export const MIN_W = 150;
export const MIN_H = 90;
/** The resting map's width in CSS px, as the dock sizes it. */
export const restWidth = () => Math.min(Math.max(window.innerWidth * 0.16, MIN_W), window.innerWidth - 64);
/** GeoGuessr's resting map is zoomed in: the world is about 2.9 times as wide as the box, so about a third of it shows. */
export const DOCK_ZOOM = 2.9;
/** Zoomed right out, the map stops this much closer than the whole world's width: less empty sea above and below. */
export const DOCK_FLOOR_ZOOM = 1;

/**
 * Open, the dock shows the whole world drawn a little taller than it is, so it
 * fills the box like GeoGuessr's with no empty sea above and below: the land
 * as painted on the world map (its outermost coasts, x 138–5662 and y 144–2470
 * in world px) with a little sea round it, about 10 px of blue on every side
 * at GeoGuessr's hovered size. The regions keep their places; only the
 * drawing is taller, easing back to the map's own shape as you zoom in.
 */
export const DOCK_WORLD: Box = [138 - 200, 144 - 125, 5662 + 200, 2470 + 125];

/** Where a whole-world guess map starts: the dock zoomed in on the land's middle (GeoGuessr's), the phone card filled with the land. */
export function dockHome(box: Box, dock: boolean) {
  if (!dock) return { box, cover: true };
  // A little left of and below the land's middle: the resting map has Paldea, Johto and Hoenn in it (GeoGuessr's shows three
  // continents), and once open, Galar's name sits clear of the zoom buttons.
  const at: [number, number] = [box[0] + (box[2] - box[0]) * 0.465, box[1] + (box[3] - box[1]) * 0.56];
  // Hovered or pinned open, the map shows the whole world at once (DOCK_WORLD, filling the box; where the window's shape would
  // need too much stretch, the land with a little sea round it, as large as fits); at rest it's zoomed in like GeoGuessr's.
  const floor: Box = box;
  const open = (W: number) => W > restWidth() * 1.25;
  return { box, at, floor, floorZoom: DOCK_FLOOR_ZOOM, open, stretch: DOCK_WORLD, scale: () => (DOCK_ZOOM * restWidth()) / (box[2] - box[0]) };
}
