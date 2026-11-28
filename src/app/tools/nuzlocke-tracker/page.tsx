import type { Metadata } from "next";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { getLocale, serverT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import page from "@/messages/nuzlocke-page";
import nuz from "@/messages/nuzlocke";
import tools from "@/messages/tools";
import { toolJsonLd } from "@/lib/tier-list/seo";
import { gameSummaries } from "@/lib/nuzlocke/games.server";
import { NuzHome } from "@/components/tools/nuzlocke/NuzHome";

/**
 * /tools/nuzlocke-tracker: the Nuzlocke Tracker's front page. The runs saved in this browser (Continue), then every
 * game to start a new run in, each with a link to its page of areas, Pokémon and level caps.
 */

const PATH = "/tools/nuzlocke-tracker";
const FEATURES = ["Nuzlocke tracker", "Encounters by area in story order", "Dupes, shiny, gift and static clauses", "Team, box and graveyard", "Team type weaknesses by generation", "Level caps", "Share links and images", "Backups"];

export function generateMetadata(): Metadata {
  const t = serverT(page);
  return pageMetadata({ title: t("metaTitle"), description: t("metaDescription"), path: PATH, image: { url: `${PATH}/og`, alt: t("ogAlt") } });
}

export default async function NuzlockeHome() {
  const t = serverT(page);
  const locale = getLocale();
  const games = await gameSummaries();
  const ld = jsonLd(toolJsonLd({ name: t("title"), path: PATH, description: t("metaDescription"), features: FEATURES, crumbs: { tools: serverT(tools)("hub.title"), maker: t("title") }, ...(locale !== "en" && { locale }) }));
  return (
    <div className="mx-auto max-w-6xl pt-2 max-sm:pt-0" data-testid="nuzlocke-home">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      <header className="space-y-3">
        <h1 className="font-display text-5xl font-bold tracking-tight max-sm:text-[34px] max-sm:leading-tight">{t("title")}</h1>
        <p className="max-w-3xl text-[17px] text-muted-foreground max-sm:text-[15px]">{t("subtitle")}</p>
      </header>
      <ClientMessages namespaces={[nuz]}>
        <NuzHome games={games} headings={{ start: t("games.heading"), lead: t("games.lead"), guide: t("games.guideLink"), regionGen: Object.fromEntries(games.map((g) => [g.id, t("games.regionGen", { region: g.region, gen: g.gen })])) }} />
      </ClientMessages>
      <p className="mt-14 text-center text-[12px] leading-relaxed text-muted-foreground/70">{t("credit")}</p>
    </div>
  );
}
