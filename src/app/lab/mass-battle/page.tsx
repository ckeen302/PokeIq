import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { MASS_BATTLE_LIVE } from "@/lib/lab";
import { encodeBattle, encodeQuestion, MASS_BATTLE_PATH } from "@/lib/mass-battle/share";
import { linkBattle, linkPlayback, linkQuestion, nameOf, slugIndex } from "@/lib/mass-battle/page-data";
import { fmt, questionText, sideName } from "@/lib/mass-battle/copy";
import { buildRoster } from "@/lib/mass-battle/roster-data";
import { expandSpec, factsOf } from "@/lib/mass-battle/sets";
import { MassBattlePage } from "@/components/mass-battle/MassBattlePage";

type Search = { searchParams: Promise<{ b?: string | string[]; ask?: string | string[]; v?: string | string[] }> };

const DESCRIPTION = "Thousands of Pokémon clash on a 3D battlefield, with the real games' damage maths for every hit. How many Magikarp does it take to beat Arceus? Ask any matchup, or send two armies at each other, then make a video of it.";

export async function generateMetadata({ searchParams }: Search): Promise<Metadata> {
  const sp = await searchParams;
  const q = linkQuestion(sp.ask);
  const b = q ? null : linkBattle(sp.b);
  const slugs = slugIndex();
  if (q) {
    const title = questionText(sideName(q.army, nameOf), sideName(q.boss, nameOf));
    const code = encodeQuestion(q, slugs);
    return pageMetadata({ title, description: `${title} The real games' battle maths decide it, thousands of battles deep, then you watch it in 3D.`, path: `${MASS_BATTLE_PATH}?ask=${code}`, image: { url: `${MASS_BATTLE_PATH}/og?ask=${code}`, alt: title }, noindex: true });
  }
  if (b) {
    const x = expandSpec(b, buildRoster().species.map(factsOf));
    const side = (s: 0 | 1) => `${fmt(x.sides[s].units.reduce((a, u) => a + u.count, 0))} ${sideName(b.sides[s], nameOf)}`;
    const title = `${side(0)} vs ${side(1)}`;
    const code = encodeBattle(b, slugs);
    return pageMetadata({ title, description: `${title}: a Pokémon mass battle in 3D with the real games' damage maths. Who wins?`, path: `${MASS_BATTLE_PATH}?b=${code}`, image: { url: `${MASS_BATTLE_PATH}/og?b=${code}`, alt: title }, noindex: true });
  }
  return pageMetadata({ title: "Pokémon Mass Battle: how many Magikarp beat Arceus?", description: DESCRIPTION, path: MASS_BATTLE_PATH, socialTitle: "Pokémon Mass Battle · PokéIQ", noindex: !MASS_BATTLE_LIVE });
}

export default async function Page({ searchParams }: Search) {
  const sp = await searchParams;
  const question = linkQuestion(sp.ask);
  const battle = question ? null : linkBattle(sp.b);
  return <MassBattlePage question={question} battle={battle} playback={linkPlayback(sp.v)} />;
}
