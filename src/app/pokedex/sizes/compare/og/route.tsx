import type { NextRequest } from "next/server";
import { sizesCard, sizesCompareCard } from "@/lib/og/sizes";
import { SIZE_BY_KEY } from "@/lib/sizes/data";
import { compareOk, parseVs } from "@/lib/sizes/deeplink";
import { DEFAULT_PRESET } from "@/lib/sizes/presets";

/** GET /pokedex/sizes/compare/og?vs=wailord,eternatus: a comparison's preview card (figures at true relative scale). */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const keys = parseVs(req.nextUrl.searchParams.get("vs"), (k) => { const i = SIZE_BY_KEY.get(k); return !!i && i.kind !== "ref"; });
  return compareOk(keys.length) ? sizesCompareCard(keys.map((k) => SIZE_BY_KEY.get(k)!)) : sizesCard(DEFAULT_PRESET);
}
