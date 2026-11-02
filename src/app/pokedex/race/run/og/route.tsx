import type { NextRequest } from "next/server";
import { racePresetCard, raceVsCard } from "@/lib/og/race";
import { RACE_BY_KEY } from "@/lib/race/data";
import { DEFAULT_PRESET, PRESET_BY_ID } from "@/lib/race/presets";
import { parseDistance, parseSeed, parseVs } from "@/lib/race/deeplink";

/** GET /pokedex/race/run/og?vs=regieleki,shuckle&d=200 (or ?run=<preset>): a shared race's preview card. */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const vs = parseVs(sp.get("vs"), (k) => RACE_BY_KEY.has(k)).map((k) => RACE_BY_KEY.get(k)!);
  const d = parseDistance(sp.get("d"));
  if (vs.length) return raceVsCard(vs, d ?? 100);
  const preset = PRESET_BY_ID.get(sp.get("run") ?? "") ?? DEFAULT_PRESET;
  return racePresetCard(preset, d, parseSeed(sp.get("seed")));
}
