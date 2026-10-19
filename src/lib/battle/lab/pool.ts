import type { FromWorker, ToWorker } from "./protocol";
import { emptyTotals, mergeTotals, type BattleRecord, type LabTotals } from "./stats";
import type { LabSetup } from "./types";

/**
 * The Battle Lab's workers, on the page's side: a small pool (one per spare
 * core, fewer on low-memory devices) started on the first run and kept for
 * the next. A run is cut into chunks of battle indices: small ones first,
 * then about a quarter of a second's worth each, handed to whichever worker
 * is free. Each chunk's totals are added in as they arrive, so the page can
 * show the result converging. Because battle `i` depends only on the
 * master seed and `i`, the final totals don't depend on how the work was
 * split.
 */

export interface LabProgress {
  done: number;
  total: number;
  totals: LabTotals;
  /** Per battle: 0 not played yet, 1 Side A won, 2 Side B won, 3 a draw. */
  outcomes: Uint8Array;
  elapsedMs: number;
}

export interface LabRunResult extends LabProgress {
  cancelled: boolean;
  /** Changes made to fit the generation. */
  notes: string[];
  /** Starting conditions that didn't take. */
  misses: string[];
}

export interface LabReplay {
  index: number;
  record: BattleRecord;
  log: string[];
  misses: string[];
}

export class LabRunError extends Error {
  constructor(
    message: string,
    /** The setup itself is the problem. */
    readonly setup: boolean
  ) {
    super(message);
  }
}

/** One worker per spare core, at most six (each holds the simulator's data); fewer where memory is short. */
export function defaultPoolSize(): number {
  if (typeof navigator === "undefined") return 1;
  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  let size = Math.max(1, Math.min(6, cores - 1));
  if (memory !== undefined && memory <= 2) size = 1;
  else if (memory !== undefined && memory <= 4) size = Math.min(size, 2);
  return size;
}

/** Milliseconds of battles per chunk once the pace is known. */
const CHUNK_MS = 250;

interface Slot {
  worker: Worker;
  /** The run chunk it's playing, if any. */
  busy: boolean;
}

export class LabPool {
  readonly size: number;
  private slots: Slot[] = [];
  private job = 0;
  private listeners = new Map<number, (msg: FromWorker, slot: Slot) => void>();

  constructor(size = defaultPoolSize()) {
    this.size = size;
  }

  private start() {
    if (this.slots.length) return;
    for (let i = 0; i < this.size; i++) {
      const worker = new Worker(new URL("./lab.worker.ts", import.meta.url));
      const slot: Slot = { worker, busy: false };
      worker.onmessage = (e: MessageEvent<FromWorker>) => this.listeners.get(e.data.job)?.(e.data, slot);
      worker.onerror = (e) => {
        e.preventDefault();
        for (const listener of this.listeners.values()) listener({ type: "error", job: -1, setup: false, message: e.message || "A simulator worker crashed." }, slot);
      };
      this.slots.push(slot);
    }
  }

  private post(slot: Slot, msg: ToWorker) {
    slot.worker.postMessage(msg);
  }

  /** Plays battles 0 to `total` − 1 with master seed `seed`. `onProgress` hears after every chunk. */
  run(setup: LabSetup, seed: string, total: number, onProgress: (p: LabProgress) => void): { promise: Promise<LabRunResult>; cancel: () => void } {
    this.start();
    const job = ++this.job;
    const started = performance.now();
    const totals = emptyTotals();
    const outcomes = new Uint8Array(total);
    let next = 0;
    let done = 0;
    let msPerBattle = 0;
    let notes: string[] = [];
    let misses: string[] = [];
    let finished = false;
    let resolveRun!: (r: LabRunResult) => void;
    let rejectRun!: (e: Error) => void;
    const promise = new Promise<LabRunResult>((resolve, reject) => {
      resolveRun = resolve;
      rejectRun = reject;
    });

    const progress = (): LabProgress => ({ done, total, totals, outcomes, elapsedMs: performance.now() - started });
    const finish = (cancelled: boolean) => {
      if (finished) return;
      finished = true;
      this.listeners.delete(job);
      resolveRun({ ...progress(), cancelled, notes, misses });
    };
    const fail = (err: LabRunError) => {
      if (finished) return;
      finished = true;
      this.listeners.delete(job);
      rejectRun(err);
    };

    const dispatch = (slot: Slot) => {
      if (finished) return;
      if (next >= total) {
        slot.busy = false;
        if (done >= total) finish(false);
        return;
      }
      // Small chunks until the pace is known, then ~CHUNK_MS each; near the end, keep every worker busy.
      const remaining = total - next;
      let size = msPerBattle ? Math.round(CHUNK_MS / msPerBattle) : 2;
      size = Math.max(1, Math.min(size, 2_000, Math.ceil(remaining / this.slots.length)));
      const from = next;
      next = Math.min(total, next + size);
      slot.busy = true;
      this.post(slot, { type: "run", job, from, to: next });
    };

    this.listeners.set(job, (msg, slot) => {
      if (msg.type === "error") return fail(new LabRunError(msg.message, msg.setup));
      if (msg.type === "ready") {
        notes = msg.notes;
        misses = msg.misses;
        return;
      }
      if (msg.type !== "chunk") return;
      mergeTotals(totals, msg.totals);
      outcomes.set(msg.outcomes, msg.from);
      const n = msg.to - msg.from;
      done += n;
      const pace = msg.ms / Math.max(1, n);
      msPerBattle = msPerBattle ? msPerBattle * 0.7 + pace * 0.3 : pace;
      onProgress(progress());
      dispatch(slot);
    });

    this.slots.forEach((slot, i) => {
      this.post(slot, { type: "setup", job, setup, seed, check: i === 0 });
      dispatch(slot);
    });
    if (total <= 0) finish(false);

    return {
      promise,
      // Stop handing out work and settle with what's done. Chunks still in flight are ignored.
      cancel: () => finish(true),
    };
  }

  /** Plays one battle of a run again, with its log. */
  replay(setup: LabSetup, seed: string, index: number): Promise<LabReplay> {
    this.start();
    const job = ++this.job;
    const slot = this.slots.find((s) => !s.busy) ?? this.slots[0];
    return new Promise<LabReplay>((resolve, reject) => {
      this.listeners.set(job, (msg) => {
        this.listeners.delete(job);
        if (msg.type === "replay") resolve({ index: msg.index, record: msg.record, log: msg.log, misses: msg.misses });
        else if (msg.type === "error") reject(new LabRunError(msg.message, msg.setup));
      });
      this.post(slot, { type: "replay", job, setup, seed, index });
    });
  }

  dispose() {
    for (const slot of this.slots) slot.worker.terminate();
    this.slots = [];
    this.listeners.clear();
  }
}
