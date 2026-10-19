import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BattleRoom } from "@/components/battle/BattleRoom";
import { peekBattle } from "@/lib/server/battle-engine/store";
import { DUEL_CODE_RE } from "@/lib/duel-types";
import { battleHref } from "@/lib/battle/play";

export const metadata: Metadata = {
  title: "Battle vs Computer",
  robots: { index: false },
};

export default async function CpuBattlePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!DUEL_CODE_RE.test(code)) notFound();
  const battle = await peekBattle(code);
  if (battle === null) notFound();
  // A live battle's code: off to its own page.
  if (battle && battle.kind !== "cpu") redirect(battleHref(battle.kind, code));
  return (
    <div className="mx-auto max-w-7xl">
      <BattleRoom key={code} code={code} />
    </div>
  );
}
