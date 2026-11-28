import type { Metadata } from "next";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { getLocale, serverT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import tierList from "@/messages/tier-list";
import tools from "@/messages/tools";
import pickerPage from "@/messages/favorite-picker-page";
import { toolJsonLd } from "@/lib/tier-list/seo";
import { TemplateGrid } from "@/components/tools/tier-list/TemplateGrid";
import { ContinueChip } from "@/components/tools/tier-list/ContinueChip";

/** /tools/tier-list: the Pokémon Tier List Maker's front page. Pick a template (each opens with all four modes), or the Favorite Pokémon Picker. */

const PATH = "/tools/tier-list";

export function generateMetadata(): Metadata {
  const t = serverT(tierList);
  return pageMetadata({ title: t("metaTitle"), description: t("metaDescription"), path: PATH, image: { url: `${PATH}/og`, alt: t("title") } });
}

export default function TierListHome() {
  const t = serverT(tierList);
  const locale = getLocale();
  return (
    <div className="mx-auto max-w-5xl pt-2 max-sm:pt-0" data-testid="tier-list-home">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(toolJsonLd({ name: t("title"), path: PATH, description: t("metaDescription"), ...(locale !== "en" && { locale, crumbs: { tools: serverT(tools)("hub.title"), maker: t("title") } }) })) }} />
      <header className="space-y-3">
        <h1 className="font-display text-5xl font-bold tracking-tight max-sm:text-[34px] max-sm:leading-tight">{t("title")}</h1>
        <p className="max-w-2xl text-[17px] text-muted-foreground max-sm:text-[15px]">{t("subtitle")}</p>
        <ClientMessages namespaces={[tierList]}>
          <ContinueChip />
        </ClientMessages>
      </header>
      <section className="mt-10 max-sm:mt-7" aria-labelledby="tl-pick">
        <h2 id="tl-pick" className="mb-5 font-display text-2xl font-semibold tracking-tight">{t("pick.heading")}</h2>
        <ClientMessages namespaces={[tierList]}>
          {/* The Favorite Pokémon Picker is one more kind of list here (it has no card of its own on /tools). */}
          <TemplateGrid extra={[{ href: "/tools/favorite-pokemon-picker", label: serverT(pickerPage)("cardTitle"), face: 133, testId: "template-favorite-picker" }]} />
        </ClientMessages>
      </section>
      <p className="mt-12 text-center text-[12px] leading-relaxed text-muted-foreground/70">{t("credit")}</p>
    </div>
  );
}
