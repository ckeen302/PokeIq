import Link from "@/components/ui/Link";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { BackButton } from "@/components/ui/BackButton";
import { GameInfo } from "@/components/seo/GameInfo";
import { NeaDailyCard, NeaRaceCard } from "@/components/name-em-all/HubCards";
import { pageMetadata } from "@/lib/seo";
import { NEA_CATEGORIES, NEA_GROUPS, NEA_PATH, neaHref } from "@/lib/name-em-all/categories";
import { neaCounts } from "@/lib/name-em-all/targets";
import { categoryLabels } from "@/lib/name-em-all/localize";
import { formatNumber } from "@/i18n/catalog";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import neaPages from "@/messages/nea-pages";
import neaCats from "@/messages/nea-cats";
import neaHub from "@/messages/nea-hub";

export function generateMetadata(): Metadata {
  const t = serverT(neaPages);
  return pageMetadata({
    title: t("hub.metaTitle"),
    description: t("hub.metaDescription"),
    path: NEA_PATH,
    image: { url: `${NEA_PATH}/opengraph-image`, alt: t("ogAlt") },
  });
}

export default function NameEmAllHub() {
  const t = serverT(neaPages);
  const tc = serverT(neaCats);
  const counts = neaCounts();
  const labels = categoryLabels(tc);
  const options = NEA_CATEGORIES.map((c) => ({ id: c.id, label: labels[c.id], total: counts[c.id] }));
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <BackButton href="/quiz" />
      <header className="mx-auto max-w-2xl space-y-2 text-center">
        <p className="hud-label max-md:hidden text-screen">{t("hub.eyebrow")}</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">{t("title")}</h1>
        <p className="text-muted-foreground">
          {t("hub.lead")}
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <ClientMessages namespaces={[neaHub]}>
          <NeaDailyCard labels={labels} counts={counts} />
          <NeaRaceCard options={options} />
        </ClientMessages>
      </div>

      <div className="space-y-6" data-testid="nea-categories">
        {NEA_GROUPS.map((g) => {
          const cats = NEA_CATEGORIES.filter((c) => c.group === g.id);
          return (
            <section key={g.id} className="space-y-2.5" aria-labelledby={`nea-g-${g.id}`}>
              <h2 id={`nea-g-${g.id}`} className="font-display text-lg font-bold uppercase tracking-wide">
                {tc(`groups.${g.id}`)}
              </h2>
              <ul className={g.id === "all" ? "grid gap-2" : "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"}>
                {cats.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={neaHref(c.id)}
                      className="group flex h-full items-center justify-between gap-2 rounded-md border bg-card px-3 py-2.5 transition-colors hover:border-screen/60"
                      data-testid={`nea-cat-${c.id}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{labels[c.id]}</span>
                        <span className="hud-label">{t("count", { n: formatNumber(counts[c.id], t.locale) })}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <GameInfo
        hidden
        path={NEA_PATH}
        name={t("title")}
        description={t("hub.info.description")}
        intro={t("hub.info.intro")}
        steps={(["pick", "mode", "type", "giveUp"] as const).map((k) => t(`hub.info.steps.${k}`))}
        faqs={(["daily", "race", "best"] as const).map((k) => ({ q: t(`hub.info.faq.${k}Q`), a: t(`hub.info.faq.${k}A`) }))}
      />
    </div>
  );
}
