import type { Metadata } from "next";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { BattleRoom } from "@/components/battle/BattleRoom";
import { peekBattle } from "@/lib/server/battle-engine/store";
import { DUEL_CODE_RE } from "@/lib/duel-types";
import { PLAY_FORMAT_INFO, battleHref } from "@/lib/battle/play";

interface PageProps {
  params: Promise<{ code: string }>;
}

/** One read for the metadata and the page (the store only: no simulator needed here). */
const findBattle = cache(peekBattle);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const battle = DUEL_CODE_RE.test(code) ? await findBattle(code) : null;
  if (!battle) return { title: "Pokémon battle", robots: { index: false } };
  const [host, guest] = battle.names;
  const format = PLAY_FORMAT_INFO[battle.format].name;
  const title = guest ? `${host} vs ${guest}: a ${format} battle` : `${host || "A trainer"} challenges you to a ${format} battle`;
  return {
    title,
    description: "A live Pokémon battle on Pokémon Showdown's engine. Open the link, pick a name and battle.",
    openGraph: { title, description: `${format} · live on PokéIQ · real Showdown mechanics` },
    robots: { index: false },
  };
}

export default async function LiveBattlePage({ params }: PageProps) {
  const { code } = await params;
  if (!DUEL_CODE_RE.test(code)) notFound();
  const battle = await findBattle(code);
  // A store hiccup isn't a missing battle: the page loads and keeps polling.
  if (battle === null) notFound();
  if (battle && battle.kind !== "pvp") redirect(battleHref(battle.kind, code));
  return (
    <div className="mx-auto max-w-7xl">
      <BattleRoom key={code} code={code} />
    </div>
  );
}
