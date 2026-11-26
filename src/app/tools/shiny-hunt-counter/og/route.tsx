import type { NextRequest } from "next/server";
import { serverT } from "@/i18n/server";
import page from "@/messages/shiny-counter-page";
import counter from "@/messages/shiny-counter";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { sharedHuntCard, toolCard } from "@/lib/og/shiny-hunt";
import { decodeHunt } from "@/lib/shiny-hunt/share";

/** GET /tools/shiny-hunt-counter/og?d=…: a shared hunt's preview card (the counter's own card without a valid link). */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const t = serverT(page);
  const h = decodeHunt(req.nextUrl.searchParams.get("d"));
  if (!h) return toolCard({ eyebrow: t("ogEyebrow"), title: [t("ogTitle.a"), t("ogTitle.b")], chips: [t("ogChips.odds"), t("ogChips.methods"), t("ogChips.phases"), t("ogChips.trophies")] });
  return sharedHuntCard(h, getPokemon(h.species)?.name ?? "Pokémon", { t, c: serverT(counter) });
}
