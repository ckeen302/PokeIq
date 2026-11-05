import { STRUGGLE } from "@/lib/mass-battle/damage";
import { Battle, EV, EVENT_INTS, NOTE_INTS, prepare, TICK_HZ } from "@/lib/mass-battle/engine";
import { DEFAULT_PLAYBACK, type PlaybackSpec } from "@/lib/mass-battle/types";
import { pickMvp } from "./post-stats";
import { TIMELINE_TICKS, type FromSim, type Moment, type SimEnd, type SimFrame, type ToSim } from "./protocol";

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

/** The post-battle stats as the battle plays (only for a battle played from its start). */
let tally: { kosByMove: Map<number, number>; bossKoTick: number; timeline: number[]; bossSide: number } | null = null;

function newTally(b: Battle) {
  const bossSide = b.start[0] <= 3 && b.start[1] >= 4 ? 0 : b.start[1] <= 3 && b.start[0] >= 4 ? 1 : -1;
  tally = { kosByMove: new Map(), bossKoTick: -1, timeline: [], bossSide };
  sample(b);
}

function sample(b: Battle) {
  if (!tally) return;
  tally.timeline.push(b.tick, b.left[0], b.left[1], Math.round(b.hpShare(0) * 1000), Math.round(b.hpShare(1) * 1000));
}

function count(b: Battle) {
  if (!tally) return;
  const ev = b.events;
  for (let k = 0; k < b.eventCount; k++) {
    const o = k * EVENT_INTS;
    if (!(ev[o + 4] & EV.KO)) continue;
    const actor = ev[o], target = ev[o + 1], slot = ev[o + 2];
    if (tally.bossSide >= 0 && b.side[target] === tally.bossSide) tally.bossKoTick = b.tick;
    if (actor === target || slot < 0 || b.side[actor] === b.side[target]) continue;
    const key = (b.sp[actor] * 8 + slot) * 2 + b.side[actor];
    tally.kosByMove.set(key, (tally.kosByMove.get(key) ?? 0) + 1);
  }
  if (b.tick % TIMELINE_TICKS === 0 || b.ended) sample(b);
}

/** One tick played and turned into a frame. */
function advance(b: Battle): SimFrame {
  const t0 = performance.now();
  b.step();
  count(b);
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
  const end: SimEnd = { outcome: b.outcome(), stats: b.stats(), kosBySpecies: kos };
  if (tally) {
    const by = new Map<number, { fighter: number; side: number; count: number; dealt: number; kos: number }>();
    for (let i = 0; i < b.n; i++) {
      const key = b.sp[i] * 2 + b.side[i];
      const row = by.get(key) ?? { fighter: b.sp[i], side: b.side[i], count: 0, dealt: 0, kos: 0 };
      row.count++;
      row.dealt += b.dealt[i];
      row.kos += b.kos[i];
      by.set(key, row);
    }
    // The MVP is the winners' (anyone's in a draw).
    const mvp = pickMvp(b.side, b.kos, b.dealt, b.winner);
    end.post = {
      mvp: mvp >= 0 ? { unit: mvp, fighter: b.sp[mvp], side: b.side[mvp], kos: b.kos[mvp], dealt: Math.round(b.dealt[mvp]) } : null,
      bySpecies: [...by.values()].map((r) => ({ ...r, dealt: Math.round(r.dealt) })).sort((a, c) => c.dealt - a.dealt),
      byMove: [...tally.kosByMove.entries()].map(([key, kos]) => ({ fighter: Math.floor(key / 16), slot: Math.floor(key / 2) % 8, side: key % 2, kos })).sort((a, c) => c.kos - a.kos),
      bossKoTick: tally.bossKoTick,
      timeline: tally.timeline,
    };
  }
  return end;
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
      // A replay from partway through (the kill cam, the timeline): the same battle played silently up to there.
      const startTick = Math.max(0, Math.floor(msg.startTick ?? 0));
      if (startTick > 0) {
        tally = null;
        while (b.tick < startTick && !b.ended) b.step();
      } else newTally(b);
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
          // Each fighter's moves by slot, then Struggle (its slot is the move count).
          moves: prep.moves.map((ms) => [...ms, STRUGGLE].map((m) => ({ name: m.name, type: m.type, cat: m.cat, contact: m.contact, spread: m.spread }))),
          fighters: prep.sets.map((s) => ({ level: s.level, ability: s.ability, item: s.item, nature: s.nature, tera: s.tera })),
          // The field as the battle starts: a setter's weather or terrain (Drizzle, Electric Surge) is on show from the first frame.
          field: { ...prep.field, weather: b.fieldNow.weather, terrain: b.fieldNow.terrain },
          frame,
          ...(startTick > 0 ? { forms: b.form.slice() } : {}),
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
