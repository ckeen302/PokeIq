import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { redirect, serverT } from "@/i18n/server";
import { BattleRoom } from "@/components/battle/BattleRoom";
import { BattleRoomMessages } from "@/components/battle/BattleRoomMessages";
import { peekBattle } from "@/lib/server/battle-engine/store";
import { DUEL_CODE_RE } from "@/lib/duel-types";
import { battleHref } from "@/lib/battle/play";
import pagesNs from "@/messages/battle-room-pages";

export function generateMetadata(): Metadata {
  const t = serverT(pagesNs);
  return {
    title: t("play.title"),
    robots: { index: false },
  };
}

export default async function CpuBattlePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!DUEL_CODE_RE.test(code)) notFound();
  const battle = await peekBattle(code);
  if (battle === null) notFound();
  // A live battle's code: off to its own page.
  if (battle && battle.kind !== "cpu") redirect(battleHref(battle.kind, code));
  return (
    <div className="mx-auto max-w-7xl">
      <BattleRoomMessages>
        <BattleRoom key={code} code={code} />
      </BattleRoomMessages>
    </div>
  );
}
