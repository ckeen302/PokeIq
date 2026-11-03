import { Battle, EV, EVENT_INTS, NOTE_INTS, prepare, TICK_HZ } from "@/lib/mass-battle/engine";
import { DEFAULT_PLAYBACK, type PlaybackSpec } from "@/lib/mass-battle/types";
import type { FromSim, Moment, SimEnd, SimFrame, ToSim } from "./protocol";

/**
 * The live battle, off the main thread: the page asks for ticks a few at a
 * time (staying a little ahead of what it draws) and gets each tick's
 * positions, HP, targets and hits back as transferred buffers, so drawing
 * thousands of Pokémon never waits on the simulation. Buffers come back
 * for reuse once drawn.
 *
 * Between requests it plays ahead by the battle's playback speed (half a
 * second of battle at 1×, two at 4×, never while paused), a few ticks at a
 * time so a request is answered at once from what's ready.
 */

/** Battle seconds played ahead per 1× of playback speed, and the most ticks held. */
const AHEAD_S = 0.5;
const AHEAD_MAX = 48;
/** Ticks played ahead before the worker looks at its messages again. */
const AHEAD_CHUNK = 4;

const scope = self as unknown as {
  postMessage(message: FromSim, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToSim>) => void) | null;
};

let battle: Battle | null = null;
let current = -1;
let playback: PlaybackSpec = DEFAULT_PLAYBACK;
let paused = false;
/** Frames played ahead of the page's requests (in order). */
let ahead: SimFrame[] = [];
let aheadTimer: ReturnType<typeof setTimeout> | null = null;
/** Milliseconds a tick takes to play (smoothed), reported with each batch of frames. */
let tickCost = 0;

/** One tick played and turned into a frame. */
function advance(b: Battle): SimFrame {
  const t0 = performance.now();
  b.step();
  const f = frameOf(b);
  const ms = performance.now() - t0;
  tickCost = tickCost ? tickCost * 0.9 + ms * 0.1 : ms;
  return f;
}
let spec: Extract<ToSim, { type: "init" }>["spec"] | null = null;
let roster: Extract<ToSim, { type: "init" }>["roster"] | null = null;
const pool = new Map<number, ArrayBuffer[]>();

function take(bytes: number): ArrayBuffer {
  const list = pool.get(bytes);
  return list?.pop() ?? new ArrayBuffer(bytes);
}

function frameOf(b: Battle): SimFrame {
  const n = b.n;
  const pos = new Float32Array(take(n * 8), 0, n * 2);
  const hp = new Uint16Array(take(n * 2), 0, n);
  const target = new Int32Array(take(n * 4), 0, n);
  for (let i = 0; i < n; i++) {
    pos[i * 2] = b.x[i];
    pos[i * 2 + 1] = b.z[i];
    hp[i] = Math.max(0, Math.min(65535, b.hp[i]));
    target[i] = b.target[i];
  }
  const events = b.events.slice(0, b.eventCount * EVENT_INTS);
  const notes = b.notes.slice(0, b.noteCount * NOTE_INTS);
  return { tick: b.tick, pos, hp, target, events, notes, left: [b.left[0], b.left[1]], ended: b.ended, winner: b.winner };
}

function endOf(b: Battle): SimEnd {
  const kos: [number, number][][] = [[], []];
  for (let s = 0; s < 2; s++) {
    const by = new Map<number, number>();
    for (let i = 0; i < b.n; i++) if (b.side[i] === s && b.kos[i]) by.set(b.sp[i], (by.get(b.sp[i]) ?? 0) + b.kos[i]);
    kos[s] = [...by.entries()].sort((a, c) => c[1] - a[1]);
  }
  return { outcome: b.outcome(), stats: b.stats(), kosBySpecies: kos };
}

const transfers = (f: SimFrame) => [f.pos.buffer, f.hp.buffer, f.target.buffer, f.events.buffer, f.notes.buffer] as ArrayBuffer[];

/** How many ticks to hold ready for the playback. */
const aheadWanted = () => (paused ? 0 : Math.min(AHEAD_MAX, Math.ceil(Math.max(1, playback.speed) * AHEAD_S * TICK_HZ)));

/** Plays ahead a few ticks at a time, letting the page's messages in between. */
function playAhead() {
  if (aheadTimer !== null) return;
  aheadTimer = setTimeout(() => {
    aheadTimer = null;
    const b = battle;
    if (!b) return;
    const want = aheadWanted();
    for (let k = 0; k < AHEAD_CHUNK && ahead.length < want && !b.ended; k++) ahead.push(advance(b));
    if (ahead.length < want && !b.ended) playAhead();
  }, 0);
}

function dropAhead() {
  if (aheadTimer !== null) clearTimeout(aheadTimer);
  aheadTimer = null;
  ahead = [];
}

/** Plays the same battle to the end without drawing, noting the moments worth a cut (for the video). */
function plan(id: number) {
  if (!spec || !roster) return;
  const b = new Battle(prepare({ version: roster.version, moves: roster.moves, species: roster.species }, spec));
  const moments: Moment[] = [];
  const bossSide = [b.start[0] <= 3, b.start[1] <= 3];
  while (!b.ended) {
    b.step();
    const t = b.tick / TICK_HZ;
    // Group by action: KOs and the biggest hit of each.
    let action = -1, kos = 0, actor = -1, target = -1, crit = false, bossHit = false, big = 0;
    const flush = () => {
      if (action < 0) return;
      if (kos >= 5) moments.push({ t, kind: "multi", actor, target, value: kos });
      else if (crit && bossHit) moments.push({ t, kind: "crit", actor, target, value: big });
      action = -1; kos = 0; crit = false; bossHit = false; big = 0;
    };
    for (let k = 0; k < b.eventCount; k++) {
      const o = k * EVENT_INTS;
      const ev = b.events;
      if (ev[o + 5] !== action) {
        flush();
        action = ev[o + 5];
        actor = ev[o];
        target = ev[o + 1];
      }
      if (ev[o + 4] & EV.KO) {
        kos++;
        if (bossSide[b.side[ev[o + 1]]]) moments.push({ t, kind: "ko-boss", actor: ev[o], target: ev[o + 1], value: 1 });
      }
      if (ev[o + 4] & EV.CRIT) crit = true;
      if (bossSide[b.side[ev[o + 1]]]) bossHit = true;
      big = Math.max(big, ev[o + 3]);
    }
    flush();
  }
  moments.push({ t: b.tick / TICK_HZ, kind: "final", actor: -1, target: -1, value: 0 });
  scope.postMessage({ type: "plan", id, seconds: b.tick / TICK_HZ, moments, outcome: b.outcome() });
}

scope.onmessage = (event) => {
  const msg = event.data;
  try {
    if (msg.type === "init") {
      const t0 = performance.now();
      dropAhead();
      tickCost = 0;
      spec = msg.spec;
      roster = msg.roster;
      playback = msg.playback ?? DEFAULT_PLAYBACK;
      paused = false;
      const prep = prepare({ version: msg.roster.version, moves: msg.roster.moves, species: msg.roster.species }, msg.spec);
      battle = new Battle(prep);
      current = msg.id;
      const b = battle;
      const frame = frameOf(b);
      scope.postMessage(
        {
          type: "ready",
          id: msg.id,
          n: b.n,
          arena: b.arena,
          species: prep.species.map((s) => s.id),
          sp: b.sp.slice(),
          side: b.side.slice(),
          maxHp: b.rows.map((r) => r.maxHp),
          radius: b.rows.map((r) => r.radius),
          start: [b.start[0], b.start[1]],
          moves: prep.moves.map((ms) => ms.map((m) => ({ name: m.name, type: m.type, cat: m.cat, contact: m.contact, spread: m.spread }))),
          fighters: prep.sets.map((s) => ({ level: s.level, ability: s.ability, item: s.item, nature: s.nature, tera: s.tera })),
          field: prep.field,
          frame,
          setupMs: performance.now() - t0,
        },
        transfers(frame)
      );
      return;
    }
    if (msg.type === "recycle") {
      for (const buf of msg.buffers) {
        const list = pool.get(buf.byteLength) ?? [];
        if (list.length < 24) list.push(buf);
        pool.set(buf.byteLength, list);
      }
      return;
    }
    if (msg.type === "plan") {
      plan(msg.id);
      return;
    }
    if (msg.type === "playback") {
      if (msg.id !== current) return;
      playback = msg.playback;
      paused = !!msg.paused;
      if (ahead.length < aheadWanted()) playAhead();
      return;
    }
    if (msg.type === "step") {
      if (!battle || msg.id !== current) return;
      // What's been played ahead first, then the rest.
      const frames: SimFrame[] = ahead.splice(0, msg.count);
      while (frames.length < msg.count && !battle.ended) frames.push(advance(battle));
      // The end goes with the battle's last frame.
      const end = battle.ended && !ahead.length ? endOf(battle) : undefined;
      scope.postMessage({ type: "frames", id: msg.id, frames, end, ms: tickCost * frames.length }, frames.flatMap(transfers));
      if (!battle.ended) playAhead();
    }
  } catch (err) {
    scope.postMessage({ type: "error", id: "id" in msg ? msg.id : -1, message: err instanceof Error ? err.message : String(err) });
  }
};
