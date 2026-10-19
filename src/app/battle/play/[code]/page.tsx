import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BattleRoom } from "@/components/battle/BattleRoom";
import { DUEL_CODE_RE } from "@/lib/duel-types";

export const metadata: Metadata = {
  title: "Battle vs Computer",
  robots: { index: false },
};

export default async function CpuBattlePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!DUEL_CODE_RE.test(code)) notFound();
  return (
    <div className="mx-auto max-w-7xl">
      <BattleRoom code={code} />
    </div>
  );
}
