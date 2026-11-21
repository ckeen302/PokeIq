import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Pikadoku } from "@/components/pikadoku/Pikadoku";
import { GameInfo } from "@/components/seo/GameInfo";
import { publicDailies } from "@/lib/server/pikadoku";
import { ensureMaster } from "@/lib/server/pikadoku-master";
import { pikadokuLocal } from "@/lib/pikadoku/local";
import { howToFirstScript } from "@/lib/howto-first";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import page from "@/messages/pikadoku-page";
import pikadoku from "@/messages/pikadoku";
import pikadokuBoard from "@/messages/pikadoku-board";
import pikadokuDuel from "@/messages/pikadoku-duel";

/**
 * Regenerated hourly (ISR): the HTML carries the public daily grids for
 * yesterday, today and tomorrow (UTC), so whatever the player's local date the
 * board paints with the page. Only categories, never answers; the player's own
 * game state and the start token stay a separate, uncached request.
 */
export const revalidate = 3600;

export function generateMetadata(): Metadata {
  const t = serverT(page);
  return pageMetadata({
    title: t("meta.title"),
    description: t("meta.description"),
    path: "/pikadoku",
  });
}

/** A first visit's How to play shows with the board (lib/howto-first): the game's own check (see Pikadoku's first effect). */
const HOWTO_FIRST = howToFirstScript(
  "pokeiq:pikadoku:prefs",
  'P.seenHowTo!==true&&!((G.pdkPlay&&G.pdkPlay.games)>0)&&!Object.keys((G.pdk&&G.pdk.results)||{}).length&&!new URLSearchParams(location.search).get("c")'
);

export default async function PikadokuPage() {
  // Admin-scheduled Master grids too (the client still swaps to the API's grid if the page's ever differs).
  await ensureMaster();
  const t = serverT(page);
  // Another language's category labels and Pokémon names (English pages send none).
  const local = await pikadokuLocal(getLocale());
  return (
    <>
    <script dangerouslySetInnerHTML={{ __html: HOWTO_FIRST }} />
    <div className="space-y-10">
      <ClientMessages namespaces={[pikadoku, pikadokuBoard, pikadokuDuel]}>
        <Pikadoku initial={publicDailies()} local={local} />
      </ClientMessages>
      <GameInfo
        howToButton
        noFaq
        path="/pikadoku"
        name="Pikadoku"
        description={t("info.description")}
        intro={t("info.intro")}
        steps={(["read", "tap", "pp", "score", "end"] as const).map((k) => t(`info.steps.${k}`))}
        faqs={(["score", "forms", "solvable", "levels"] as const).map((k) => ({ q: t(`info.faq.${k}Q`), a: t(`info.faq.${k}A`) }))}
      />
    </div>
    </>
  );
}
