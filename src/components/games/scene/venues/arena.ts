import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ARENA, REF_LIGHTS, dohyoScale, dohyoTop } from "@/lib/games/venues";
import { buildCrowd, type Crowd } from "@/components/race/scene/crowd";
import { rng } from "@/components/race/scene/textures";
import type { Props } from "../../show/types";

/**
 * The indoor arena of the PokéIQ Games, for weightlifting and wrestling:
 *
 * - a dark hall with raked stands on all four sides (the Race's crowd,
 *   seated row by row), an LED ribbon along the front of the stands and a
 *   centre-hung scoreboard;
 * - the field of play: a blue carpet square, with the IWF competition
 *   platform (4 m square, 10 cm tall: a wooden lifting surface between
 *   rubber landing strips) and the referees' table; or the wrestling ring,
 *   a raised clay dohyō with its straw ring and starting lines, scaled up
 *   for giants (lib/games/venues: dohyoScale);
 * - lit like a broadcast hall: a key spot on the field of play, the stands
 *   in half-light, the rig and the scoreboard glowing.
 *
 * Only the field-of-play pieces the current event uses are shown.
 */

export interface ArenaWorld {
  group: THREE.Group;
  env: THREE.Texture;
  fog: THREE.FogExp2;
  update(t: number, cam: THREE.Camera, excitement: number): void;
  setProps(p: Props, t: number): void;
  dispose(): void;
}

const ROWS = 15;
const ROW_D = 0.86;
const ROW_H = 0.42;
const FRONT_Y = 1.15;

export function buildArena(o: { renderer: THREE.WebGLRenderer; font: string; occupancy: number; flashes: number; aniso: number }): ArenaWorld {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const G = <X extends THREE.BufferGeometry>(g: X) => { geos.push(g); return g; };
  const M = <X extends THREE.Material>(m: X) => { mats.push(m); return m; };
  const T = <X extends THREE.Texture>(t: X) => { t.anisotropy = o.aniso; texs.push(t); return t; };
  const canvas = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")!] as const; };
  const r = rng(77);

  // ---- The hall: floor, walls, ceiling rig.
  const floorTex = (() => {
    const [c, g] = canvas(512, 512);
    g.fillStyle = "#1a1c22";
    g.fillRect(0, 0, 512, 512);
    // Sealed concrete: soft blotches and the joints between slabs.
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? "255,255,255" : "0,0,0"},${0.015 + r() * 0.03})`;
      g.beginPath();
      g.arc(r() * 512, r() * 512, 8 + r() * 40, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = "rgba(0,0,0,0.35)";
    g.lineWidth = 2;
    g.strokeRect(0, 0, 512, 512);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(10, 10);
    return T(t);
  })();
  const floor = new THREE.Mesh(G(new THREE.PlaneGeometry(90, 90).rotateX(-Math.PI / 2)), M(new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.38, metalness: 0.05 })));
  group.add(floor);

  // The field of play: a blue carpet with its border and the Games' name.
  const carpetTex = (() => {
    const [c, g] = canvas(1024, 1024);
    const grad = g.createRadialGradient(512, 512, 60, 512, 512, 720);
    grad.addColorStop(0, "#1f4a9a");
    grad.addColorStop(1, "#122a5c");
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.035})`;
      g.fillRect(r() * 1024, r() * 1024, 2, 2);
    }
    g.strokeStyle = "#ffd23f";
    g.lineWidth = 10;
    g.strokeRect(26, 26, 972, 972);
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `800 46px ${o.font}`;
    for (let k = 0; k < 4; k++) {
      g.save();
      g.translate(512, 512);
      g.rotate((k * Math.PI) / 2);
      g.fillText("THE POKÉIQ GAMES", 0, 452);
      g.restore();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return T(t);
  })();
  const carpet = new THREE.Mesh(G(new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2)), M(new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1 })));
  carpet.position.y = 0.004;
  group.add(carpet);

  // Walls and ceiling: a dark box round the stands.
  const d1 = ARENA.seats + ROWS * ROW_D;
  const hallR = d1 + 4;
  const hall = new THREE.Mesh(G(new THREE.BoxGeometry(hallR * 2, 34, hallR * 2)), M(new THREE.MeshStandardMaterial({ color: "#07090e", roughness: 0.95, side: THREE.BackSide })));
  hall.position.y = 17;
  group.add(hall);
  // The lighting rig: trusses in squares under the roof, with lamps that glow.
  {
    const truss = M(new THREE.MeshStandardMaterial({ color: "#2a2e36", roughness: 0.6, metalness: 0.5 }));
    const lamp = M(new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 6.6, 6), toneMapped: false }));
    const bars: THREE.BufferGeometry[] = [];
    const bulbs: THREE.BufferGeometry[] = [];
    for (const R of [9, 15]) {
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        const b = new THREE.BoxGeometry(R * 2, 0.5, 0.5);
        b.rotateY(a);
        b.translate(Math.sin(a) * R, 24, Math.cos(a) * R);
        bars.push(b);
        for (let i = -3; i <= 3; i++) {
          const lb = new THREE.BoxGeometry(0.5, 0.25, 0.5);
          const along = (i / 3.5) * R;
          lb.translate(Math.sin(a) * R + Math.cos(a) * along, 23.6, Math.cos(a) * R - Math.sin(a) * along);
          bulbs.push(lb);
        }
      }
    }
    const tm = new THREE.Mesh(G(mergeGeometries(bars)), truss);
    const lm = new THREE.Mesh(G(mergeGeometries(bulbs)), lamp);
    bars.concat(bulbs).forEach((x) => x.dispose());
    group.add(tm, lm);
  }

  // ---- Stands: raked rows on four sides (concentric squares), the crowd seated on them.
  const rows: { pts: { x: number; z: number; nx: number; nz: number }[]; y: number; tier: 0 | 1 }[] = [];
  {
    const steps: THREE.BufferGeometry[] = [];
    for (let i = 0; i < ROWS; i++) {
      const d = ARENA.seats + i * ROW_D;
      const y = FRONT_Y + i * ROW_H;
      const pts: { x: number; z: number; nx: number; nz: number }[] = [];
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        const nx = Math.sin(a), nz = Math.cos(a);
        // The step: a solid block from the floor to this row's seat, the side's full length (corners closed).
        const b = new THREE.BoxGeometry(2 * (d + ROW_D), y, ROW_D);
        b.translate(0, y / 2, 0);
        b.rotateY(a);
        b.translate(nx * (d + ROW_D / 2), 0, nz * (d + ROW_D / 2));
        steps.push(b);
        const span = 2 * d - 1.2;
        const n = Math.floor(span / 0.56);
        for (let j = 0; j < n; j++) {
          // An aisle after every 12 seats.
          if (j % 13 === 12) continue;
          const u = -d + 0.6 + (j + 0.5) * (span / n);
          pts.push({ x: nx * (d + 0.3) + nz * u, z: nz * (d + 0.3) - nx * u, nx, nz });
        }
      }
      rows.push({ pts, y, tier: i < 8 ? 0 : 1 });
    }
    const standTex = (() => {
      const [c, g] = canvas(64, 64);
      g.fillStyle = "#18233f";
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = "#0e1428";
      g.fillRect(0, 44, 64, 20);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return T(t);
    })();
    const sm = new THREE.Mesh(G(mergeGeometries(steps)), M(new THREE.MeshStandardMaterial({ map: standTex, roughness: 0.85 })));
    steps.forEach((x) => x.dispose());
    group.add(sm);
  }
  const crowd: Crowd = buildCrowd({ occupancy: Math.min(1, o.occupancy * 1.02), flashes: Math.round(o.flashes * 0.5), rows, light: { y: 22 } });
  group.add(crowd.group);

  // The LED ribbon along the front of the stands.
  const ribbonTex = (() => {
    const W = 4096, H = 96;
    const [c, g] = canvas(W, H);
    const panels = [
      { bg: "#0b1a3a", fg: "#ffffff", text: "THE POKÉIQ GAMES" },
      { bg: "#ffd23f", fg: "#14213d", text: "POKÉIQ" },
      { bg: "#d7263d", fg: "#ffffff", text: "STRENGTH NIGHT" },
      { bg: "#101010", fg: "#3bceac", text: "WEIGHTLIFTING · WRESTLING" },
      { bg: "#1b4965", fg: "#ffffff", text: "WHO IS STRONGEST?" },
      { bg: "#6a4c93", fg: "#ffffff", text: "THE POKÉIQ GAMES" },
    ];
    const pw = W / panels.length;
    panels.forEach((p, i) => {
      g.fillStyle = p.bg;
      g.fillRect(i * pw, 0, pw, H);
      g.fillStyle = p.fg;
      let px = 56;
      g.font = `800 ${px}px ${o.font}`;
      while (g.measureText(p.text).width > pw * 0.88 && px > 18) { px -= 4; g.font = `800 ${px}px ${o.font}`; }
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(p.text, i * pw + pw / 2, H * 0.53);
    });
    g.fillStyle = "rgba(0,0,0,0.3)";
    for (let x = 0; x < W; x += 4) g.fillRect(x, 0, 1, H);
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    return T(t);
  })();
  const ribbonMat = M(new THREE.MeshBasicMaterial({ map: ribbonTex, color: new THREE.Color(1.6, 1.6, 1.6) }));
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const d = ARENA.seats - 0.02;
    const rb = new THREE.Mesh(G(new THREE.PlaneGeometry(2 * d, 0.8)), ribbonMat);
    rb.position.set(Math.sin(a) * d, 0.62, Math.cos(a) * d);
    rb.rotation.y = a + Math.PI;
    group.add(rb);
  }

  // The centre-hung scoreboard: four screens and a glowing rim.
  const [boardC, boardG] = canvas(1024, 576);
  const boardTex = T(new THREE.CanvasTexture(boardC));
  boardTex.colorSpace = THREE.SRGBColorSpace;
  let boardText = "";
  const drawBoard = (title: string) => {
    if (title === boardText) return;
    boardText = title;
    const g = boardG;
    const grad = g.createLinearGradient(0, 0, 0, 576);
    grad.addColorStop(0, "#0b1a3a");
    grad.addColorStop(1, "#04070f");
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 576);
    g.fillStyle = "#ffd23f";
    g.fillRect(0, 500, 1024, 12);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#ffffff";
    g.font = `800 92px ${o.font}`;
    g.fillText("THE POKÉIQ GAMES", 512, 200, 960);
    g.fillStyle = "#ffd23f";
    g.font = `800 70px ${o.font}`;
    g.fillText(title.toUpperCase(), 512, 330, 960);
    g.fillStyle = "rgba(0,0,0,0.25)";
    for (let x = 0; x < 1024; x += 4) g.fillRect(x, 0, 1, 576);
    boardTex.needsUpdate = true;
  };
  drawBoard("Weightlifting");
  const board = new THREE.Group();
  {
    const shell = new THREE.Mesh(G(new THREE.BoxGeometry(8.4, 4.9, 8.4)), M(new THREE.MeshStandardMaterial({ color: "#101318", roughness: 0.5, metalness: 0.4 })));
    board.add(shell);
    const screenMat = M(new THREE.MeshBasicMaterial({ map: boardTex, color: new THREE.Color(1.3, 1.3, 1.3) }));
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      const s = new THREE.Mesh(G(new THREE.PlaneGeometry(8, 4.5)), screenMat);
      s.position.set(Math.sin(a) * 4.21, 0, Math.cos(a) * 4.21);
      s.rotation.y = a;
      board.add(s);
    }
    const rimGlow = new THREE.Mesh(G(new THREE.BoxGeometry(8.6, 0.25, 8.6)), M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.4, 2.4), toneMapped: false })));
    rimGlow.position.y = -2.55;
    board.add(rimGlow);
  }
  board.position.set(0, 17, 0);
  group.add(board);

  // ---- The weightlifting platform.
  const platform = new THREE.Group();
  {
    const P = ARENA.platform, h = ARENA.platformH;
    const base = new THREE.Mesh(G(new THREE.BoxGeometry(P, h, P)), M(new THREE.MeshStandardMaterial({ color: "#16171b", roughness: 0.9 })));
    base.position.y = h / 2;
    platform.add(base);
    const woodTex = (() => {
      const [c, g] = canvas(512, 1024);
      g.fillStyle = "#c79a62";
      g.fillRect(0, 0, 512, 1024);
      // Planks along the lifter's line (z), each its own shade, with grain.
      const n = 6;
      for (let i = 0; i < n; i++) {
        const x0 = (i * 512) / n;
        g.fillStyle = `hsl(${30 + r() * 6}, ${42 + r() * 10}%, ${50 + r() * 8}%)`;
        g.fillRect(x0, 0, 512 / n, 1024);
        for (let k = 0; k < 40; k++) {
          g.strokeStyle = `rgba(90,55,25,${0.05 + r() * 0.08})`;
          g.lineWidth = 1 + r() * 2;
          g.beginPath();
          const x = x0 + r() * (512 / n);
          g.moveTo(x, 0);
          g.bezierCurveTo(x + (r() - 0.5) * 12, 340, x + (r() - 0.5) * 12, 680, x + (r() - 0.5) * 8, 1024);
          g.stroke();
        }
        g.fillStyle = "rgba(60,35,15,0.5)";
        g.fillRect(x0, 0, 2, 1024);
      }
      g.save();
      g.translate(256, 512);
      g.rotate(-Math.PI / 2);
      g.fillStyle = "rgba(30,20,10,0.55)";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `800 64px ${o.font}`;
      g.fillText("POKÉIQ", 0, 0);
      g.restore();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return T(t);
    })();
    // The lifting surface: wood down the middle (the lifter's feet), rubber either side where the plates land.
    const wood = new THREE.Mesh(G(new THREE.BoxGeometry(1.5, 0.012, P - 0.04)), M(new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.55 })));
    wood.position.y = h + 0.006;
    platform.add(wood);
    const edge = new THREE.Mesh(G(new THREE.BoxGeometry(P + 0.04, 0.03, P + 0.04)), M(new THREE.MeshStandardMaterial({ color: "#ffd23f", roughness: 0.6 })));
    edge.position.y = 0.015;
    platform.add(edge);
    // The referees' table at the side, three seats behind it (the crowd's figures sit there).
    const table = new THREE.Mesh(G(new THREE.BoxGeometry(0.8, 0.76, 3.6)), M(new THREE.MeshStandardMaterial({ color: "#0b1a3a", roughness: 0.6 })));
    table.position.set(6.2, 0.38, 0);
    platform.add(table);
    const skirt = new THREE.Mesh(G(new THREE.PlaneGeometry(3.6, 0.5)), M(new THREE.MeshBasicMaterial({ map: T(signTex("REFEREES", o.font)), color: new THREE.Color(1.2, 1.2, 1.2) })));
    skirt.position.set(5.79, 0.42, 0);
    skirt.rotation.y = -Math.PI / 2;
    platform.add(skirt);
    // The referees' lights stand where the lifter can see them (scene/props draws the lamps).
    const plinth = new THREE.Mesh(G(new THREE.BoxGeometry(0.5, 0.06, 0.5)), M(new THREE.MeshStandardMaterial({ color: "#20242c", roughness: 0.7 })));
    plinth.position.set(REF_LIGHTS.x, 0.03, REF_LIGHTS.z);
    platform.add(plinth);
  }
  const referees = buildCrowd({ occupancy: 1, flashes: 0, rows: [{ pts: [-1.2, 0, 1.2].map((z) => ({ x: 6.95, z, nx: 1, nz: 0 })), y: 0, tier: 0 }], light: { y: 22 } });
  platform.add(referees.group);
  group.add(platform);

  // ---- The dohyō: a raised square of clay (a truncated pyramid), its straw ring and the two starting lines.
  const dohyo = new THREE.Group();
  const clayTex = (() => {
    const [c, g] = canvas(512, 512);
    g.fillStyle = "#b48a5e";
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 5000; i++) {
      const v = r();
      g.fillStyle = v < 0.5 ? `rgba(90,60,35,${0.04 + r() * 0.08})` : `rgba(235,205,160,${0.03 + r() * 0.06})`;
      const s = 1 + r() * 5;
      g.fillRect(r() * 512, r() * 512, s, s);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return T(t);
  })();
  const clay = M(new THREE.MeshStandardMaterial({ map: clayTex, roughness: 0.95 }));
  // Unit pieces, scaled per bout: the top's half-size 1 at height 1.
  const mound = new THREE.Mesh(G(new THREE.CylinderGeometry(Math.SQRT2, Math.SQRT2 * 1.16, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0)), clay);
  dohyo.add(mound);
  const ring = new THREE.Mesh(G(new THREE.TorusGeometry(1, 0.035, 8, 96).rotateX(Math.PI / 2)), M(new THREE.MeshStandardMaterial({ color: "#c9b27a", roughness: 0.9 })));
  dohyo.add(ring);
  const lineMat = M(new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
  const startLines = [-1, 1].map((s) => {
    const l = new THREE.Mesh(G(new THREE.PlaneGeometry(0.06, 0.9).rotateX(-Math.PI / 2)), lineMat);
    l.userData.s = s;
    dohyo.add(l);
    return l;
  });
  // Sand swept round the outside of the straw.
  const sandRing = new THREE.Mesh(G(new THREE.RingGeometry(1.02, 1.18, 96).rotateX(-Math.PI / 2)), M(new THREE.MeshStandardMaterial({ color: "#d9c39a", roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 })));
  dohyo.add(sandRing);
  dohyo.visible = false;
  group.add(dohyo);
  let dohyoRing = -1;
  const setRing = (R: number) => {
    if (R === dohyoRing) return;
    dohyoRing = R;
    const s = dohyoScale(R);
    const top = dohyoTop(R);
    const half = (ARENA.dohyo / 2) * s;
    mound.scale.set(half, top, half);
    ring.scale.set(R, 1, R);
    ring.position.y = top + 0.03;
    sandRing.scale.set(R, 1, R);
    sandRing.position.y = top + 0.003;
    for (const l of startLines) {
      l.scale.set(Math.min(3, s), 1, Math.min(3, s));
      l.position.set((l.userData.s as number) * 0.35 * s, top + 0.004, 0);
    }
  };
  setRing(2.275);

  // ---- Lights: a key spot on the field of play, fill, and the hall in half-light.
  const lights = new THREE.Group();
  const key = new THREE.SpotLight(0xfff1de, 5.5, 0, 0.5, 0.55, 0);
  key.position.set(2, 26, 9);
  key.target.position.set(0, 0, 0);
  lights.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xc9d6ff, 0.9);
  fill.position.set(-14, 16, 12);
  lights.add(fill);
  const back = new THREE.DirectionalLight(0xffe2c0, 0.8);
  back.position.set(10, 14, -16);
  lights.add(back);
  lights.add(new THREE.HemisphereLight(0x7f8db0, 0x20180f, 0.45));
  group.add(lights);

  // ---- The reflections: a dark hall with the rig's lamps and the scoreboard's glow.
  const env = (() => {
    const s = new THREE.Scene();
    s.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.012, 0.014, 0.022), side: THREE.BackSide })));
    const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(10, 9.4, 8.6) });
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const l = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 0.3), lampMat);
      l.position.set(Math.cos(a) * 14, 20, Math.sin(a) * 14);
      l.lookAt(0, 0, 0);
      s.add(l);
    }
    const glow = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.9, 1.6) }));
    glow.position.y = 17;
    s.add(glow);
    const stands = new THREE.Mesh(new THREE.CylinderGeometry(26, 18, 10, 32, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.06, 0.1), side: THREE.BackSide }));
    stands.position.y = 4;
    s.add(stands);
    s.add(new THREE.Mesh(new THREE.CircleGeometry(30, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.06, 0.1, 0.22) })));
    const pmrem = new THREE.PMREMGenerator(o.renderer);
    const rt = pmrem.fromScene(s, 0.03);
    pmrem.dispose();
    s.traverse((x) => { if (x instanceof THREE.Mesh) { x.geometry.dispose(); (x.material as THREE.Material).dispose(); } });
    return rt.texture;
  })();

  return {
    group,
    env,
    fog: new THREE.FogExp2(new THREE.Color(0.012, 0.014, 0.022), 0.006),
    update(t, _cam, ex) {
      crowd.update(t, ex);
      referees.update(t, 0.05);
      ribbonTex.offset.x = (t * 0.02) % 1;
    },
    setProps(p) {
      const lift = p.kind === "lift", wrestle = p.kind === "wrestle", podium = p.kind === "podium";
      platform.visible = lift;
      dohyo.visible = wrestle;
      if (lift) drawBoard("Weightlifting");
      if (wrestle) { drawBoard("Wrestling"); setRing(p.ring); }
      if (podium) drawBoard("Medal ceremony");
      key.target.position.set(0, 0, podium ? -1.5 : 0);
    },
    dispose() {
      crowd.dispose();
      referees.dispose();
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      texs.forEach((t) => t.dispose());
      env.dispose();
    },
  };
}

function signTex(text: string, font: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 72;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0b1a3a";
  g.fillRect(0, 0, 512, 72);
  g.fillStyle = "#ffd23f";
  g.fillRect(0, 64, 512, 8);
  g.fillStyle = "#ffffff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `800 40px ${font}`;
  g.fillText(text, 256, 34, 480);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
