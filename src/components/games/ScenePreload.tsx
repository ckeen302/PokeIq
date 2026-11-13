"use client";

import "./scene";

/**
 * Renders nothing. Loaded with next/dynamic, it puts the 3D scene's code
 * (three.js and the scene) among the chunks the page's HTML preloads, so on a
 * phone connection it downloads alongside the page's own scripts instead of
 * starting after they have run.
 */
export default function ScenePreload() {
  return null;
}
