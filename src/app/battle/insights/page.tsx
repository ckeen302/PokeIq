import type { Metadata } from "next";
import Link from "@/components/ui/Link";
import { cookies } from "next/headers";
import { redirect } from "@/i18n/server";
import { pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { SESSION_COOKIE, userFromSessionToken } from "@/lib/server/auth";
import { serverT } from "@/i18n/server";
import battlePages from "@/messages/battle-tools-pages";

export function generateMetadata(): Metadata {
  const t = serverT(battlePages);
  return pageMetadata({ title: t("insights.title"), description: t("insights.description"), path: "/battle/insights", noindex: true });
}

export const dynamic = "force-dynamic";

/** "Your insights" (from the ladder): the signed-in trainer's own page, or a way to sign in. */
export default async function MyInsightsPage({ searchParams }: { searchParams: Promise<{ format?: string }> }) {
  const user = await userFromSessionToken((await cookies()).get(SESSION_COOKIE)?.value).catch(() => null);
  const { format } = await searchParams;
  if (user) redirect(`/battle/insights/${encodeURIComponent(user.username)}${format ? `?format=${encodeURIComponent(format)}` : ""}`);
  const t = serverT(battlePages);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BattleHeader crumb={t("insights.crumb")} title={t("insights.heading")} accent={t("insights.accent")}>
        {t("insights.intro")}
      </BattleHeader>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground">
          <p>{t("insights.signIn")}</p>
          <Link href="/login" className={buttonVariants()}>
            {t("insights.signInButton")}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
