import { NextResponse } from "next/server";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { DEX_EXTRA_COLUMNS, dleAssistOf, type DleAssist } from "@/lib/dle-assist";
import type { DleDexRow } from "@/lib/dle-types";
import { dleStage } from "@/lib/server/pokedle";

/**
 * GET /api/pokedle/dex?assist=notebook|field|full — every Pokémon you can
 * guess in Pokédle, for the Pokédex beside the board, with only what that
 * assist level shows: name, generation and types for the Notebook (the
 * default, also when `assist` is missing or unknown), plus stage and colour
 * for the Field Guide, plus height and weight for the Full Pokédex (see
 * DEX_EXTRA_COLUMNS). Anything sent here can be read in the browser, so a
 * lighter level never gets the columns it hides. `off` has no Pokédex (404).
 * The same list for everyone and every puzzle, so it says nothing about any
 * answer.
 */

const CACHE = { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" };

/** The rows for a level (null for Off). */
function rowsFor(assist: DleAssist): DleDexRow[] | null {
  const extra = DEX_EXTRA_COLUMNS[assist];
  if (!extra) return null;
  return POKEDEX.map((p) => {
    const all = { stage: dleStage(p), color: p.color, height: p.height, weight: p.weight };
    return [p.id, p.name, p.gen, p.types[0], p.types[1] ?? null, ...extra.map((c) => all[c])] as DleDexRow;
  });
}

const bodies = new Map<DleAssist, string>();

export function GET(request: Request) {
  const assist = dleAssistOf(new URL(request.url).searchParams.get("assist"));
  let body = bodies.get(assist);
  if (body === undefined) {
    const rows = rowsFor(assist);
    if (!rows) return NextResponse.json({ error: "There's no Pokédex with assist off." }, { status: 404, headers: CACHE });
    bodies.set(assist, (body = JSON.stringify(rows)));
  }
  return new NextResponse(body, { headers: { ...CACHE, "Content-Type": "application/json" } });
}
