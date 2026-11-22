import type { Metadata } from "next";
import Link from "@/components/ui/Link";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { LadderTable, LadderTabs, YourBattleStanding } from "@/components/battle/LadderParts";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { isLadderFormat } from "@/lib/battle/ladder";
import { PLAY_FORMAT_INFO, type StandardFormatId } from "@/lib/battle/play";
import { GLICKO_START, GXE_RD_SHOWN } from "@/lib/battle/glicko";
import { ELO_START } from "@/lib/rating/elo";
import { ladderTop } from "@/lib/server/battle-engine/ladder";
import { avatarsByNames } from "@/lib/server/avatars";
import { insightsAvailable } from "@/lib/server/battle-engine/insights";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import battlePages from "@/messages/battle-pages";
import battleLadder from "@/messages/battle-ladder";
import battleGlicko from "@/messages/battle-glicko";

export function generateMetadata(): Metadata {
  const t = serverT(battlePages);
  return pageMetadata({
    title: t("ladder.title"),
    description: t("ladder.description"),
    image: SHARE_IMAGES.battle,
    path: "/battle/ladder",
  });
}

export const dynamic = "force-dynamic";

export default async function LadderPage({ searchParams }: { searchParams: Promise<{ format?: string }> }) {
  const { format: raw } = await searchParams;
  const format: StandardFormatId = isLadderFormat(raw) ? raw : "gen9randombattle";
  const rows = await ladderTop(format);
  const [avatars, insights] = await Promise.all([avatarsByNames((rows ?? []).map((r) => r.name)), insightsAvailable().catch(() => false)]);
  const t = serverT(battlePages);
  const RULES = <>{t("ladder.rules", { elo: ELO_START, rating: GLICKO_START.rating, rd: GLICKO_START.rd, shown: GXE_RD_SHOWN })}</>;
  return (
    <div className="mx-auto max-w-4xl space-y-6 max-md:space-y-4">
      <BattleHeader crumb={t("ladder.crumb")} title={t("ladder.heading")} accent={t("ladder.accent")}>
        <span className="max-md:hidden">{RULES}</span>
        {/* Phones: one line here, so the ladder itself is on the first screen; the rest is under the table. */}
        <span className="md:hidden">{t("ladder.short", { elo: ELO_START })}</span>
      </BattleHeader>
      <ClientMessages namespaces={[battleLadder, battleGlicko]}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LadderTabs format={format} hrefBase="/battle/ladder?format=" />
        <div className="flex flex-wrap gap-2">
          {insights && (
            <Link href={`/battle/insights?format=${format}`} className={buttonVariants({ size: "sm", variant: "outline" })} data-testid="ladder-insights">
              {t("ladder.insights")}
            </Link>
          )}
          <Link href="/battle/play?vs=anyone" className={buttonVariants({ size: "sm" })}>
            {t("ladder.play")}
          </Link>
        </div>
      </div>
      {rows === null ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">{t("ladder.soon")}</CardContent>
        </Card>
      ) : (
        <>
          <YourBattleStanding format={format} />
          <h2 className="font-display text-xl font-bold uppercase tracking-wide max-md:text-base">{t("ladder.top", { format: PLAY_FORMAT_INFO[format].name })}</h2>
          <LadderTable rows={rows} format={format} avatars={avatars} />
          <details className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground md:hidden" data-testid="ladder-rules">
            <summary className="cursor-pointer font-display font-bold uppercase tracking-wide text-foreground">{t("ladder.how")}</summary>
            <p className="mt-2">{RULES}</p>
          </details>
        </>
      )}
      </ClientMessages>
    </div>
  );
}
