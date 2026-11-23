import * as THREE from "three";
import type { CityKit } from "../kit";
import { buildNimbasaCity } from "./city";
import { createNightSky, nightEnvironment } from "./sky";
import { buildVenues, venueSites } from "./venues";
import { WHEEL, buildWheel } from "./wheel";

/**
 * Nimbasa City for Pokémon Sizes: Unova's city of entertainment, lit up at
 * night. The line walks down its main promenade between bright shopfronts
 * and signs and round the great Ferris wheel at the centre of its plaza
 * (where Prism Tower stands in Lumiose); the Big Stadium, the Small Court,
 * the Musical Theater, Gear Station with its rail lines and the amusement
 * park with its roller coaster gym stand round it. Our own procedural design
 * in the spirit of the city, on the same plan as Lumiose (lib/sizes/world),
 * so everything the scene does there (any comparison, the glide, the aerial
 * finale, the videos) works here too. Loaded only when Nimbasa is chosen.
 *
 * The light: a cool floodlight from the same side as Lumiose's sun (in front
 * of the figures, to the camera's left: their faces stay lit), a violet sky
 * fill, the warm and neon glow of the city in the reflections, and a strong
 * bloom on everything that shines.
 */
export const NIMBASA: CityKit = {
  id: "nimbasa",
  look: {
    sunElevation: (36 * Math.PI) / 180,
    sunColor: "#e6e2ff",
    sunIntensity: 2.9,
    hemi: { sky: "#7a6fd0", ground: "#7a5570", intensity: 0.85 },
    fog: { color: "#3a2a5e", density: 0.00036 },
    exposure: 1.02,
    envIntensity: 0.75,
    post: { bloom: [0.62, 0.62, 0.82], saturation: 1.14, warmth: 0, vignette: 0.28 },
  },
  landmark: WHEEL,
  createSky: () => createNightSky(),
  environment: (renderer, pmrem, sunDir) => nightEnvironment(renderer, pmrem, sunDir),
  build(plan, shared, tex, quality) {
    const group = new THREE.Group();
    group.name = "nimbasa";
    const sites = venueSites(plan);
    const city = buildNimbasaCity(plan, shared, tex, quality, sites.keep, sites.station);
    const venues = buildVenues(plan, sites, shared, tex, quality);
    // The wheel turns its face to where the camera frames it: halfway round the giants' ring, or down the promenade.
    let yaw: number;
    if (plan.ring) {
      const turn = Math.max(0, (plan.lineEnd - plan.ring.s0) / plan.ring.r);
      yaw = Math.PI - turn * 0.5;
    } else {
      yaw = Math.atan2(plan.lineEnd - plan.tower.x, 0 - plan.tower.z);
    }
    const wheel = buildWheel(plan.tower.x, plan.tower.z, yaw, quality.blocks);
    group.add(city.group, venues.group, wheel.group);
    return {
      group,
      update: (camera, range) => city.update(camera, range),
      tick(t) {
        city.tick(t);
        venues.tick(t);
        wheel.tick(t);
      },
      setCoverage() { /* no cut-out foliage here */ },
      dispose() {
        city.dispose();
        venues.dispose();
        wheel.dispose();
      },
    };
  },
};

export default NIMBASA;
