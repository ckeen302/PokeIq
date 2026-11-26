import { ATLAS, cameraZ, project, toVec, turn, type Screen, type Vec } from "./project";
import { latOf, lonOf } from "@/lib/globe/geo";

/**
 * The DOM over the globe: the main regions' names and the Daily's pins, set on the land and moved with it every
 * frame (a transform and an opacity each, no layout), fading out as they turn round the back. The scene calls
 * place() as it draws; with no WebGL it is placed once, on the poster.
 */

export interface HubRegion {
  name: string;
  /** Atlas pixels (public/atlas/atlas.json). */
  x: number;
  y: number;
}

export interface Overlay {
  resize(W: number, H: number): void;
  place(angle: number, tiltX: number): void;
  setPins(spots: [number, number][]): void;
  /** The region lit (an atlas name, or none), and whether a region is in focus at all (the others then dim). */
  light(name: string | null, dimOthers: boolean): void;
  readonly regions: { name: string; lon: number; lat: number; v: Vec }[];
  dispose(): void;
}

const smooth = (a: number, b: number, x: number) => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

const PIN_SVG = `<svg width="12" height="17" viewBox="0 0 10 14" aria-hidden="true"><path d="M5 13.5C5 13.5 9.5 8.6 9.5 5A4.5 4.5 0 0 0 .5 5c0 3.6 4.5 8.5 4.5 8.5Z" fill="#ffd23c" stroke="#3a2200" stroke-width="1"/><circle cx="5" cy="5" r="1.6" fill="#3a2200"/></svg>`;

export function createOverlay(
  layer: HTMLElement,
  o: { regions: HubRegion[]; label(name: string): string; frac: number; onHover(name: string | null): void },
): Overlay {
  const camZ = cameraZ(o.frac);
  /** anchor: the point of the element set on the land (a name's middle, a pin's tip). */
  type Mark = { el: HTMLElement; v: Vec; minFace: number; op: number; tf: string; anchor: string };
  const regions = o.regions.map((r) => {
    const lon = lonOf(r.x, ATLAS.W), lat = latOf(r.y, ATLAS.W, ATLAS.H);
    return { name: r.name, lon, lat, v: toVec(lon, lat, 1.01) };
  });
  const labels: (Mark & { name: string })[] = regions.map((r) => {
    const el = document.createElement("span");
    el.className = "hg-label";
    el.textContent = o.label(r.name);
    el.dataset.testid = "geo-home-region";
    el.dataset.region = r.name;
    el.style.visibility = "hidden";
    el.addEventListener("pointerenter", () => o.onHover(r.name));
    el.addEventListener("pointerleave", () => o.onHover(null));
    layer.appendChild(el);
    return { name: r.name, el, v: r.v, minFace: 0.08, op: -1, tf: "", anchor: "translate(-50%,-50%)" };
  });
  let pins: Mark[] = [];
  let W = 0, H = 0;
  let last: [number, number] | null = null;
  const s: Screen = { x: 0, y: 0, facing: 0 };

  function put(m: Mark, angle: number, tiltX: number) {
    project(turn(m.v, angle, tiltX), camZ, W, H, s);
    const op = Math.round(smooth(m.minFace, m.minFace + 0.28, s.facing) * 100) / 100;
    if (op < 0.02) {
      if (m.op !== 0) {
        m.el.style.visibility = "hidden";
        m.op = 0;
      }
      return;
    }
    if (m.op <= 0) m.el.style.visibility = "visible";
    if (op !== m.op) {
      m.el.style.opacity = String(op);
      // Half faded, round the edge: no longer a thing to point at.
      m.el.style.pointerEvents = op > 0.5 ? "" : "none";
      m.op = op;
    }
    const tf = `translate3d(${s.x.toFixed(1)}px,${s.y.toFixed(1)}px,0) ${m.anchor} scale(${(0.8 + 0.2 * op).toFixed(2)})`;
    if (tf !== m.tf) {
      m.el.style.transform = tf;
      m.tf = tf;
    }
  }

  const api: Overlay = {
    regions,
    resize(w, h) {
      W = w;
      H = h;
      if (last) api.place(last[0], last[1]);
    },
    place(angle, tiltX) {
      last = [angle, tiltX];
      if (!W || !H) return;
      for (const m of labels) put(m, angle, tiltX);
      for (const m of pins) put(m, angle, tiltX);
    },
    setPins(spots) {
      pins.forEach((p) => p.el.remove());
      pins = spots.map(([lon, lat], i) => {
        const el = document.createElement("span");
        el.className = "hg-pin";
        el.dataset.testid = "geo-home-pin";
        el.style.visibility = "hidden";
        el.innerHTML = PIN_SVG;
        (el.firstElementChild as HTMLElement | null)?.style.setProperty("animation-delay", `${0.3 + i * 0.12}s`);
        // Under the names.
        layer.insertBefore(el, layer.firstChild);
        return { el, v: toVec(lon, lat, 1.01), minFace: 0.12, op: -1, tf: "", anchor: "translate(-50%,-100%)" };
      });
      if (last) api.place(last[0], last[1]);
    },
    light(name, dimOthers) {
      for (const m of labels) {
        const lit = m.name === name;
        m.el.classList.toggle("hg-lit", lit);
        m.el.classList.toggle("hg-dim", dimOthers && !lit);
        if (lit) m.el.dataset.lit = "true";
        else delete m.el.dataset.lit;
      }
    },
    dispose() {
      labels.forEach((m) => m.el.remove());
      pins.forEach((p) => p.el.remove());
    },
  };
  return api;
}
