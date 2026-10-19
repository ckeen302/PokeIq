/**
 * PokéIQ's battle scene: a small, jQuery-free stand-in for the parts of
 * Pokémon Showdown's BattleScene that its animation tables call
 * (showEffect, animateEffect, backgroundEffect, wait, the sprites' anim,
 * delay, behind and leftof), so the CC0 move animations in ./anims run on
 * our own stage.
 *
 * The stage uses Showdown's coordinates: a 640×360 field where x runs left
 * to right, y up, and z from the near side (0, your Pokémon) to the far side
 * (200, the opponent's). `pos` is Showdown's projection, so every animation
 * lands where it was designed to.
 *
 * Each element gets a Track: a queue of css/delay/animate steps, as jQuery
 * would queue them. One requestAnimationFrame loop then plays every track.
 * Positioning math (pos, posT) and the easings follow Showdown's
 * battle-animations.ts (MIT).
 */

export interface ScenePos {
  /** - left, + right */
  x?: number;
  /** - down, + up */
  y?: number;
  /** - player, + opponent */
  z?: number;
  scale?: number;
  xscale?: number;
  yscale?: number;
  opacity?: number;
  time?: number;
  display?: string;
}

export interface SpriteData {
  url?: string;
  rawHTML?: string;
  w: number;
  h: number;
  y?: number;
  gen?: number;
  pixelated?: boolean;
  shiny?: boolean;
}

export const STAGE_W = 640;
export const STAGE_H = 360;

type Easing = "linear" | "swing" | "ballisticUp" | "ballisticDown" | "quadUp" | "quadDown";

const EASINGS: Record<Easing, (x: number) => number> = {
  linear: (x) => x,
  swing: (x) => 0.5 - Math.cos(x * Math.PI) / 2,
  ballisticUp: (x) => -3 * x * x + 4 * x,
  ballisticDown: (x) => {
    x = 1 - x;
    return 1 - (-3 * x * x + 4 * x);
  },
  quadUp: (x) => {
    x = 1 - x;
    return 1 - x * x;
  },
  quadDown: (x) => x * x,
};

type Values = Record<string, number>;
type Targets = Record<string, number | string | [number, string] | undefined>;

interface Segment {
  start: number;
  end: number;
  from: Values;
  to: Values;
  ease: Record<string, Easing>;
}

/** One element's queue of style changes, like a jQuery animation queue. */
export class Track {
  readonly el: HTMLElement | null;
  private readonly initial: Values;
  private current: Values;
  private readonly segments: Segment[] = [];
  private t = 0;

  constructor(el: HTMLElement | null, initial: Values = {}) {
    this.el = el;
    this.initial = { ...initial };
    this.current = { ...initial };
  }

  /** When the queue runs out (ms from the start). */
  get end() {
    return this.t;
  }

  css(values: Targets) {
    const plain = numbers(values);
    if (!this.segments.length && this.t === 0) {
      Object.assign(this.initial, plain);
      Object.assign(this.current, plain);
    } else {
      this.animate(plain, 0);
    }
    return this;
  }

  delay(ms: number) {
    this.t += Math.max(0, ms || 0);
    return this;
  }

  /** Queues a tween to `targets` (a value, or [value, easing] as Showdown's posT gives) over `ms`. */
  animate(targets: Targets, ms: number) {
    const to: Values = {};
    const ease: Record<string, Easing> = {};
    for (const [key, raw] of Object.entries(targets)) {
      if (Array.isArray(raw)) {
        if (typeof raw[0] !== "number" || !Number.isFinite(raw[0])) continue;
        to[key] = raw[0];
        ease[key] = (raw[1] in EASINGS ? raw[1] : "linear") as Easing;
      } else if (typeof raw === "number" && Number.isFinite(raw)) {
        to[key] = raw;
        ease[key] = "swing"; // jQuery's default easing
      }
    }
    const duration = Math.max(0, ms || 0);
    this.segments.push({ start: this.t, end: this.t + duration, from: { ...this.current }, to, ease });
    Object.assign(this.current, to);
    this.t += duration;
    return this;
  }

  /** The element's style values `time` ms in. */
  sample(time: number): Values {
    const out: Values = { ...this.initial };
    for (const seg of this.segments) {
      if (time < seg.start) break;
      for (const key of Object.keys(seg.to)) {
        const to = seg.to[key];
        if (time >= seg.end || seg.end === seg.start) {
          out[key] = to;
        } else {
          const from = seg.from[key] ?? to;
          out[key] = from + (to - from) * EASINGS[seg.ease[key]]((time - seg.start) / (seg.end - seg.start));
        }
      }
    }
    return out;
  }

  apply(time: number) {
    if (!this.el) return;
    paint(this.el, this.sample(time));
  }

  /** Back to how it was before the animation. */
  reset() {
    if (this.el) paint(this.el, this.initial);
  }
}

function numbers(values: Targets): Values {
  const out: Values = {};
  for (const [key, value] of Object.entries(values)) if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  return out;
}

function paint(el: HTMLElement, values: Values) {
  const style = el.style as unknown as Record<string, string>;
  for (const [key, value] of Object.entries(values)) {
    if (key === "opacity") style.opacity = String(Math.max(0, Math.min(1, value)));
    else style[key] = `${Math.round(value * 10) / 10}px`;
  }
}

/** A Pokémon on the stage, as Showdown's animation tables see it. */
export class PokemonSprite {
  readonly scene: BattleScene;
  sp: SpriteData;
  x: number;
  y: number;
  z: number;
  readonly isFrontSprite: boolean;
  isMissedPokemon = false;
  readonly track: Track | null;

  constructor(scene: BattleScene, el: HTMLElement | null, sp: SpriteData, pos: { x: number; y: number; z: number }, isFrontSprite: boolean) {
    this.scene = scene;
    this.sp = sp;
    this.x = pos.x;
    this.y = pos.y;
    this.z = pos.z;
    this.isFrontSprite = isFrontSprite;
    this.track = el ? scene.track(el, scene.pos({ x: this.x, y: this.y, z: this.z }, sp) as Values) : null;
  }

  delay(time: number) {
    this.track?.delay(time);
    return this;
  }

  anim(end: ScenePos, transition?: string) {
    const to: ScenePos = { x: this.x, y: this.y, z: this.z, scale: 1, opacity: 1, time: 500, ...end };
    if (!this.track) return this;
    if (to.time === 0) {
      this.track.css(this.scene.pos(to, this.sp));
      return this;
    }
    this.track.animate(this.scene.posT(to, this.sp, transition, this), to.time!);
    return this;
  }

  behindx(offset: number) {
    return this.x + (this.isFrontSprite ? 1 : -1) * offset;
  }
  behindy(offset: number) {
    return this.y + (this.isFrontSprite ? -1 : 1) * offset;
  }
  leftof(offset: number) {
    return this.x + (this.isFrontSprite ? 1 : -1) * offset;
  }
  behind(offset: number) {
    return this.z + (this.isFrontSprite ? 1 : -1) * offset;
  }
}

export interface SceneLayers {
  /** Effects (above the sprites). */
  fx: HTMLElement;
  /** Full-stage background effects (between the backdrop and the sprites). */
  bgfx: HTMLElement;
  /** The backdrop itself (Earthquake shakes it). Styled top: -90px, bottom: 0. */
  backdrop: HTMLElement;
}

/** What the animation tables need to look up an effect by name (the effects table, loaded with them). */
export type EffectTable = Record<string, SpriteData>;

/** One animation's worth of scene: build it, let a table animate it, then `play()`. */
export class BattleScene {
  timeOffset = 0;
  animating = true;
  acceleration = 1;
  /** Showdown's anims read the near side's position for a couple of moves. */
  battle = { mySide: { x: 0, y: 0, z: 0 } };
  readonly $bg: Track;
  private readonly tracks = new Set<Track>();
  private readonly created: HTMLElement[] = [];

  constructor(
    private readonly layers: SceneLayers,
    private readonly effects: EffectTable
  ) {
    this.$bg = this.track(layers.backdrop, { top: -90, bottom: 0 });
  }

  track(el: HTMLElement | null, initial: Values = {}) {
    const track = new Track(el, initial);
    this.tracks.add(track);
    return track;
  }

  wait(time: number) {
    this.timeOffset += time;
  }

  /** A sprite for an effect: an image (or a styled box for Protect, screens and the like). */
  private effectElement(effect: SpriteData, additionalCss?: Record<string, string | number>) {
    let el: HTMLElement;
    if (effect.rawHTML) {
      el = document.createElement("div");
      el.className = /class="([^"]+)"/.exec(effect.rawHTML)?.[1] ?? "";
    } else {
      const img = document.createElement("img");
      img.src = effect.url ?? "";
      img.alt = "";
      img.decoding = "async";
      img.draggable = false;
      if (effect.pixelated) img.style.imageRendering = "pixelated";
      el = img;
    }
    el.style.position = "absolute";
    el.style.display = "block";
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
    if (additionalCss) Object.assign(el.style, additionalCss);
    this.layers.fx.appendChild(el);
    this.created.push(el);
    return el;
  }

  showEffect(effect: string | SpriteData, start: ScenePos, end: ScenePos, transition: string, after?: string, additionalCss?: Record<string, string | number>): Track {
    const data = typeof effect === "string" ? this.effects[effect] : effect;
    if (!data) return this.track(null);
    const track = this.track(this.effectElement(data, additionalCss), { opacity: 0 });
    return this.animateEffect(track, data, start, end, transition, after);
  }

  animateEffect(track: Track, effect: string | SpriteData, start: ScenePos, end: ScenePos, transition: string, after?: string, additionalCss?: Record<string, string | number>): Track {
    const data = typeof effect === "string" ? this.effects[effect] : effect;
    if (!data) return track;
    if (additionalCss && track.el) Object.assign(track.el.style, additionalCss);
    if (!start.time) start.time = 0;
    if (!end.time) end.time = start.time + 500;
    start.time += this.timeOffset;
    end.time += this.timeOffset;
    if (!end.scale && end.scale !== 0 && start.scale) end.scale = start.scale;
    if (!end.xscale && end.xscale !== 0 && start.xscale) end.xscale = start.xscale;
    if (!end.yscale && end.yscale !== 0 && start.yscale) end.yscale = start.yscale;
    end = { ...start, ...end };

    const startpos = this.pos(start, data);
    const endpos = this.posT(end, data, transition, start);
    if (start.time) {
      track.css({ ...startpos, opacity: 0 });
      track.delay(start.time).animate({ opacity: startpos.opacity }, 1);
    } else if (track.end > 0) {
      track.animate(startpos, 0);
    } else {
      track.css(startpos);
    }
    track.animate(endpos, end.time! - start.time);
    if (after === "fade") track.animate({ opacity: 0 }, 100);
    if (after === "explode") {
      if (end.scale) end.scale *= 3;
      if (end.xscale) end.xscale *= 3;
      if (end.yscale) end.yscale *= 3;
      end.opacity = 0;
      track.animate(this.pos(end, data), 200);
    }
    return track;
  }

  backgroundEffect(bg: string, duration: number, opacity = 1, delay = 0) {
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.inset = "0";
    el.style.background = bg;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
    this.layers.bgfx.appendChild(el);
    this.created.push(el);
    this.track(el, { opacity: 0 }).delay(delay).animate({ opacity }, 250).delay(duration - 250).animate({ opacity: 0 }, 250);
  }

  /**
   * Showdown's projection: a scene location (x, y, z, scale, opacity) to
   * left/top/width/height/opacity on the 640×360 stage.
   */
  pos(loc: ScenePos, obj: SpriteData) {
    return projectPos(loc, obj);
  }

  /** `pos` with Showdown's per-property easings for a transition. */
  posT(loc: ScenePos, obj: SpriteData, transition?: string, oldLoc?: ScenePos): Targets {
    const pos = this.pos(loc, obj);
    const oldPos = oldLoc ? this.pos(oldLoc, obj) : null;
    const map: Record<"left" | "top" | "width" | "height" | "opacity", string> = { left: "linear", top: "linear", width: "linear", height: "linear", opacity: "linear" };
    if (transition === "ballistic") map.top = oldPos && pos.top < oldPos.top ? "ballisticUp" : "ballisticDown";
    if (transition === "ballisticUnder") map.top = oldPos && pos.top < oldPos.top ? "ballisticDown" : "ballisticUp";
    if (transition === "ballistic2") map.top = oldPos && pos.top < oldPos.top ? "quadUp" : "quadDown";
    if (transition === "ballistic2Back") map.top = loc.z! > 0 ? "quadUp" : "quadDown";
    if (transition === "ballistic2Under") map.top = oldPos && pos.top < oldPos.top ? "quadDown" : "quadUp";
    if (transition === "swing") map.left = map.top = map.width = map.height = "swing";
    if (transition === "accel") map.left = map.top = map.width = map.height = "quadDown";
    if (transition === "decel") map.left = map.top = map.width = map.height = "quadUp";
    return {
      left: [pos.left, map.left],
      top: [pos.top, map.top],
      width: [pos.width, map.width],
      height: [pos.height, map.height],
      opacity: [pos.opacity, map.opacity],
    };
  }

  /** How long everything queued takes. */
  get duration() {
    let end = this.timeOffset;
    for (const track of this.tracks) end = Math.max(end, track.end);
    return end;
  }

  /**
   * Plays every track. `speed` scales time (2 = twice as fast). Resolves when
   * done, or at once when `signal` aborts; either way the stage is cleaned
   * up and the sprites put back.
   */
  play(speed = 1, signal?: AbortSignal): Promise<void> {
    const total = this.duration;
    const tracks = [...this.tracks];
    return new Promise((resolve) => {
      const started = performance.now();
      let frame = 0;
      const finish = () => {
        cancelAnimationFrame(frame);
        for (const el of this.created) el.remove();
        for (const track of tracks) track.reset();
        signal?.removeEventListener("abort", finish);
        resolve();
      };
      if (signal?.aborted || total <= 0) {
        finish();
        return;
      }
      signal?.addEventListener("abort", finish);
      const tick = (now: number) => {
        const time = (now - started) * speed;
        for (const track of tracks) track.apply(Math.min(time, total));
        if (time >= total) finish();
        else frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
  }
}

/**
 * Showdown's projection: a scene location (x, y, z, scale, opacity) to
 * left/top/width/height/opacity on the 640×360 stage.
 */
export function projectPos(loc: ScenePos, obj: SpriteData) {
  const l: ScenePos = { x: 0, y: 0, z: 0, scale: 1, opacity: 1, ...loc };
  if (!l.xscale && l.xscale !== 0) l.xscale = l.scale;
  if (!l.yscale && l.yscale !== 0) l.yscale = l.scale;
  let left = 210;
  let top = 245;
  let scale = obj.gen === 5 ? 2.0 - l.z! / 200 : 1.5 - 0.5 * (l.z! / 200);
  if (scale < 0.1) scale = 0.1;
  left += (410 - 190) * (l.z! / 200);
  top += (135 - 245) * (l.z! / 200);
  left += Math.floor(l.x! * scale);
  top -= Math.floor(l.y! * scale);
  const width = Math.floor(obj.w * scale * l.xscale!);
  const height = Math.floor(obj.h * scale * l.yscale!);
  const hoffset = Math.floor((obj.h - (obj.y || 0) * 2) * scale * l.yscale!);
  left -= Math.floor(width / 2);
  top -= Math.floor(hoffset / 2);
  return { left, top, width, height, opacity: l.opacity! };
}

/** Where Showdown puts each active Pokémon (`slot` 0 or 1, `active` per side). */
export function spritePosition(near: boolean, slot: number, active: number, pixelated: boolean): { x: number; y: number; z: number } {
  const front = !near;
  const z = near ? 0 : 200;
  let x = 0;
  if (active === 2) x = (pixelated ? slot * -100 + 18 : slot * -75 + 18) * (front ? 1 : -1);
  if (active === 3) x = (slot * -70 + 20) * (front ? 1 : -1);
  const y = active > 1 ? (front ? slot * 7 : slot * -10) : 0;
  return { x, y, z };
}
