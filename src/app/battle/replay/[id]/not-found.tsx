import Link from "@/components/ui/Link";
import { Clapperboard, FileUp, Radio } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { serverT } from "@/i18n/server";
import battlePages from "@/messages/battle-pages";

/** A replay that doesn't exist, was never saved, or isn't available to this viewer. */
export default function ReplayNotFound() {
  const t = serverT(battlePages);
  return (
    <div className="mx-auto max-w-xl py-12">
      <Card>
        <CardContent className="space-y-4 p-8 text-center" data-testid="replay-not-found">
          <Clapperboard className="mx-auto h-8 w-8 text-screen" aria-hidden />
          <h1 className="font-display text-2xl font-bold uppercase">{t("notFound.heading")}</h1>
          <p className="text-sm text-muted-foreground">{t("notFound.body")}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/battle/replays" className={buttonVariants()}>
              <Clapperboard className="h-4 w-4" aria-hidden /> {t("notFound.browse")}
            </Link>
            <Link href="/battle/watch" className={buttonVariants({ variant: "outline" })}>
              <Radio className="h-4 w-4" aria-hidden /> {t("notFound.live")}
            </Link>
            <Link href="/battle/replay/import" className={buttonVariants({ variant: "outline" })}>
              <FileUp className="h-4 w-4" aria-hidden /> {t("notFound.import")}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
