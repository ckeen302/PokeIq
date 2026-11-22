import type { NextRequest } from "next/server";
import { serverT } from "@/i18n/server";
import tierList from "@/messages/tier-list";
import { sharedCard, templateCard } from "@/lib/og/tier-list";
import { buildRoster } from "@/lib/tier-list/roster.server";
import { decodeShare, makeCodec } from "@/lib/tier-list/share";
import { getTemplate, templateMons } from "@/lib/tier-list/templates";
import { poolKeys } from "@/lib/tier-list/state";
import { seedEntrants } from "@/lib/tier-list/bracket";
import { blindDraw } from "@/lib/tier-list/blind";
import { modeName, templateName, templateSeoName } from "@/components/tools/tier-list/names";

/** GET /tools/tier-list/<template>/og[?s=…]: the template's preview card, or a shared result's. */
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ template: string }> }) {
  const tpl = getTemplate((await params).template);
  const t = serverT(tierList);
  const roster = buildRoster();
  if (!tpl) return templateCard("Pokémon", t("title"), [25, 6, 150, 448, 658, 1000]);
  const state = decodeShare(req.nextUrl.searchParams.get("s"), makeCodec(roster.mons));
  if (!state || state.template !== tpl.slug) {
    const faces = [tpl.face, ...templateMons(tpl, roster.mons).filter((m) => !m.f && m.d !== tpl.face).sort((a, b) => b.b - a.b).map((m) => m.d)].slice(0, 6);
    return templateCard(templateSeoName(t, tpl), t("title"), faces.length ? faces : [tpl.face]);
  }
  const byKey = new Map(roster.mons.map((m) => [m.k, m]));
  const pool = poolKeys(state, roster.mons);
  const entrants = state.mode === "bracket" ? seedEntrants(pool.map((k) => byKey.get(k)!), state.bracket.size, state.bracket.seeding, state.bracket.seed, state.bracket.manual) : [];
  const drawn = state.mode === "blind" ? blindDraw(state.blind.source === "random" ? roster.mons.filter((m) => !m.f).map((m) => m.k) : pool, state.blind.length, state.blind.seed) : [];
  return sharedCard(state, byKey, entrants, drawn, {
    maker: t("title"),
    mode: modeName(t, state.mode, state.top.length),
    title: state.title || templateName(t, tpl),
    champion: t("bracket.champion"),
  });
}
