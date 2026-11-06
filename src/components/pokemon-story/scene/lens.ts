import type { Vec3 } from "@/lib/world-history/camera";
import type { ChapterCtx, ChapterRig, Look } from "@/components/world-history/scene/types";

/**
 * The Story's lens, laid over every chapter's own grade (index.ts wraps each
 * builder): the filmic tone curve (bright colours roll toward white instead
 * of clipping to neon, dark warm scenes keep their shadows), a little edge
 * fringe and anamorphic streak, camera motion blur, height fog where a place
 * has air (a field at golden hour, a morning village, a night city), and the
 * edit: every cut in a chapter's camera is found once, and the energetic
 * chapters cut with a whip smear and a colour-fringe kick.
 */

type Fog = NonNullable<Look["fog"]>;
interface LensSpec {
  /** Height fog by moment (undefined: none). */
  fog?: (t: number, b: (id: string) => number) => Fog | undefined;
  /** Exposure (and gain) tweaks by moment. */
  grade?: (t: number, b: (id: string) => number, L: Look) => Partial<Look>;
  /** Cut style: whip smears on the cuts, or clean hard cuts with a light fringe kick. */
  whip?: boolean;
  streak?: number;
  mblur?: number;
  /** Pass-2 grade overrides (real black point, hue-held highlights, bloom on hot cores only). */
  black?: number;
  hueKeep?: number;
  bloomCap?: number;
  split?: Look["split"];
}

const ramp = (t: number, a: number, b: number) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const mix3 = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

const SPECS: Record<string, LensSpec> = {
  collector: {
    black: 0.06,
    // Golden-hour air over the field, then a grey city haze once it's paved.
    fog: (t, b) => {
      const k = ramp(t, b("paved") + 0.5, b("paved") + 4);
      // Thinner round the jar, so the sunset keeps its depth and the trees stay dark.
      const jar = ramp(t, b("jar") - 1.2, b("jar")) * (1 - ramp(t, b("paved") - 0.5, b("paved") + 1));
      return { color: mix3([0.42, 0.27, 0.12], [0.1, 0.1, 0.12], k), density: (0.009 - 0.003 * k) * (1 - 0.6 * jar), height: 0, falloff: 0.55, sky: 0.12 * (1 - jar) };
    },
    streak: 0.22,
  },
  "game-freak": {
    // Arcade smoke under the neon; the desk room is clean.
    fog: (t, b) => (t < b("zine") - 0.3 ? { color: [0.07, 0.025, 0.08], density: 0.014, height: 0, falloff: 0.35, sky: 0 } : undefined),
    streak: 0.25,
  },
  cable: { streak: 0.2 },
  "six-years": {
    whip: true,
    // The wall of 151 glows through the room's air (in-scatter toward it from where the camera stands).
    fog: (t, b) => {
      const k = ramp(t, b("151") + 0.5, b("151") + 2.5) * (1 - ramp(t, b("mew") - 0.4, b("mew") + 0.4));
      return k > 0.01 ? { color: [0.015, 0.012, 0.018], density: 0.03 * k, height: 1.5, falloff: 0.25, sun: { dir: [0.55, 0.22, -0.8], color: [0.32, 0.19, 0.07] }, sky: 0 } : undefined;
    },
  },
  "red-green": {
    // Morning mist in the village, warming toward dusk.
    fog: (t, b) => {
      if (t < b("launch") + 1.6) return undefined;
      const dusk = ramp(t, b("word") - 0.5, b("word") + 2);
      return { color: mix3([0.62, 0.68, 0.74], [0.5, 0.36, 0.3], dusk), density: 0.007, height: 0, falloff: 0.5, sky: 0.1 };
    },
  },
  pokemania: {
    whip: true,
    // The globe (the 60-second cut's beat) read dark: open it up.
    grade: (t, b, L) => {
      const k = ramp(t, b("world") - 0.4, b("world") + 0.4) * (1 - ramp(t, b("catch") - 0.3, b("catch")));
      // The card burst ran hot under the filmic curve: hold it down so the foil reads, not white.
      const cards = 0.3 * (1 - ramp(t, b("anime") - 0.5, b("anime")));
      return { exposure: L.exposure * (1 + 0.38 * k) * (1 - 0.2 * cards), bloomThreshold: L.bloomThreshold + 0.08 * cards, lift: [L.lift[0] + 0.01 * k, L.lift[1] + 0.012 * k, L.lift[2] + 0.02 * k] };
    },
    streak: 0.25,
  },
  growing: {
    // Air between the regions; none in orbit. Johto's night is truly night.
    fog: (t, b) => {
      const space = ramp(t, b("online") + 0.6, b("online") + 2) * (1 - ramp(t, b("worlds") - 0.8, b("worlds") + 0.6));
      if (space > 0.98) return undefined;
      const night = ramp(t, b("clock") + 2.5, b("clock") + 4.5) * (1 - ramp(t, b("colour") - 1.2, b("colour") + 0.6));
      return { color: mix3([0.3, 0.42, 0.58], [0.015, 0.025, 0.07], night), density: 0.0045 * (1 - space), height: 0, falloff: 0.06, sky: 0.3 };
    },
    grade: (t, b, L) => {
      const night = ramp(t, b("clock") + 2.5, b("clock") + 4.5) * (1 - ramp(t, b("colour") - 1.2, b("colour") + 0.6));
      return { exposure: L.exposure * (1 - 0.32 * night), gain: [L.gain[0] * (1 - 0.18 * night), L.gain[1] * (1 - 0.1 * night), L.gain[2]], saturation: L.saturation * (1 - 0.15 * night) };
    },
  },
  together: {
    fog: (t, b) => {
      if (t > b("alola") + 3) return { color: [0.62, 0.76, 0.86], density: 0.004, height: 0, falloff: 0.3, sky: 0.12 };
      // A teal glade haze behind Xerneas, so it stands clear of the dark.
      if (t > b("fold") - 0.2 && t < b("outbreak") - 0.2) return { color: [0.02, 0.09, 0.11], density: 0.03, height: 0.5, falloff: 0.25, sky: 0.1 };
      return undefined;
    },
  },
  outside: {
    whip: true,
    // Night air in the city, so the towers stack in depth.
    fog: (t, b) => (t > b("launch") + 0.6 ? { color: [0.03, 0.075, 0.08], density: 0.011, height: 0, falloff: 0.05, sky: 0.25 } : undefined),
    streak: 0.25,
  },
  "open-worlds": {
    whip: true,
    fog: (t, b) => {
      if (t > b("hisui") - 0.2 && t < b("open") - 0.2) return { color: [0.7, 0.55, 0.45], density: 0.008, height: 0, falloff: 0.3, sky: 0.15 };
      if (t > b("open") - 0.2 && t < b("champion") - 0.3) return { color: [0.66, 0.76, 0.88], density: 0.004, height: 0, falloff: 0.04, sky: 0.25 };
      // Stadium haze, so the floodlight beams stand in the air and the stands fall back in depth.
      const stadium = (t > b("galar") - 0.2 && t < b("twenty-five") - 0.2) || (t > b("champion") - 0.2 && t < b("farewell") - 0.2);
      if (stadium) return { color: [0.07, 0.05, 0.07], density: 0.022, height: 1, falloff: 0.07, sky: 0 };
      // Lumiose: warm city haze low between the blocks, so the avenue recedes and the tower stands over it.
      if (t > b("lumiose") - 0.2) return { color: [0.1, 0.065, 0.07], density: 0.014, height: 0, falloff: 0.06, sky: 0.3 };
      return undefined;
    },
    streak: 0.25,
  },
  thirty: {
    // The final field: Chapter I's golden air.
    fog: (t, b) => (t > b("yours") + 1.2 ? { color: [0.42, 0.27, 0.12], density: 0.009, height: 0, falloff: 0.55, sky: 0.12 } : undefined),
    streak: 0.2,
  },
};

/** Every cut in a camera path: times where the pose jumps between two frames, and which way the view swung. */
export function findCuts(camera: ChapterRig["camera"], end: number): { at: number; dir: number }[] {
  const out: { at: number; dir: number }[] = [];
  const h = 1 / 60;
  const p0 = camera(0);
  let p1 = camera(h);
  let prevStep = Math.hypot(p1.pos[0] - p0.pos[0], p1.pos[1] - p0.pos[1], p1.pos[2] - p0.pos[2]);
  for (let t = 2 * h; t <= end; t += h) {
    const p2 = camera(t);
    const step = Math.hypot(p2.pos[0] - p1.pos[0], p2.pos[1] - p1.pos[1], p2.pos[2] - p1.pos[2]);
    const la = Math.atan2(p1.look[0] - p1.pos[0], p1.look[2] - p1.pos[2]), lb = Math.atan2(p2.look[0] - p2.pos[0], p2.look[2] - p2.pos[2]);
    let dy = lb - la;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    if ((step > 0.5 && step > prevStep * 8) || Math.abs(dy) > 0.5) {
      if (!out.length || t - out[out.length - 1].at > 0.4) out.push({ at: t, dir: dy >= 0 ? -1 : 1 });
    }
    prevStep = Math.max(1e-4, step);
    p1 = p2;
  }
  return out;
}

export function lens(id: string, rig: ChapterRig, ctx: ChapterCtx): ChapterRig {
  const spec = SPECS[id] ?? {};
  const b = ctx.beat;
  const cuts = findCuts(rig.camera.bind(rig), ctx.timing.anim);
  const look = rig.look.bind(rig);
  return Object.assign(rig, {
    look(t: number): Look {
      const L = look(t);
      // Cuts: a smear in the direction of travel and a fringe kick, gone within a few frames.
      let kick = 0, dir = 1;
      for (const c of cuts) {
        const d = t - c.at;
        if (d >= -0.02 && d < 0.3) { const k = Math.exp(-Math.max(0, d) * 16); if (k > kick) { kick = k; dir = c.dir; } }
      }
      const fog = L.fog ?? spec.fog?.(t, b);
      const out: Look = {
        ...L,
        ...(spec.grade?.(t, b, L) ?? {}),
        tone: L.tone ?? "filmic",
        // The filmic curve rolls off saturation and contrast a little; give them back so each chapter keeps its grade.
        saturation: (L.tone ? L.saturation : L.saturation * 1.1),
        contrast: (L.tone ? L.contrast : L.contrast * 1.06),
        fringe: (L.fringe ?? 0.04) + kick * (spec.whip ? 0.7 : 0.3),
        streak: L.streak ?? spec.streak ?? 0.15,
        streakColor: L.streakColor ?? [1, 0.85, 0.65],
        mblur: L.mblur ?? spec.mblur ?? 0.7,
        fog,
      };
      // Pass 2: real blacks, hot lights keep their hue, bloom only on what is truly hot (capped, so a bright mass can't
      // box out the frame), flashes as light rather than a grey veil, cool shadows against warm highlights.
      out.black = L.black ?? spec.black ?? 0.04;
      out.hueKeep = L.hueKeep ?? spec.hueKeep ?? 0.8;
      out.bloomKnee = L.bloomKnee ?? 0.7;
      out.bloomCap = L.bloomCap ?? spec.bloomCap ?? 4;
      out.flashHdr = L.flashHdr ?? true;
      out.split = L.split ?? spec.split ?? { shadows: [-0.012, 0.0, 0.03], highlights: [0.03, 0.012, -0.02] };
      out.chroma = Math.min(out.chroma, 0.25);
      if (spec.whip && kick > 0.02 && !L.whip) out.whip = { dir: [dir, 0], k: kick * 0.9 };
      return out;
    },
  });
}
