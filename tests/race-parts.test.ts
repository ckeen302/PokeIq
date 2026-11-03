import { describe, expect, it } from "vitest";
import { join } from "node:path";
import sharp from "sharp";
import { RACE_ENTRANTS, RACE_POKEMON } from "@/lib/race/data";
import { BAINBRIDGE, cycleRate, motionFor, swimStyle, tailBeatHz } from "@/lib/race/gait";
import { buildFigureMesh } from "@/lib/race/figure";
import { celebrationAt, dipAt, jointAngles, legSwing } from "@/lib/race/limbs";
import { describeParts, findParts, type ReliefPixels } from "@/lib/race/parts";
import { poolAt, poolBounds, poolDepth, poolModes, poolWalls, swimmerY, WATER_Y } from "@/lib/race/pool";
import { makeRace, runnerAt, spotsAt } from "@/lib/race/race";
import { cameraFor, leader } from "@/lib/race/director";
import { RUN_OUT, X0, lanePoint, type Distance } from "@/lib/race/track";
import type { Motion } from "@/lib/race/types";

/**
 * The runners' moving parts (lib/race/parts), their mesh (lib/race/figure),
 * how the parts swing (lib/race/limbs), the swimmers and their pool lanes
 * (lib/race/pool), and the promise that none of the animation changes a
 * race: the times, order and lanes below are what the model gave before
 * the runners moved their limbs.
 */

const enc = (z: number) => Math.max(0, Math.min(255, Math.round((z + 0.5) * 255)));

/** A synthetic relief map: `inside(x, y)` returns the nearness (z) of a pixel in the figure, or null outside. */
function relief(w: number, h: number, inside: (x: number, y: number) => number | null): ReliefPixels {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const z = inside(x, y);
      const i = (y * w + x) * 4;
      if (z == null) { data[i] = data[i + 1] = enc(0); continue; }
      data[i] = enc(z + 0.03);
      data[i + 1] = enc(z - 0.05);
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }
  return { w, h, data, channels: 4 };
}

const inRect = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

describe("moving parts", () => {
  it("finds a biped's two legs, hinged at the crotch, alternating", () => {
    // A torso on two separate legs.
    const m = relief(60, 100, (x, y) => (inRect(x, y, 15, 10, 45, 60) || inRect(x, y, 17, 60, 27, 99) || inRect(x, y, 33, 60, 43, 99) ? 0.05 : null));
    const p = findParts(m, { motion: "run", shape: "upright" });
    const legs = p.parts.filter((q) => q.kind === "leg");
    expect(legs).toHaveLength(2);
    expect(new Set(legs.map((l) => l.side))).toEqual(new Set([0, 1]));
    for (const l of legs) {
      expect(l.py).toBeGreaterThan(55);
      expect(l.py).toBeLessThan(64);
      expect(l.ty).toBeGreaterThan(95);
    }
    // Smooth joins: nothing moves at the hip, everything at the foot.
    const k = p.parts.indexOf(legs[0]) + 1;
    const top = Math.ceil(legs[0].py) + 1, foot = 98;
    const xs = Math.round(legs[0].tx);
    expect(p.label[foot * 60 + xs]).toBe(k);
    expect(p.weight[foot * 60 + xs]).toBeCloseTo(1, 3);
    expect(p.weight[top * 60 + xs]).toBeLessThan(0.45);
    expect(p.along[foot * 60 + xs]).toBeGreaterThan(0.9);
  });

  it("folds the toes of one foot into one leg", () => {
    const m = relief(60, 100, (x, y) => {
      if (inRect(x, y, 15, 10, 45, 55)) return 0.05;
      if (inRect(x, y, 20, 55, 28, 94) || inRect(x, y, 34, 55, 42, 94)) return 0.05;
      // Three claws under each foot.
      if (y > 94 && [19, 23, 27, 35, 38, 41].some((c) => Math.abs(x - c) <= 0)) return 0.05;
      return null;
    });
    const legs = findParts(m, { motion: "run", shape: "upright" }).parts.filter((q) => q.kind === "leg");
    expect(legs).toHaveLength(2);
  });

  it("finds four legs on a quadruped, front legs on the head side", () => {
    // A long body, the head up at the left, four legs.
    const m = relief(120, 70, (x, y) => {
      if (inRect(x, y, 5, 0, 30, 25)) return 0.12; // head, nearer
      if (inRect(x, y, 10, 15, 110, 40)) return 0.04;
      for (const c of [16, 34, 82, 100]) if (inRect(x, y, c - 4, 40, c + 4, 69)) return 0.03;
      return null;
    });
    const p = findParts(m, { motion: "gallop", shape: "quadruped" });
    const legs = p.parts.filter((q) => q.kind === "leg");
    expect(legs).toHaveLength(4);
    expect(p.facing).toBe(-1);
    const front = legs.filter((l) => l.front).map((l) => l.px).sort((a, b) => a - b);
    expect(front).toHaveLength(2);
    expect(front[1]).toBeLessThan(60);
  });

  it("finds a flier's wings, which sit behind its body", () => {
    const m = relief(120, 80, (x, y) => {
      if ((x - 60) ** 2 + (y - 45) ** 2 < 16 ** 2) return 0.12; // body, near
      if (((x - 25) / 24) ** 2 + ((y - 30) / 14) ** 2 < 1) return -0.06; // wings, behind
      if (((x - 95) / 24) ** 2 + ((y - 30) / 14) ** 2 < 1) return -0.06;
      return null;
    });
    const p = findParts(m, { motion: "fly", shape: "bug-wings" });
    const wings = p.parts.filter((q) => q.kind === "wing");
    expect(wings).toHaveLength(2);
    expect(wings.some((wg) => wg.tx < 40) && wings.some((wg) => wg.tx > 80)).toBe(true);
  });

  it("finds a tail held out behind", () => {
    // Facing left (the head end is nearer); a thin tail out of the lower back, on the right, farther away.
    const m = relief(100, 90, (x, y) => {
      if (inRect(x, y, 20, 5, 60, 85)) return x < 40 ? 0.08 : 0.04;
      if (inRect(x, y, 60, 55, 97, 61)) return -0.03;
      return null;
    });
    const p = findParts(m, { motion: "run", shape: "upright" });
    expect(p.parts.filter((q) => q.kind === "tail")).toHaveLength(1);
  });

  it("keeps balls, serpents and swimmers in whole-body motion", () => {
    const disc = relief(64, 64, (x, y) => ((x - 32) ** 2 + (y - 32) ** 2 < 30 ** 2 ? 0.1 : null));
    for (const motion of ["roll", "swim", "slither"] as Motion[]) expect(findParts(disc, { motion, shape: "ball" }).parts).toHaveLength(0);
    // A ball standing on the ground has no legs either.
    expect(findParts(disc, { motion: "run", shape: "ball" }).parts.filter((q) => q.kind === "leg")).toHaveLength(0);
    expect(describeParts({ parts: [] })).toBe("whole body");
  });

  it("finds the limbs of real runners from their relief maps", async () => {
    const load = async (id: number) => {
      const { data, info } = await sharp(join(process.cwd(), "public/sizes/depth", `${id}.webp`)).raw().toBuffer({ resolveWithObject: true });
      return { w: info.width, h: info.height, data: new Uint8Array(data), channels: info.channels as 3 | 4 };
    };
    const zeraora = findParts(await load(807), { motion: "run", shape: "humanoid" });
    expect(zeraora.parts.filter((q) => q.kind === "leg").length).toBeGreaterThanOrEqual(2);
    const arcanine = findParts(await load(59), { motion: "gallop", shape: "quadruped" });
    expect(arcanine.parts.filter((q) => q.kind === "leg").length).toBeGreaterThanOrEqual(3);
    const ninjask = findParts(await load(291), { motion: "fly", shape: "bug-wings" });
    expect(ninjask.parts.filter((q) => q.kind === "wing").length).toBeGreaterThanOrEqual(2);
    // Groudon's render faces right.
    expect(findParts(await load(383), { motion: "run", shape: "upright" }).facing).toBe(1);
  }, 30_000);
});

describe("the runner's mesh", () => {
  const m = relief(60, 100, (x, y) => (inRect(x, y, 15, 10, 45, 60) || inRect(x, y, 17, 60, 27, 99) || inRect(x, y, 33, 60, 43, 99) ? 0.05 : null));
  const parts = findParts(m, { motion: "run", shape: "upright" });
  const box = { x: 0, y: 0, w: 60, h: 100, size: 100 };
  const mesh = buildFigureMesh(m, box, 60, parts);

  it("is solid from the side: a sculpted back much deeper than the flat relief", () => {
    const flat = buildFigureMesh(m, box, 60, parts, { cap: 0, round: 0, soften: 0 });
    expect(mesh.thickness).toBeGreaterThan(flat.thickness * 1.6);
    expect(mesh.zMin).toBeLessThan(flat.zMin - 0.05);
  });

  it("is closed at the rim: front and back meet on the outline", () => {
    const n = mesh.position.length / 6;
    let rim = 0, open = 0;
    for (let v = 0; v < n; v++) {
      const x = mesh.position[v * 3], y = mesh.position[v * 3 + 1];
      // Vertices whose four nearest map pixels are all outside the figure (the outline's cells) have no thickness.
      const px = ((x + mesh.width / 2) / mesh.width) * 60 - 0.5, py = ((mesh.height - y) / mesh.height) * 100 - 0.5;
      let any = false;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const X = Math.max(0, Math.min(59, Math.floor(px) + dx)), Y = Math.max(0, Math.min(99, Math.floor(py) + dy));
        if (m.data[(Y * 60 + X) * 4 + 2] > 0) any = true;
      }
      if (any) continue;
      rim++;
      if (Math.abs(mesh.position[v * 3 + 2] - mesh.position[(v + n) * 3 + 2]) > 1e-6) open++;
    }
    expect(rim).toBeGreaterThan(20);
    expect(open).toBe(0);
  });

  it("tags each vertex with its part, easing in from the joint", () => {
    expect(mesh.joints.filter((j) => j.kind === "leg")).toHaveLength(2);
    const n = mesh.position.length / 3;
    let moving = 0;
    for (let v = 0; v < n; v++) {
      const slot = mesh.part[v * 3], w = mesh.part[v * 3 + 1];
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
      if (slot) {
        moving++;
        // Above the hip nothing follows.
        const j = mesh.joints[slot - 1];
        if (mesh.position[v * 3 + 1] > j.pivot[1] + 0.02) expect(w).toBe(0);
      } else expect(w).toBe(0);
    }
    expect(moving).toBeGreaterThan(50);
  });
});

describe("how the parts swing", () => {
  const clock = (phase: number, v = 10) => ({ motion: "run" as Motion, phase, v, hip: 0.9, time: 0 });
  it("alternates the legs, one in stance while the other swings", () => {
    // Phases where a foot is down (sprinters also have moments with both feet up).
    for (const ph of [0.1, 1.1, 2.15, 3.05]) {
      const a = jointAngles({ kind: "leg", side: 0, front: 0, out: 1 }, clock(ph));
      const b = jointAngles({ kind: "leg", side: 1, front: 0, out: 1 }, clock(ph));
      // The swinging leg folds its knee far more than the planted one.
      expect(Math.min(a.b, b.b)).toBeLessThan(Math.max(a.b, b.b) - 0.1);
    }
    // Over a stride (two steps) each leg sweeps back and forward again.
    const as = Array.from({ length: 40 }, (_, k) => jointAngles({ kind: "leg", side: 0, front: 0, out: 1 }, clock((k / 40) * 2)).a);
    expect(Math.max(...as)).toBeGreaterThan(0.3);
    expect(Math.min(...as)).toBeLessThan(-0.3);
  });
  it("plants the foot for the stance share of the stride, then swings it", () => {
    const st = legSwing(0.1, 0.2, 0.5, 0.4, 1);
    const sw = legSwing(0.6, 0.2, 0.5, 0.4, 1);
    expect(st.b).toBeGreaterThan(-0.2);
    expect(sw.b).toBeLessThan(-0.6);
  });
  it("pumps the arms against the legs, and stands still when stopped", () => {
    const leg = jointAngles({ kind: "leg", side: 0, front: 0, out: 1 }, clock(0.2));
    const arm = jointAngles({ kind: "arm", side: 0, front: 0, out: 1 }, clock(0.2));
    expect(Math.sign(arm.a)).toBe(-Math.sign(leg.a));
    const still = jointAngles({ kind: "leg", side: 0, front: 0, out: 1 }, clock(0.7, 0));
    expect(Math.abs(still.a) + Math.abs(still.b)).toBeLessThan(1e-9);
  });
  it("beats wings once per cycle", () => {
    const up = jointAngles({ kind: "wing", side: 0, front: 0, out: 1 }, { motion: "fly", phase: 0.25, v: 8, hip: 0.4, time: 0 });
    const down = jointAngles({ kind: "wing", side: 0, front: 0, out: 1 }, { motion: "fly", phase: 0.75, v: 8, hip: 0.4, time: 0 });
    expect(up.a).toBeGreaterThan(0.4);
    expect(down.a).toBeLessThan(-0.4);
    // A wing on the other side mirrors it.
    expect(jointAngles({ kind: "wing", side: 0, front: 0, out: -1 }, { motion: "fly", phase: 0.25, v: 8, hip: 0.4, time: 0 }).a).toBeCloseTo(-up.a);
  });
  it("dips at the line and celebrates after it", () => {
    expect(dipAt(10, 10.03)).toBeCloseTo(1, 5);
    expect(dipAt(9, 10)).toBeLessThan(0.01);
    expect(dipAt(11, 10)).toBeLessThan(0.01);
    expect(celebrationAt(0.5).jump).toBe(0);
    const hops = Array.from({ length: 60 }, (_, k) => celebrationAt(1.5 + k * 0.05).jump);
    expect(Math.max(...hops)).toBeGreaterThan(0.95);
  });
});

describe("swimmers and their pool lanes", () => {
  const mon = (slug: string) => RACE_ENTRANTS.find((e) => e.key === slug)!;
  it("puts fish and legless Water types that can't fly or float in the pool", () => {
    for (const k of ["magikarp", "wailord", "goldeen", "feebas", "kyogre", "tentacruel", "milotic", "lapras", "octillery"]) expect(mon(k).motion).toBe("swim");
    // Fliers and floaters keep flying or hovering, Water type or not.
    expect(mon("gyarados").motion).toBe("fly");
    expect(mon("mantine").motion).toBe("fly");
    expect(mon("jellicent").motion).toBe("hover");
    expect(mon("eelektross").motion).toBe("hover");
    // Serpents that aren't Water types slither; legged Water types run.
    expect(mon("seviper").motion).toBe("slither");
    expect(mon("dratini").motion).toBe("slither");
    expect(mon("totodile").motion).not.toBe("swim");
    // The rule, over the whole Pokédex.
    for (const e of RACE_POKEMON) {
      const fish = e.shape === "fish" || (e.types.includes("water") && (e.shape === "squiggle" || e.shape === "tentacles"));
      if (e.motion === "swim") expect(fish).toBe(true);
      if (fish && e.motion !== "swim") expect(["fly", "hover"]).toContain(e.motion);
    }
    expect(motionFor({ shape: "fish", types: ["water"], abilities: [], species: 129 })).toBe("swim");
    expect(motionFor({ shape: "fish", types: ["electric"], abilities: ["levitate"], species: 604 })).toBe("hover");
  });
  it("beats the tail at Bainbridge's rate: speed ≈ 0.75 × length × frequency", () => {
    expect(BAINBRIDGE).toBe(0.75);
    expect(tailBeatHz(3, 1)).toBeCloseTo(4, 6);
    // A whale beats slowly, a small fish fast (until the display limit).
    expect(cycleRate("swim", 6, 2, 398, 14.5)).toBeCloseTo(6 / (0.75 * 14.5), 6);
    expect(cycleRate("swim", 8, 0.4, 10, 0.9)).toBe(6);
    expect(swimStyle("fish")).toBe("carangiform");
    expect(swimStyle("squiggle")).toBe("anguilliform");
  });
  it("cuts the channel along exactly the stretch each swimmer covers", () => {
    for (const d of [100, 200, 400] as Distance[]) {
      for (const lane of [1, 4, 8]) {
        const modes = poolModes([lane], d);
        for (let s = -1; s <= d + RUN_OUT - 1; s += 0.5) {
          const p = lanePoint(lane, d, s);
          expect(poolAt(p.x, p.z, modes)).toBe(true);
          // The neighbouring lanes stay dry (except where the straight run-out crosses the start of bend 1, just past the line).
          if (lane < 8) { const q = lanePoint(lane + 1, d, s); if (q.x < X0) expect(poolAt(q.x, q.z, modes)).toBe(false); }
        }
        // Walls stand on the channel's edge, facing the water.
        for (const w of poolWalls(lane, d)) {
          for (let k = 0; k < w.pts.length - 1; k++) {
            const a = w.pts[k], b = w.pts[k + 1];
            const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
            expect(poolAt(mx + a.nx * 0.05, mz + a.nz * 0.05, modes)).toBe(true);
            // (A 400 m channel crosses itself at the line, where the shader cuts those walls away.)
            if (d !== 400) expect(poolAt(mx - a.nx * 0.05, mz - a.nz * 0.05, modes)).toBe(false);
          }
        }
        const [x0, z0, x1, z1] = poolBounds(modes);
        expect(x1).toBeGreaterThan(x0);
        expect(z1).toBeGreaterThan(z0);
      }
    }
    // A 100 m pool doesn't run round the bend; a 200 m one doesn't run down the back straight.
    expect(poolAt(0, -40, poolModes([3], 200))).toBe(false);
    expect(poolAt(0, -40, poolModes([3], 400))).toBe(true);
  });
  it("is deep enough for its swimmers, who float at the surface", () => {
    for (const h of [0.6, 2, 7.7]) {
      expect(swimmerY(h)).toBeLessThan(WATER_Y);
      expect(swimmerY(h)).toBeGreaterThan(-poolDepth([h]));
    }
  });
});

describe("the broadcast's framing", () => {
  it("shows the race from the front or three quarters, never side-on", () => {
    const es = ["regieleki", "zeraora", "arcanine", "groudon", "pikachu", "lucario"].map((k) => RACE_ENTRANTS.find((e) => e.key === k)!);
    const race = makeRace(es, 100);
    const ctx = { distance: 100 as const, aspect: 16 / 9, starts: spotsAt(race, 0) };
    for (const [cam, t] of [["rail", 2], ["rail", 4], ["headon", 5], ["line", race.first - 0.4], ["winner", race.first + 1.5], ["replay", race.first - 0.3]] as const) {
      const spots = spotsAt(race, t);
      const l = cam === "winner" ? spots.find((s) => s.lane === race.order[0].lane)! : leader(spots);
      const pose = cameraFor(cam, 0.5, spots, { ...ctx, lane: race.order[0].lane });
      const tx = pose.pos[0] - l.x, tz = pose.pos[2] - l.z;
      const along = (tx * l.dx + tz * l.dz) / Math.hypot(tx, tz);
      // In front of the leader, at most about 60° off head-on.
      expect(along, `${cam} at ${t} s`).toBeGreaterThan(Math.cos((62 * Math.PI) / 180));
    }
  });
});

const GOLDEN: Record<string, { order: string[]; times: number[]; lanes: number[] }> = {"regieleki,zeraora,arcanine,ninjask,groudon,pikachu,magikarp,wailord@100":{"order":["regieleki","ninjask","zeraora","arcanine","pikachu","groudon","magikarp","wailord"],"times":[6.383657,7.355731,8.21302,11.913636,12.223321,12.698364,14.011446,18.238048],"lanes":[4,5,3,6,7,2,8,1]},"regieleki,zeraora,arcanine,ninjask,groudon,pikachu,magikarp,wailord@200":{"order":["regieleki","ninjask","zeraora","arcanine","pikachu","groudon","magikarp","wailord"],"times":[11.423706,13.659867,15.25199,22.515665,23.521516,23.880638,26.813111,34.98697],"lanes":[4,5,3,6,7,2,8,1]},"regieleki,zeraora,arcanine,ninjask,groudon,pikachu,magikarp,wailord@400":{"order":["regieleki","ninjask","zeraora","arcanine","groudon","pikachu","magikarp","wailord"],"times":[22.620295,28.10502,30.913846,46.120032,48.57783,50.970774,59.776056,70.892356],"lanes":[4,5,3,6,7,2,8,1]},"shuckle,regieleki@100":{"order":["regieleki","shuckle"],"times":[6.383657,201.624086],"lanes":[3,6]},"shuckle,regieleki@200":{"order":["regieleki","shuckle"],"times":[11.423706,408.930136],"lanes":[3,6]},"shuckle,regieleki@400":{"order":["regieleki","shuckle"],"times":[22.620295,942.415522],"lanes":[3,6]},"gyarados,milotic,tentacruel,jellicent,goldeen,kyogre,feebas@100":{"order":["tentacruel","kyogre","gyarados","milotic","feebas","goldeen","jellicent"],"times":[11.338486,12.638596,13.764662,13.871885,13.880144,17.056415,18.16546],"lanes":[4,5,3,6,7,2,8]},"gyarados,milotic,tentacruel,jellicent,goldeen,kyogre,feebas@200":{"order":["tentacruel","kyogre","gyarados","milotic","feebas","goldeen","jellicent"],"times":[21.416907,23.821991,26.200258,26.30491,26.693068,33.170571,34.959484],"lanes":[4,5,3,6,7,2,8]},"gyarados,milotic,tentacruel,jellicent,goldeen,kyogre,feebas@400":{"order":["tentacruel","kyogre","gyarados","milotic","feebas","goldeen","jellicent"],"times":[44.054272,48.527899,53.799275,53.887896,59.694751,71.368741,72.132717],"lanes":[4,5,3,6,7,2,8]},"deoxys-speed,accelgor,electrode,rapidash,dodrio,lugia,mewtwo,eevee@100":{"order":["deoxys-speed","electrode","accelgor","mewtwo","dodrio","lugia","rapidash","eevee"],"times":[6.840792,8.09685,8.13355,9.045355,10.39743,10.56798,10.863717,19.302986],"lanes":[4,5,3,6,7,2,8,1]},"deoxys-speed,accelgor,electrode,rapidash,dodrio,lugia,mewtwo,eevee@200":{"order":["deoxys-speed","electrode","accelgor","mewtwo","dodrio","lugia","rapidash","eevee"],"times":[12.449541,14.81957,15.078455,16.781429,19.575063,19.711864,20.473632,37.732496],"lanes":[4,5,3,6,7,2,8,1]},"deoxys-speed,accelgor,electrode,rapidash,dodrio,lugia,mewtwo,eevee@400":{"order":["deoxys-speed","electrode","accelgor","mewtwo","lugia","dodrio","rapidash","eevee"],"times":[25.475281,30.200725,30.637406,33.771243,39.807993,40.679729,42.421762,80.60684],"lanes":[4,5,3,6,7,2,8,1]}};

describe("the animation never changes a race", () => {
  it("keeps every time, place and lane the model gave before the runners moved", () => {
    for (const [key, want] of Object.entries(GOLDEN)) {
      const [keys, d] = key.split("@");
      const es = keys.split(",").map((k) => RACE_ENTRANTS.find((e) => e.key === k)!);
      const r = makeRace(es, Number(d) as Distance);
      expect(r.order.map((x) => x.entrant.key)).toEqual(want.order);
      expect(r.order.map((x) => x.lane)).toEqual(want.lanes);
      r.order.forEach((x, i) => expect(x.time).toBeCloseTo(want.times[i], 5));
    }
  });
  it("draws each runner where the model puts it, whatever its gait", () => {
    const es = ["regieleki", "magikarp", "wailord", "zeraora"].map((k) => RACE_ENTRANTS.find((e) => e.key === k)!);
    const a = makeRace(es, 100);
    // The same field with every gait swapped: identical times and positions.
    const b = makeRace(es.map((e) => ({ ...e, motion: (e.motion === "swim" ? "run" : "swim") as Motion })), 100);
    a.lanes.forEach((r, i) => {
      expect(r.time).toBe(b.lanes[i].time);
      for (const t of [0.5, 3, 7, r.time, r.time + 2]) expect(runnerAt(a, r, t).x).toBe(runnerAt(b, b.lanes[i], t).x);
    });
  });
});

