import type { Metadata } from "next";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList } from "@/lib/structured-data";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { CaseBoard } from "@/components/theories/CaseBoard";
import { CaseExplorer } from "@/components/theories/CaseExplorer";
import { toFolder } from "@/components/theories/CaseFolder";
import { CASES } from "@/lib/theories/data";
import { localizeCase, theoryTexts } from "@/lib/theories/i18n";
import { SOURCE_ORDER, caseOfTheWeek } from "@/lib/theories/logic";
import { THEORIES_PATH, type TheoryCase } from "@/lib/theories/types";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import dexTheories from "@/messages/dex-theories";
import dexTheoriesList from "@/messages/dex-theories-list";

export function generateMetadata(): Metadata {
  const t = serverT(dexTheories);
  return pageMetadata({
    title: t("meta.title"),
    description: t("meta.description"),
    path: THEORIES_PATH,
    socialTitle: t("meta.socialTitle"),
  });
}

/** The Case of the week turns over on Mondays: the page is rebuilt hourly so it picks up the new one. */
export const revalidate = 3600;

export default function TheoriesPage() {
  const locale = getLocale();
  return locale === DEFAULT_LOCALE ? <TheoriesView cases={CASES} /> : <LocalTheoriesView locale={locale} />;
}

/** Another language's case files: every case with its text in that language. */
async function LocalTheoriesView({ locale }: { locale: Locale }) {
  const tx = await theoryTexts(locale);
  return <TheoriesView cases={CASES.map((c) => localizeCase(c, tx, locale))} />;
}

function TheoriesView({ cases }: { cases: TheoryCase[] }) {
  const t = serverT(dexTheories);
  const featured = caseOfTheWeek(cases, new Date());
  const sources = SOURCE_ORDER.filter((x) => cases.some((c) => c.sources.includes(x)));
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <ListHeader kicker={t("header.kicker")} title={t("header.title")} accent={t("header.accent")} blurb={t("header.blurb")} />
      <DexTabs active="theories" />
      <div className="mx-auto flex w-full max-w-[1152px] flex-col gap-6 pt-6">
        <div className="flex flex-col gap-2">
          <span className={"font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-screen"}>{t("list.eyebrow")}</span>
          <h2 className="m-0 font-display text-4xl font-bold uppercase leading-none sm:text-[44px]">
            {t.rich("list.title", { b: (chunks) => <span className="text-primary">{chunks}</span> })}
          </h2>
          <p className="m-0 text-[15px] text-muted-foreground">{t("list.lead")}</p>
        </div>
        <CaseBoard c={featured} />
        <ClientMessages namespaces={[dexTheoriesList]}>
          <CaseExplorer cases={cases.map(toFolder)} sources={sources} />
        </ClientMessages>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList([{ name: t("ld.pokedex"), path: "/pokedex" }, { name: t("ld.theories"), path: THEORIES_PATH }])) }} />
    </div>
  );
}
