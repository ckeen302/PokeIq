import { defaultPoolSize } from "@/lib/battle/lab/pool";
import type { Evaluate, Evaluation } from "@/lib/mass-battle/solver";
import type { BattleSpec, Question } from "@/lib/mass-battle/types";
import type { FromSim, FromSolver, Moment, RosterSlice, SimEnd, SimFrame, SimReady, ToSim, ToSolver } from "./protocol";

/**
 * The page's side of the battle workers: one live simulation (asked for a
 * few ticks at a time) and a pool of "how many?" workers (one per spare
 * core, as the Battle Lab sizes its own) that play whole battles headless.
 */

export class SimClient {
  private worker: Worker;
  private id = 0;
  private waiting = new Map<string, (msg: FromSim) => void>();
  onFrames: ((frames: SimFrame[], end: SimEnd | undefined, ms: number) => void) | null = null;
  onError: ((message: string) => void) | null = null;
  /** Ticks asked for and not yet back. */
  inflight = 0;

  constructor() {
    this.worker = new Worker(new URL("./sim.worker.ts", import.meta.url));
    this.worker.onmessage = (e: MessageEvent<FromSim>) => this.receive(e.data);
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.onError?.(e.message || "The battle worker stopped.");
    };
  }

  private receive(msg: FromSim) {
    if (msg.type === "frames") {
      if (msg.id !== this.id) return;
      this.inflight = Math.max(0, this.inflight - msg.frames.length);
      if (msg.end) this.inflight = 0;
      this.onFrames?.(msg.frames, msg.end, msg.ms);
      return;
    }
    if (msg.type === "error") {
      this.onError?.(msg.message);
      return;
    }
    const key = `${msg.type}:${msg.id}`;
    const done = this.waiting.get(key);
    this.waiting.delete(key);
    done?.(msg);
  }

  private request<T extends FromSim>(msg: ToSim, type: T["type"], id: number): Promise<T> {
    return new Promise((resolve, reject) => {
      this.waiting.set(`${type}:${id}`, (m) => resolve(m as T));
      const prev = this.onError;
      this.onError = (message) => {
        this.waiting.delete(`${type}:${id}`);
        reject(new Error(message));
        this.onError = prev;
      };
      this.worker.postMessage(msg);
    });
  }

  /** Sets a battle up (damage table, armies in formation); resolves with its first frame. */
  async init(roster: RosterSlice, spec: BattleSpec): Promise<SimReady> {
    const id = ++this.id;
    this.inflight = 0;
    return this.request<SimReady>({ type: "init", id, roster, spec }, "ready", id);
  }

  step(count: number) {
    this.inflight += count;
    this.worker.postMessage({ type: "step", id: this.id, count } satisfies ToSim);
  }

  /** The same battle played to the end without drawing: its length and the moments worth a cut. */
  plan(): Promise<{ seconds: number; moments: Moment[] }> {
    return this.request<Extract<FromSim, { type: "plan" }>>({ type: "plan", id: this.id }, "plan", this.id);
  }

  /** Hands drawn frames' buffers back for reuse. */
  recycle(frames: SimFrame[]) {
    const buffers = frames.flatMap((f) => [f.pos.buffer, f.hp.buffer, f.target.buffer]) as ArrayBuffer[];
    if (buffers.length) this.worker.postMessage({ type: "recycle", buffers } satisfies ToSim, buffers);
  }

  dispose() {
    this.worker.terminate();
    this.waiting.clear();
  }
}

export interface SolverProgress {
  n: number;
  wins: number;
  played: number;
  of: number;
  phase: string;
}

export class SolverPool {
  readonly size: number;
  private slots: { w: Worker; busy: boolean }[] = [];
  private job = 0;
  private tag = 0;
  /** Battles already played this question: `${n}:${seed}` → winner (the answer replays the search's battles). */
  private cache = new Map<string, number>();
  private onResult: ((msg: FromSolver) => void) | null = null;
  private pump: (() => void) | null = null;

  constructor(size = defaultPoolSize()) {
    this.size = Math.max(1, size);
  }

  private start() {
    if (this.slots.length) return;
    for (let i = 0; i < this.size; i++) {
      const slot = { w: new Worker(new URL("./solver.worker.ts", import.meta.url)), busy: false };
      slot.w.onmessage = (e: MessageEvent<FromSolver>) => {
        slot.busy = false;
        const msg = e.data;
        if (msg.type === "result" && msg.job === this.job) this.cache.set(`${msg.n}:${msg.seed}`, msg.winner);
        this.onResult?.(msg);
        this.pump?.();
      };
      slot.w.onerror = (e) => {
        e.preventDefault();
        slot.busy = false;
        this.onResult?.({ type: "error", job: this.job, message: e.message || "A battle worker stopped." });
      };
      this.slots.push(slot);
    }
  }

  /** An `evaluate` for the solver: battles of n challengers on the seeds, spread over the pool, counted in seed order. */
  evaluator(roster: RosterSlice, q: Question, onProgress: (p: SolverProgress) => void, signal: AbortSignal): Evaluate {
    this.start();
    const job = ++this.job;
    this.cache.clear();
    for (const s of this.slots) s.w.postMessage({ type: "setup", job, roster, question: q } satisfies ToSolver);
    return (n, seeds, settled) =>
      new Promise<Evaluation>((resolve, reject) => {
        const tag = ++this.tag;
        const results: (number | undefined)[] = seeds.map((s) => this.cache.get(`${n}:${s}`));
        let next = 0, wins = 0, losses = 0, counted = 0, done = false;
        const stop = () => {
          done = true;
          this.onResult = null;
          this.pump = null;
        };
        const finish = () => {
          if (done) return;
          stop();
          const wonSeeds: number[] = [], lostSeeds: number[] = [];
          for (let k = 0; k < counted; k++) (results[k] === 0 ? wonSeeds : lostSeeds).push(seeds[k]);
          resolve({ wins, runs: wins + losses, wonSeeds, lostSeeds });
        };
        // Results count in seed order, so an early stop never depends on which worker was quicker.
        const advance = () => {
          while (!done && counted < seeds.length && results[counted] !== undefined) {
            if (results[counted] === 0) wins++;
            else losses++;
            counted++;
            if (settled(wins, losses)) return finish();
          }
          onProgress({ n, wins, played: wins + losses, of: seeds.length, phase: "" });
          if (counted >= seeds.length) finish();
        };
        const pump = () => {
          if (done) return;
          for (const slot of this.slots) {
            if (slot.busy) continue;
            while (next < seeds.length && results[next] !== undefined) next++;
            if (next >= seeds.length) break;
            slot.busy = true;
            slot.w.postMessage({ type: "run", job, tag, n, seed: seeds[next] } satisfies ToSolver);
            next++;
          }
        };
        signal.addEventListener("abort", () => {
          if (done) return;
          stop();
          reject(new DOMException("Cancelled", "AbortError"));
        }, { once: true });
        this.onResult = (msg) => {
          if (done) return;
          if (msg.type === "error") {
            stop();
            reject(new Error(msg.message));
            return;
          }
          if (msg.job !== job || msg.tag !== tag) return;
          const k = seeds.indexOf(msg.seed);
          if (k >= 0) results[k] = msg.winner;
          advance();
        };
        this.pump = pump;
        advance();
        pump();
      });
  }

  dispose() {
    for (const s of this.slots) s.w.terminate();
    this.slots = [];
    this.onResult = null;
    this.pump = null;
  }
}
