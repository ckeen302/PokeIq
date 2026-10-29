"use client";

import type { Avatar3DSceneProps } from "./Avatar3D";

/** The three.js scene behind <Avatar3D> (loaded lazily). */
export function Avatar3DScene(props: Avatar3DSceneProps) {
  return <div className="absolute inset-0" data-partner={props.config.partner} />;
}
