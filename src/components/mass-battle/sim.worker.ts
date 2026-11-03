import { Battle, EV, EVENT_INTS, NOTE_INTS, prepare, TICK_HZ } from "@/lib/mass-battle/engine";
import type { FromSim, Moment, SimEnd, SimFrame, ToSim } from "./protocol";

/**
 * The live battle, off the main thread: the page asks for ticks a few at a
 * time (staying a little ahead of what it draws) and gets each tick's
 * positions, HP, targets and hits back as transferred buffers, so drawing
 * thousands of Pokémon never waits on the simulation. Buffers come back
 * for reuse once drawn.
 */

const scope = self as unknown as {
  postMessage(message: FromSim, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToSim>) => void) | null;
};

let battle: Battle | null = null;
let current = -1;
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
      spec = msg.spec;
      roster = msg.roster;
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
    if (msg.type === "step") {
      if (!battle || msg.id !== current) return;
      const t0 = performance.now();
      const frames: SimFrame[] = [];
      for (let k = 0; k < msg.count && !battle.ended; k++) {
        battle.step();
        frames.push(frameOf(battle));
      }
      const end = battle.ended ? endOf(battle) : undefined;
      scope.postMessage({ type: "frames", id: msg.id, frames, end, ms: performance.now() - t0 }, frames.flatMap(transfers));
    }
  } catch (err) {
    scope.postMessage({ type: "error", id: "id" in msg ? msg.id : -1, message: err instanceof Error ? err.message : String(err) });
  }
};
