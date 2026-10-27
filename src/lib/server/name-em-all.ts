import "server-only";
import { standardMinutes } from "@/lib/name-em-all/categories";
import { neaTargets } from "@/lib/name-em-all/targets";
import { scopeCategory } from "./name-em-all-scope";

/**
 * A Name 'em All scope: a category's own boards ("gen-1"), or a day's
 * daily ("daily:2026-10-26", whose category is the day's).
 */
export interface NeaScope {
  scope: string;
  category: string;
  daily: string | null;
  total: number;
  limitMs: number;
}

export function parseScope(scope: unknown, now = Date.now()): NeaScope | null {
  const named = scopeCategory(scope, now);
  if (!named) return null;
  const total = neaTargets(named.category)!.length;
  return { ...named, total, limitMs: standardMinutes(total) * 60_000 };
}
