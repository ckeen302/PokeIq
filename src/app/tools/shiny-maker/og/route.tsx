import type { NextRequest } from "next/server";
import { shinyMakerCard } from "@/lib/og/shiny-maker";
import { decodeDesign, fitsSpecies } from "@/lib/shiny-maker/design";
import { readSpecies } from "@/lib/shiny-maker/server";

/** GET /tools/shiny-maker/og?d=…: a design's preview card (the maker's own card without a valid design). */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const d = decodeDesign(req.nextUrl.searchParams.get("d"));
  const sp = await readSpecies(d?.id ?? 6).catch(() => null);
  if (!sp) return shinyMakerCard(null, null);
  if (!d) return shinyMakerCard(sp, null);
  return shinyMakerCard(sp, fitsSpecies(d, sp.parts.length, sp.slots.length) ? d : null);
}
