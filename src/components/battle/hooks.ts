"use client";

import { useEffect, useState } from "react";
import type { Move } from "@pkmn/data";
import { loadFormatDex, loadSpriteLookup, type FormatDex } from "@/lib/battle/dex";
import type { BattleFormatId } from "@/lib/battle/formats";
import type { TeamCheck, TeamSet } from "@/lib/battle/sets";
import type { SpriteSpecies } from "@/lib/battle/sprites";

/** The format's Pokédex data, loaded on demand (null until it arrives). */
export function useFormatDex(format: BattleFormatId): { dex: FormatDex | null; error: boolean } {
  const [state, setState] = useState<{ format: BattleFormatId; dex: FormatDex | null; error: boolean }>({ format, dex: null, error: false });
  useEffect(() => {
    let live = true;
    loadFormatDex(format).then(
      (dex) => live && setState({ format, dex, error: false }),
      () => live && setState({ format, dex: null, error: true })
    );
    return () => {
      live = false;
    };
  }, [format]);
  return state.format === format ? state : { dex: null, error: false };
}

type SpriteLookup = (name: string) => SpriteSpecies | null;

export function useSpriteLookup(): SpriteLookup | null {
  const [lookup, setLookup] = useState<{ fn: SpriteLookup } | null>(null);
  useEffect(() => {
    let live = true;
    loadSpriteLookup().then(
      (fn) => live && setLookup({ fn }),
      () => undefined
    );
    return () => {
      live = false;
    };
  }, []);
  return lookup?.fn ?? null;
}

/** Moves `species` can learn in the dex's format. */
export function useLearnable(dex: FormatDex | null, species: string | undefined): { moves: Move[]; loading: boolean } {
  const key = dex && species ? `${dex.format.id}:${species}` : "";
  const [state, setState] = useState<{ key: string; moves: Move[] }>({ key: "", moves: [] });
  useEffect(() => {
    if (!dex || !species) return;
    let live = true;
    dex.learnable(species).then(
      (moves) => live && setState({ key, moves }),
      () => live && setState({ key, moves: [] })
    );
    return () => {
      live = false;
    };
  }, [dex, species, key]);
  return state.key === key ? { moves: state.moves, loading: false } : { moves: [], loading: !!key };
}

export type CheckState =
  | { status: "empty" }
  | { status: "checking"; last: TeamCheck | null }
  | { status: "done"; check: TeamCheck }
  | { status: "error"; message: string };

/** Pokémon Showdown's verdict on the team, re-checked a moment after each edit. */
export function useTeamCheck(format: BattleFormatId, sets: TeamSet[]): CheckState {
  const key = JSON.stringify({ format, sets });
  const empty = sets.length === 0;
  const [state, setState] = useState<{ key: string; result: CheckState } | null>(null);

  useEffect(() => {
    if (empty) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/battle/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: key,
          signal: controller.signal,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Check failed (${res.status})`);
        setState({ key, result: { status: "done", check: body as TeamCheck } });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({ key, result: { status: "error", message: err instanceof Error ? err.message : "Check failed" } });
      }
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, empty]);

  if (empty) return { status: "empty" };
  if (state?.key === key) return state.result;
  const last = state?.result.status === "done" ? state.result.check : null;
  return { status: "checking", last };
}
