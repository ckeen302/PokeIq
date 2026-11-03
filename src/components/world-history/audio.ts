import type { Film, FilmState } from "@/lib/world-history/timing";

/** The film's sound (filled in below). */
export interface HistoryAudio {
  gesture(): void;
  setMuted(m: boolean): void;
  update(s: { state: FilmState; playing: boolean; dt: number }): void;
  dispose(): void;
}

export function createHistoryAudio(film: Film): HistoryAudio {
  void film;
  return { gesture() {}, setMuted() {}, update() {}, dispose() {} };
}
