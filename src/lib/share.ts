"use client";

import { dailyNumber } from "./daily";
import { MODULE_INFO } from "./modes";
import type { RunResult } from "./session-types";

/** Spoiler-free emoji grid, wrapped every 10 answers. */
export function emojiGrid(grid: string, perRow = 10): string {
  const cells = [...grid].map((c) => (c === "1" ? "🟩" : "🟥"));
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += perRow) rows.push(cells.slice(i, i + perRow).join(""));
  return rows.join("\n");
}

export function challengeUrl(shareToken: string): string {
  return `${window.location.origin}/c/${shareToken}`;
}

export function resultShareText(result: RunResult): string {
  const { spec } = result;
  const title = spec.daily
    ? `PokéIQ Daily #${dailyNumber(spec.daily)}`
    : `PokéIQ · ${MODULE_INFO[spec.module].title}${spec.format !== "classic" ? ` (${spec.format})` : ""}`;
  return [
    `${title} — ${result.correct}/${result.total}`,
    `🧠 PokéIQ ${result.pokeiq} · ${result.score.toLocaleString()} pts`,
    emojiGrid(result.grid),
  ].join("\n");
}

export type ShareOutcome = "shared" | "copied" | "failed";

/** Native share sheet on mobile, clipboard elsewhere. */
export async function shareOrCopy(text: string, url?: string): Promise<ShareOutcome> {
  const full = url ? `${text}\n${url}` : text;
  if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ text: full });
      return "shared";
    } catch (err) {
      if ((err as Error).name === "AbortError") return "failed";
    }
  }
  try {
    await navigator.clipboard.writeText(full);
    return "copied";
  } catch {
    return "failed";
  }
}
