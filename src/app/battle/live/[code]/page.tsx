import type { Metadata } from "next";
import { inviteMetadata } from "@/lib/seo";
import { cache } from "react";
import { notFound } from "next/navigation";
import { redirect, serverT } from "@/i18n/server";
import { BattleRoom } from "@/components/battle/BattleRoom";
import { BattleRoomMessages } from "@/components/battle/BattleRoomMessages";
import { peekBattle } from "@/lib/server/battle-engine/store";
import { DUEL_CODE_RE } from "@/lib/duel-types";
import { battleHref } from "@/lib/battle/play";
import { formatName } from "@/lib/battle/format-labels";
import pagesNs from "@/messages/battle-room-pages";
import formatsNs from "@/messages/battle-formats";

interface PageProps {
  params: Promise<{ code: string }>;
}

/** One read for the metadata and the page (the store only: no simulator needed here). */
const findBattle = cache(peekBattle);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const url = `/battle/live/${encodeURIComponent((await params).code)}`;
  const { code } = await params;
  const t = serverT(pagesNs);
  const battle = DUEL_CODE_RE.test(code) ? await findBattle(code) : null;
  if (!battle) return inviteMetadata(t("live.title"), t("live.description"), url);
  const [host, guest] = battle.names;
  const format = formatName(serverT(formatsNs), battle.format);
  const title = guest ? t("live.titleVs", { host, guest }) : t("live.titleHost", { host: host || t("live.aTrainer") });
  return inviteMetadata(title, t("live.descriptionFormat", { format }), url);
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
      <BattleRoomMessages>
        <BattleRoom key={code} code={code} />
      </BattleRoomMessages>
    </div>
  );
}
