import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { BattleProfileView, BattleRecordCard } from "@/components/battle/BattleProfileView";
import { Card, CardContent } from "@/components/ui/card";
import { USERNAME_RE } from "@/lib/server/auth";
import { accountBattleKey } from "@/lib/server/battle-engine/identity";
import { battleProfile } from "@/lib/server/battle-engine/records";

interface PageProps {
  params: Promise<{ name: string }>;
}

export const dynamic = "force-dynamic";

/**
 * A trainer's public battle profile. Accounts only: a trainer who battles
 * without signing in has no public page (their record stays on their own
 * trainer card).
 */
const findProfile = cache(async (raw: string) => {
  const name = decodeURIComponent(raw);
  if (!USERNAME_RE.test(name)) return null;
  const account = await accountBattleKey(name);
  if (!account) return null;
  const profile = await battleProfile(account.key).catch((err) => {
    console.error("[battle-profile] read failed:", err);
    return null;
  });
  return { username: account.username, profile };
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const found = await findProfile((await params).name);
  if (!found) return pageMetadata({ title: "Trainer not found", description: "No such trainer on PokéIQ.", noindex: true });
  return pageMetadata({
    title: `${found.username}'s battle record`,
    description: `${found.username}'s Pokémon battles on PokéIQ: wins, losses and ladder ratings per format, and their latest battles with replays.`,
    path: `/battle/player/${encodeURIComponent(found.username)}`,
  });
}

export default async function BattlePlayerPage({ params }: PageProps) {
  const found = await findProfile((await params).name);
  if (!found) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BattleHeader crumb="Trainer" title={found.username} accent="battles">
        Wins and losses per format against other trainers, ladder ratings, and the latest battles with their replays.
      </BattleHeader>
      {found.profile ? (
        <BattleRecordCard title="Battle record">
          <BattleProfileView profile={{ ...found.profile, name: found.username }} now={Date.now()} empty={`${found.username} hasn't played a live battle yet.`} />
        </BattleRecordCard>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">Battle records open soon.</CardContent>
        </Card>
      )}
    </div>
  );
}
