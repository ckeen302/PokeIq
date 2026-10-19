"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { defaultPoolSize, LabPool, LabRunError, type LabProgress, type LabReplay } from "@/lib/battle/lab/pool";
import { emptyTotals, wilson } from "@/lib/battle/lab/stats";
import { sideLabels, type LabSetup } from "@/lib/battle/lab/types";

/** Side A's win rate (with its 95% interval) after `n` battles. */
export interface ConvergencePoint {
  n: number;
  p: number;
  lo: number;
  hi: number;
}

export type RunStatus = "running" | "done" | "cancelled" | "error";

export interface LabRun {
  id: number;
  /** The setup as it was when the run started. */
  setup: LabSetup;
  labels: [string, string];
  seed: string;
  total: number;
  status: RunStatus;
  progress: LabProgress;
  history: ConvergencePoint[];
  notes: string[];
  misses: string[];
  error?: string;
  /** The setup itself was the problem. */
  setupError?: boolean;
  workers: number;
}

const MAX_POINTS = 240;

function point(p: LabProgress): ConvergencePoint {
  const w = wilson(p.totals.wins[0], p.totals.battles);
  return { n: p.done, p: w.p, lo: w.lo, hi: w.hi };
}

/** Keeps the convergence line to a few hundred points (every other point once it's full; the newest always kept). */
function thin(points: ConvergencePoint[]): ConvergencePoint[] {
  if (points.length <= MAX_POINTS) return points;
  const last = points[points.length - 1];
  const kept = points.filter((_, i) => i % 2 === 0);
  if (kept[kept.length - 1] !== last) kept.push(last);
  return kept;
}

/** The Battle Lab's worker pool and its current run, updated at most once a frame while battles come in. */
export function useLabRun() {
  const pool = useRef<LabPool | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const runId = useRef(0);
  const [run, setRun] = useState<LabRun | null>(null);
  const [workers, setWorkers] = useState(0);

  useEffect(() => {
    setWorkers(defaultPoolSize());
    return () => {
      cancelRef.current?.();
      pool.current?.dispose();
      pool.current = null;
    };
  }, []);

  const start = useCallback((setup: LabSetup, seed: string, total: number) => {
    cancelRef.current?.();
    pool.current ??= new LabPool();
    const p = pool.current;
    const id = ++runId.current;
    const labels = sideLabels(setup);
    const blank: LabProgress = { done: 0, total, totals: emptyTotals(), outcomes: new Uint8Array(total), elapsedMs: 0 };
    setRun({ id, setup, labels, seed, total, status: "running", progress: blank, history: [], notes: [], misses: [], workers: p.size });

    let pending: LabProgress | null = null;
    let frame = 0;
    const history: ConvergencePoint[] = [];
    const flush = () => {
      frame = 0;
      if (!pending || runId.current !== id) return;
      const latest = pending;
      pending = null;
      // A fresh totals object each frame, so React sees the change.
      const snapshot: LabProgress = { ...latest, totals: structuredClone(latest.totals) };
      setRun((r) => (r && r.id === id ? { ...r, progress: snapshot, history: [...history] } : r));
    };
    const handle = p.run(setup, seed, total, (progress) => {
      if (progress.done) history.push(point(progress));
      if (history.length > MAX_POINTS) history.splice(0, history.length, ...thin(history));
      pending = progress;
      if (!frame) frame = requestAnimationFrame(flush);
    });
    cancelRef.current = handle.cancel;
    handle.promise.then(
      (result) => {
        if (runId.current !== id) return;
        cancelAnimationFrame(frame);
        if (result.done && (!history.length || history[history.length - 1].n !== result.done)) history.push(point(result));
        setRun((r) =>
          r && r.id === id
            ? {
                ...r,
                status: result.cancelled ? "cancelled" : "done",
                progress: { ...result, totals: structuredClone(result.totals) },
                history: thin(history),
                notes: result.notes,
                misses: result.misses,
              }
            : r
        );
      },
      (err: unknown) => {
        if (runId.current !== id) return;
        cancelAnimationFrame(frame);
        const message = err instanceof Error ? err.message : "The run failed.";
        setRun((r) => (r && r.id === id ? { ...r, status: "error", error: message, setupError: err instanceof LabRunError && err.setup } : r));
      }
    );
  }, []);

  const cancel = useCallback(() => cancelRef.current?.(), []);

  const replay = useCallback((setup: LabSetup, seed: string, index: number): Promise<LabReplay> => {
    pool.current ??= new LabPool();
    return pool.current.replay(setup, seed, index);
  }, []);

  return { run, start, cancel, replay, workers };
}
