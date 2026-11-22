import * as THREE from "three";
import type { FigureHandle, ReliefProvider } from "@/components/sizes/scene/figures";
import type { LabMon } from "@/lib/lab-dex/types";
import { labItem } from "./items";

/**
 * Streams the lab's figures: the Pokémon HOME render on a relief mesh (built
 * in /pokedex/sizes' worker), a light one for each pod and a detailed one for
 * the holo-table. Each frame the scene says what it wants, nearest first;
 * the store fetches a few at a time in that order, aborts what's no longer
 * wanted (a fast spin passes dozens of Pokémon it never needs), and keeps
 * what it built in a least-recently-used cache under a cap, disposing the
 * rest (geometry, texture, material: nothing lingers on the GPU).
 */

export type FigLod = "pod" | "hero";

export interface Fig {
  key: string;
  id: number;
  lod: FigLod;
  handle: FigureHandle;
  /** What's placed in the scene: the figure and its contact shadow. */
  root: THREE.Group;
  blobMat: THREE.MeshBasicMaterial;
  /** World size of the figure (m). */
  w: number;
  h: number;
  /** Set while the scene shows it (never evicted then). */
  inUse: number;
  used: number;
}

export interface Want {
  mon: LabMon;
  lod: FigLod;
  /** Lower comes first. */
  priority: number;
}

interface Pending {
  ac: AbortController;
  priority: number;
}

export interface StreamOptions {
  pod: ReliefProvider;
  hero: ReliefProvider;
  /** Most figures of each kind kept. */
  caps: { pod: number; hero: number };
  /** Loads at once. */
  concurrency: number;
  blob: { geo: THREE.BufferGeometry; tex: THREE.Texture };
}

export const figKey = (id: number, lod: FigLod) => `${lod}:${id}`;

export class FigureStream {
  private cache = new Map<string, Fig>();
  private pending = new Map<string, Pending>();
  private queue: Want[] = [];
  private clock = 0;
  private disposed = false;
  /** Figures built (for the stress test's numbers). */
  built = 0;
  aborted = 0;

  constructor(private o: StreamOptions) {}

  get(id: number, lod: FigLod): Fig | undefined {
    const f = this.cache.get(figKey(id, lod));
    if (f) f.used = ++this.clock;
    return f;
  }

  has(id: number, lod: FigLod) {
    return this.cache.has(figKey(id, lod));
  }

  /** What the scene wants now (nearest first). Aborts loads nothing wants, starts the most wanted. */
  want(list: Want[]) {
    if (this.disposed) return;
    const keys = new Set<string>();
    this.queue = [];
    // The most wanted is stamped the most recently used, so eviction takes the least wanted first.
    const base = this.clock + list.length + 1;
    this.clock = base;
    list.forEach((w, i) => {
      const f = this.cache.get(figKey(w.mon.id, w.lod));
      if (f) f.used = Math.max(f.used, base - i);
    });
    for (const w of list) {
      const k = figKey(w.mon.id, w.lod);
      if (keys.has(k)) continue;
      keys.add(k);
      if (this.cache.has(k)) continue;
      const p = this.pending.get(k);
      if (p) { p.priority = w.priority; continue; }
      this.queue.push(w);
    }
    for (const [k, p] of this.pending) {
      if (!keys.has(k)) {
        p.ac.abort();
        this.pending.delete(k);
        this.aborted++;
      }
    }
    this.queue.sort((a, b) => a.priority - b.priority);
    this.pump();
  }

  private pump() {
    while (!this.disposed && this.pending.size < this.o.concurrency && this.queue.length) {
      const w = this.queue.shift()!;
      this.start(w);
    }
  }

  private start(w: Want) {
    const k = figKey(w.mon.id, w.lod);
    const ac = new AbortController();
    this.pending.set(k, { ac, priority: w.priority });
    const item = labItem(w.mon, w.lod === "hero");
    const provider = w.lod === "hero" ? this.o.hero : this.o.pod;
    provider
      .load(item, w.lod === "hero" ? 0 : 1, ac.signal, { priority: w.priority < 1 ? "high" : "low" })
      .then((handle) => {
        if (ac.signal.aborted || this.disposed) { handle.dispose(); return; }
        const root = new THREE.Group();
        root.add(handle.object);
        const blobMat = new THREE.MeshBasicMaterial({ map: this.o.blob.tex, transparent: true, depthWrite: false, color: 0x000000, opacity: 0.75 });
        blobMat.polygonOffset = true;
        blobMat.polygonOffsetFactor = -2;
        const blob = new THREE.Mesh(this.o.blob.geo, blobMat);
        blob.scale.set(item.w * 0.85, 1, Math.max(0.22, handle.depth * 2.4));
        blob.position.y = 0.006;
        blob.renderOrder = 1;
        root.add(blob);
        this.cache.set(k, { key: k, id: w.mon.id, lod: w.lod, handle, root, blobMat, w: item.w, h: item.h, inUse: 0, used: ++this.clock });
        this.built++;
        this.evict();
      })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name !== "AbortError" && !ac.signal.aborted) console.warn("lab figure", w.mon.id, e);
      })
      .finally(() => {
        if (this.pending.get(k)?.ac === ac) this.pending.delete(k);
        this.pump();
      });
  }

  /** Drops the least recently used figures over the caps (never one on show). */
  private evict() {
    for (const lod of ["pod", "hero"] as const) {
      const cap = this.o.caps[lod];
      const mine = [...this.cache.values()].filter((f) => f.lod === lod);
      if (mine.length <= cap) continue;
      mine.sort((a, b) => a.used - b.used);
      let over = mine.length - cap;
      for (const f of mine) {
        if (over <= 0) break;
        if (f.inUse > 0) continue;
        this.drop(f);
        over--;
      }
    }
  }

  private drop(f: Fig) {
    f.root.removeFromParent();
    f.handle.dispose();
    f.blobMat.dispose();
    this.cache.delete(f.key);
  }

  /** Lowers the caps (a lighter quality tier) and evicts down to them. */
  setCaps(caps: { pod: number; hero: number }) {
    this.o.caps = caps;
    this.evict();
  }

  /** Whether the cache still holds this figure (a dropped one must never be on show). */
  holds(f: Fig) {
    return this.cache.get(f.key) === f;
  }

  stats() {
    let pod = 0, hero = 0, inUse = 0;
    for (const f of this.cache.values()) {
      if (f.lod === "pod") pod++;
      else hero++;
      inUse += f.inUse;
    }
    return { pod, hero, inUse, pending: this.pending.size, queued: this.queue.length, built: this.built, aborted: this.aborted };
  }

  dispose() {
    this.disposed = true;
    for (const p of this.pending.values()) p.ac.abort();
    this.pending.clear();
    for (const f of [...this.cache.values()]) this.drop(f);
  }
}
