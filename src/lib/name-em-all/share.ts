import { NEA_TITLE } from "./categories";
import type { NeaMode } from "./types";

/** 372_000 -> "6:12"; an hour or more -> "1:02:03". */
export function neaClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export interface NeaShareInput {
  label: string;
  named: number;
  total: number;
  ms: number;
  mode: NeaMode;
  /** The daily's date, when it was the daily. */
  daily?: string;
  url?: string;
}

/** "Name 'em All · Gen 1 · 151/151 in 6:12 🏆", then the link. Never which Pokémon were missed. */
export function neaShareText({ label, named, total, ms, mode, daily, url }: NeaShareInput): string {
  const parts = [daily ? `${NEA_TITLE} Daily ${daily}` : NEA_TITLE, label];
  if (mode !== "regular") parts.push(mode === "chaos" ? "Chaos" : "Dex order");
  const head = `${parts.join(" · ")} · ${named}/${total} in ${neaClock(ms)}${named === total ? " 🏆" : ""}`;
  return url ? `${head}\n${url}` : head;
}
