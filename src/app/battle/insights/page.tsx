import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { SESSION_COOKIE, userFromSessionToken } from "@/lib/server/auth";

export const metadata: Metadata = pageMetadata({ title: "Team insights", description: "Your battle insights: leads, Pokémon, toughest opponents and rating over time.", path: "/battle/insights", noindex: true });

export const dynamic = "force-dynamic";

/** "Your insights" (from the ladder): the signed-in trainer's own page, or a way to sign in. */
export default async function MyInsightsPage({ searchParams }: { searchParams: Promise<{ format?: string }> }) {
  const user = await userFromSessionToken((await cookies()).get(SESSION_COOKIE)?.value).catch(() => null);
  const { format } = await searchParams;
  if (user) redirect(`/battle/insights/${encodeURIComponent(user.username)}${format ? `?format=${encodeURIComponent(format)}` : ""}`);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BattleHeader crumb="Team insights" title="Team" accent="insights">
        Your most common leads, win rate per Pokémon, the foes that beat you most and your rating over time, from your saved battles.
      </BattleHeader>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground">
          <p>Insights follow your account: sign in to see yours.</p>
          <Link href="/login" className={buttonVariants()}>
            Sign in
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
