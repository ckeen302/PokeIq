import * as THREE from "three";
import type { FigureUrls } from "./figures";

/**
 * The far figures, drawn as a crowd: every Pokémon too small on screen for a
 * relief mesh is a flat quad of its own HOME render, all of them in one
 * instanced draw (and one more per shadow cascade), textured from a shared
 * atlas. Each render is fetched at 128 px, decoded off the main thread
 * (createImageBitmap, cropped to the figure and premultiplied for clean
 * mipmaps) and copied into a free cell of the atlas a few per frame, so a
 * zoom out onto hundreds of figures never stalls a frame. Least recently
 * used cells are recycled.
 */

const ATLAS = 2048;
const CELL = 128;
const PER_ROW = ATLAS / CELL;
const CELLS = PER_ROW * PER_ROW;
/** Each figure keeps a transparent border inside its cell, so mipmaps don't bleed between neighbours. */
const PAD = 3;
const INNER = CELL - PAD * 2;

export interface CrowdArt {
  art: number;
  /** The render's visible box [x, y, w, h, image size]. */
  box: [number, number, number, number, number];
}

interface Cell {
  index: number;
  art: number;
  /** UV rect of the figure in the atlas: left, top, width, height. */
  uv: [number, number, number, number];
  used: number;
  ready: boolean;
}

export interface CrowdInstance {
  x: number;
  z: number;
  w: number;
  h: number;
  art: number;
}

export class Crowd {
  readonly mesh: THREE.InstancedMesh;
  readonly shadows: THREE.InstancedMesh;
  readonly material: THREE.MeshStandardMaterial;
  private atlas: THREE.DataTexture;
  private depthMaterial: THREE.MeshDepthMaterial;
  private cellAttr: THREE.InstancedBufferAttribute;
  private cells = new Map<number, Cell>();
  private free: number[] = [];
  private loading = new Map<number, AbortController>();
  private decoded: { cell: Cell; bmp: ImageBitmap }[] = [];
  private failed = new Set<number>();
  private clear: THREE.DataTexture;
  private frame = 0;
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpP = new THREE.Vector3();
  private tmpS = new THREE.Vector3();

  constructor(private renderer: THREE.WebGLRenderer, private urls: FigureUrls, facing: number, shadowGeo: THREE.BufferGeometry, shadowMat: THREE.Material, readonly capacity = 900) {
    for (let i = CELLS - 1; i >= 0; i--) this.free.push(i);
    this.atlas = new THREE.DataTexture(null, ATLAS, ATLAS, THREE.RGBAFormat, THREE.UnsignedByteType);
    // Premultiplied sRGB bytes, decoded in the shader.
    this.atlas.colorSpace = THREE.NoColorSpace;
    this.atlas.minFilter = THREE.LinearMipmapLinearFilter;
    this.atlas.magFilter = THREE.LinearFilter;
    this.atlas.generateMipmaps = true;
    this.atlas.flipY = false;
    // Storage only: the cells are filled one at a time.
    this.atlas.source.dataReady = false;
    this.atlas.needsUpdate = true;
    this.clear = new THREE.DataTexture(new Uint8Array(CELL * CELL * 4), CELL, CELL, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.clear.flipY = false;

    const geo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    this.cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.cellAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aCell", this.cellAttr);
    this.material = new THREE.MeshStandardMaterial({ map: this.atlas, alphaTest: 0.5, roughness: 0.6, metalness: 0 });
    this.material.shadowSide = THREE.DoubleSide;
    crowdPatch(this.material, true);
    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: this.atlas, alphaTest: 0.5 });
    crowdPatch(this.depthMaterial, false);
    this.mesh = new THREE.InstancedMesh(geo, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.customDepthMaterial = this.depthMaterial;
    this.mesh.name = "crowd";
    this.shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, capacity);
    this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadows.count = 0;
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    this.tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), facing);
    // Allocate the atlas now, not mid-glide.
    renderer.initTexture(this.atlas);
  }

  /** The figure's cell if its art is in the atlas (marking it used this frame); otherwise starts fetching it and returns null. */
  want(a: CrowdArt): Cell | null {
    const c = this.cells.get(a.art);
    if (c) {
      c.used = this.frame;
      return c.ready ? c : null;
    }
    if (this.failed.has(a.art) || this.loading.size >= 6) return null;
    const cell = this.take(a.art);
    if (!cell) return null;
    this.load(a, cell);
    return null;
  }

  /** Whether a figure's art is ready to draw. */
  has(art: number) {
    return !!this.cells.get(art)?.ready;
  }

  /** Whether anything asked for is still on its way. */
  get busy() {
    return this.loading.size > 0 || this.decoded.length > 0;
  }

  private take(art: number): Cell | null {
    let index = this.free.pop();
    if (index === undefined) {
      // Recycle the least recently used cell that wasn't needed this frame or the last.
      let oldest: Cell | null = null;
      for (const c of this.cells.values()) if (c.ready && c.used < this.frame - 1 && (!oldest || c.used < oldest.used)) oldest = c;
      if (!oldest) return null;
      this.cells.delete(oldest.art);
      index = oldest.index;
    }
    const cell: Cell = { index, art, uv: [0, 0, 0, 0], used: this.frame, ready: false };
    this.cells.set(art, cell);
    return cell;
  }

  private async load(a: CrowdArt, cell: Cell) {
    const ac = new AbortController();
    this.loading.set(a.art, ac);
    try {
      const res = await fetch(this.urls.art(a.art, 128), { signal: ac.signal });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const [bx, by, bw, bh, size] = a.box;
      // The 128 px render is the full image scaled down: crop the figure's box and fit it in the cell, keeping its shape.
      const k = 128 / size;
      const sx = Math.max(0, Math.floor(bx * k)), sy = Math.max(0, Math.floor(by * k));
      const sw = Math.max(1, Math.min(128 - sx, Math.ceil((bx + bw) * k) - sx)), sh = Math.max(1, Math.min(128 - sy, Math.ceil((by + bh) * k) - sy));
      const fit = INNER / Math.max(sw, sh);
      const rw = Math.max(1, Math.round(sw * fit)), rh = Math.max(1, Math.round(sh * fit));
      let bmp = await createImageBitmap(blob, sx, sy, sw, sh, { resizeWidth: rw, resizeHeight: rh, resizeQuality: "high", premultiplyAlpha: "premultiply", colorSpaceConversion: "none" });
      if (bmp.width !== rw || bmp.height !== rh) {
        // A browser that ignores the resize options: scale it on a canvas instead.
        const cv = document.createElement("canvas");
        cv.width = rw;
        cv.height = rh;
        cv.getContext("2d")!.drawImage(bmp, 0, 0, rw, rh);
        bmp.close();
        bmp = await createImageBitmap(cv, { premultiplyAlpha: "premultiply" });
      }
      if (ac.signal.aborted || this.cells.get(a.art) !== cell) { bmp.close(); return; }
      const col = cell.index % PER_ROW, row = Math.floor(cell.index / PER_ROW);
      const ox = col * CELL + PAD + Math.floor((INNER - rw) / 2), oy = row * CELL + PAD + (INNER - rh);
      cell.uv = [ox / ATLAS, oy / ATLAS, rw / ATLAS, rh / ATLAS];
      this.decoded.push({ cell, bmp });
    } catch {
      if (this.cells.get(a.art) === cell) {
        this.cells.delete(a.art);
        this.free.push(cell.index);
      }
      if (!ac.signal.aborted) this.failed.add(a.art);
    } finally {
      if (this.loading.get(a.art) === ac) this.loading.delete(a.art);
    }
  }

  /** Copies up to `budget` decoded figures into the atlas (each a small sub-upload; the mipmaps are rebuilt once). Returns how many. */
  upload(budget: number): number {
    let n = 0;
    const pos = new THREE.Vector2();
    while (n < budget && this.decoded.length) {
      const { cell, bmp } = this.decoded.shift()!;
      if (this.cells.get(cell.art) !== cell) { bmp.close(); continue; }
      const col = cell.index % PER_ROW, row = Math.floor(cell.index / PER_ROW);
      const last = n === budget - 1 || !this.decoded.length;
      this.atlas.generateMipmaps = false;
      pos.set(col * CELL, row * CELL);
      this.renderer.copyTextureToTexture(this.clear, this.atlas, null, pos);
      const src = new THREE.Texture(bmp as unknown as HTMLImageElement);
      src.flipY = false;
      this.atlas.generateMipmaps = last;
      pos.set(Math.round(cell.uv[0] * ATLAS), Math.round(cell.uv[1] * ATLAS));
      this.renderer.copyTextureToTexture(src, this.atlas, null, pos);
      bmp.close();
      cell.ready = true;
      n++;
    }
    this.atlas.generateMipmaps = true;
    return n;
  }

  /** This frame's crowd. */
  set(list: CrowdInstance[]) {
    this.frame++;
    const n = Math.min(list.length, this.capacity);
    const arr = this.cellAttr.array as Float32Array;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const it = list[i];
      const c = this.cells.get(it.art);
      if (!c?.ready) continue;
      c.used = this.frame;
      this.tmpP.set(it.x, 0, it.z);
      this.tmpS.set(it.w, it.h, 1);
      this.mesh.setMatrixAt(k, this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS));
      this.tmpP.set(it.x, 0.004 + it.h * 0.0005, it.z);
      this.tmpS.set(it.w * 1.05, 1, it.w * 0.35);
      this.shadows.setMatrixAt(k, this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS));
      arr[k * 4] = c.uv[0];
      arr[k * 4 + 1] = c.uv[1];
      arr[k * 4 + 2] = c.uv[2];
      arr[k * 4 + 3] = c.uv[3];
      k++;
    }
    this.mesh.count = k;
    this.shadows.count = k;
    if (k) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, k * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.shadows.instanceMatrix.clearUpdateRanges();
      this.shadows.instanceMatrix.addUpdateRange(0, k * 16);
      this.shadows.instanceMatrix.needsUpdate = true;
      this.cellAttr.clearUpdateRanges();
      this.cellAttr.addUpdateRange(0, k * 4);
      this.cellAttr.needsUpdate = true;
    }
  }

  /** Marks the frame as passed without changing the crowd. */
  tick() {
    this.frame++;
    // Keep what is drawn marked as used.
    for (const c of this.cells.values()) if (c.ready && c.used === this.frame - 1) c.used = this.frame;
  }

  dispose() {
    for (const ac of this.loading.values()) ac.abort();
    this.loading.clear();
    for (const d of this.decoded) d.bmp.close();
    this.decoded = [];
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.depthMaterial.dispose();
    this.atlas.dispose();
    this.clear.dispose();
  }
}

/**
 * Per-instance atlas cell for the crowd's materials. The atlas holds
 * premultiplied sRGB (so mipmaps don't darken the outlines): the colour
 * material turns it back into straight, linear colour itself.
 */
function crowdPatch(m: THREE.Material, colour: boolean) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (s, r) => {
    prev?.call(m, s, r);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 aCell;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = vec2(aCell.x + vMapUv.x * aCell.z, aCell.y + (1.0 - vMapUv.y) * aCell.w);\n#endif");
    if (colour) {
      s.fragmentShader = s.fragmentShader.replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D(map, vMapUv);
          sampledDiffuseColor.rgb = sRGBTransferEOTF(vec4(sampledDiffuseColor.rgb / max(sampledDiffuseColor.a, 0.004), 1.0)).rgb;
          diffuseColor *= sampledDiffuseColor;
        #endif`
      );
    }
  };
  const prevKey = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ""}|crowd${colour ? "c" : "d"}`;
}
