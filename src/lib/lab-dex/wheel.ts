/**
 * The Professor's Lab's wheel as motion: an endless position in slots (one
 * slot per Pokémon in the sequence, unbounded, so the ring never ends), a
 * velocity, and where it's heading. Dragging moves it directly; letting go
 * flings it with the drag's speed and it glides to the slot it would have
 * coasted to (a critically damped spring tuned so a fling decays smoothly,
 * no overshoot); arrows, the wheel and clicks step or jump to a slot with a
 * quicker spring. Pure (no DOM), so it's tested on its own.
 */

/** Fastest the wheel turns (slots a second). */
export const MAX_SPEED = 40;
/** A fling's glide: how far it coasts is speed × GLIDE (seconds). */
export const GLIDE = 0.3;
/** The spring for steps, jumps and snaps (rad/s): settles in about half a second. */
export const SNAP = 11;
/** Below this release speed (slots/s) a drag just snaps to the nearest slot. */
const FLING_MIN = 0.8;

export class Wheel {
  /** Position, in slots (unbounded). */
  p = 0;
  /** Velocity, slots per second. */
  v = 0;
  /** The slot it's heading to (null: free, only while dragging). */
  target: number | null = 0;
  dragging = false;
  /** The spring's stiffness right now (a fling glides on a softer one than a step). */
  private omega = SNAP;
  private samples: { t: number; p: number }[] = [];

  /** Puts it on a slot at once. */
  set(n: number) {
    this.p = n;
    this.v = 0;
    this.target = n;
    this.dragging = false;
    this.omega = SNAP;
  }

  grab(t: number) {
    this.dragging = true;
    this.target = null;
    this.v = 0;
    this.samples = [{ t, p: this.p }];
  }

  /** Moves it by `d` slots with the pointer. */
  drag(d: number, t: number) {
    if (!this.dragging) return;
    this.p += d;
    this.samples.push({ t, p: this.p });
    // Keep the last tenth of a second or so.
    while (this.samples.length > 2 && t - this.samples[0].t > 0.12) this.samples.shift();
  }

  /** Lets go: a fling glides on to the slot it would coast to, a slow release snaps to the nearest. */
  release(t: number) {
    if (!this.dragging) return;
    this.dragging = false;
    const s = this.samples;
    let v = 0;
    if (s.length >= 2) {
      const a = s[0], b = s[s.length - 1];
      // A pause before letting go is no fling.
      if (t - b.t < 0.08 && b.t > a.t) v = (b.p - a.p) / (b.t - a.t);
    }
    v = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v));
    if (Math.abs(v) < FLING_MIN) {
      this.v = 0;
      this.omega = SNAP;
      this.target = Math.round(this.p);
      return;
    }
    this.v = v;
    this.omega = 1 / GLIDE;
    this.target = Math.round(this.p + v * GLIDE);
  }

  /** One slot on or back (arrows, the wheel): from where it's already heading, so quick presses add up. */
  step(dir: number) {
    const from = this.target ?? Math.round(this.p);
    this.goTo(from + dir);
  }

  /** Spins to a slot. */
  goTo(n: number) {
    this.dragging = false;
    this.target = n;
    this.omega = SNAP;
  }

  /** Where it will come to rest. */
  rest(): number {
    return this.target ?? Math.round(this.p);
  }

  settled(): boolean {
    return !this.dragging && this.target !== null && Math.abs(this.p - this.target) < 1e-3 && Math.abs(this.v) < 1e-2;
  }

  update(dt: number) {
    if (this.dragging || this.target === null) return;
    // Small fixed steps: stable at any frame rate.
    let left = Math.min(dt, 0.1);
    while (left > 0) {
      const h = Math.min(left, 1 / 120);
      left -= h;
      const w = this.omega;
      const a = w * w * (this.target - this.p) - 2 * w * this.v;
      this.v += a * h;
      this.v = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, this.v));
      this.p += this.v * h;
    }
    if (Math.abs(this.p - this.target) < 1e-3 && Math.abs(this.v) < 1e-2) {
      this.p = this.target;
      this.v = 0;
      this.omega = SNAP;
    }
  }
}

/** n mod m, always 0 ≤ r < m. */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** The nearest unbounded slot to `from` that shows sequence position `pos` (of `len`). */
export function nearestSlot(from: number, pos: number, len: number): number {
  const base = Math.round(from);
  let d = mod(pos - mod(base, len), len);
  if (d > len / 2) d -= len;
  return base + d;
}

/** The ring's pods. */
export const PODS = 12;

/**
 * Which slot (unbounded) each of the 12 pods holds with the wheel at `p`
 * and `len` Pokémon in the sequence: pod k holds the slot ≡ k (mod 12)
 * nearest the front, so a pod passing the back of the ring takes the next
 * Pokémon on. With fewer than 12 Pokémon each appears once and the rest of
 * the pods stand empty (null).
 */
export function podSlots(p: number, len: number): (number | null)[] {
  const c = Math.round(p);
  const out: (number | null)[] = [];
  const lo = len >= PODS ? -PODS / 2 : -Math.floor((len - 1) / 2);
  const hi = len >= PODS ? PODS / 2 - 1 : Math.ceil((len - 1) / 2);
  for (let k = 0; k < PODS; k++) {
    let off = mod(k - c, PODS);
    if (off >= PODS / 2) off -= PODS;
    out.push(len > 0 && off >= lo && off <= hi ? c + off : null);
  }
  return out;
}
