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
