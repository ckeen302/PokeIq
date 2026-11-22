import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BackButton } from "@/components/ui/BackButton";
import { GameInfo } from "@/components/seo/GameInfo";
import { NameEmAll } from "@/components/name-em-all/NameEmAll";
import { pageMetadata, jsonLd } from "@/lib/seo";
import { NEA_CATEGORIES, NEA_PATH, neaCategory, neaHref, standardMinutes } from "@/lib/name-em-all/categories";
import { categoryText, localOutsiders, localTargets } from "@/lib/name-em-all/localize";
import { formatNumber } from "@/i18n/catalog";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import neaPages from "@/messages/nea-pages";
import neaCats from "@/messages/nea-cats";
import neaGame from "@/messages/nea-game";

/**
 * One page per Name 'em All category, statically generated with its own
 * title, description and JSON-LD, and only its own slots in the payload
 * (in another language, their names there and the other names each answers to).
 */

interface PageProps {
  params: Promise<{ category: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return NEA_CATEGORIES.map((c) => ({ category: c.id }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const cat = neaCategory((await params).category);
  if (!cat) return {};
  const t = serverT(neaPages);
  const text = categoryText(cat, serverT(neaCats));
  return pageMetadata({ title: text.title, description: text.description, path: neaHref(cat.id), image: { url: `${NEA_PATH}/opengraph-image`, alt: t("ogAlt") } });
}

export default async function NameEmAllCategoryPage({ params }: PageProps) {
  const cat = neaCategory((await params).category);
  const tc = serverT(neaCats);
  const targets = cat && localTargets(cat.id, tc);
  if (!cat || !targets) notFound();
  const t = serverT(neaPages);
  const text = categoryText(cat, tc);
  const minutes = standardMinutes(targets.length);

  return (
    <div className="space-y-6">
      <BackButton href={NEA_PATH} label={t("back")} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({ "@context": "https://schema.org", "@type": "Quiz", name: text.title, description: text.description, about: { "@type": "Thing", name: "Pokémon" }, isAccessibleForFree: true }),
        }}
      />
      <header className="mx-auto max-w-3xl space-y-2 text-center">
        <p className="hud-label text-screen">{t("title")}</p>
        <h1 className="font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl">{text.h1}</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          {t("category.lead", { count: formatNumber(targets.length, t.locale), minutes, description: text.description })}
        </p>
      </header>

      <ClientMessages namespaces={[neaGame]}>
        <NameEmAll category={{ id: cat.id, label: text.label }} targets={targets} outsiders={localOutsiders(cat.id, tc)} />
      </ClientMessages>

      <GameInfo
        hidden
        path={neaHref(cat.id)}
        name={text.h1}
        description={text.description}
        intro={t("category.intro", { h1: text.h1, description: text.description })}
        steps={(["pick", "type", "finish"] as const).map((k) => t(`category.steps.${k}`))}
        faqs={[
          { q: t("category.faq.spellQ"), a: t("category.faq.spellA") },
          { q: t("category.faq.bestQ"), a: t("category.faq.bestA", { minutes }) },
        ]}
      />
    </div>
  );
}
