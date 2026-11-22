/* eslint-disable @next/next/no-img-element -- artwork comes pre-sized from /api/art */
import Link from "@/components/ui/Link";
import type { Metadata } from "next";
import { BackButton } from "@/components/ui/BackButton";
import { WhichPokemonQuiz } from "@/components/which-pokemon/WhichPokemonQuiz";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { artUrl } from "@/lib/pokemon/art";
import { POOL, speciesInfo } from "@/lib/which-pokemon/pool";
import { QUIZ_PATH } from "@/lib/which-pokemon/match";
import { wpName } from "@/lib/which-pokemon/i18n";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import wp from "@/messages/which-pokemon";
import quiz from "@/messages/which-pokemon-quiz";

/**
 * /quiz/which-pokemon: the personality quiz. Eighteen in-world statements
 * score seven traits (the Big Five plus competitiveness and independence),
 * and the nearest of 200 researched Pokémon profiles is the result. The page
 * is the quiz and nothing else; the explanation lives on each result page.
 */

export function generateMetadata(): Metadata {
  const t = serverT(wp);
  return pageMetadata({
    title: t("meta.title"),
    description: t("meta.description"),
    path: QUIZ_PATH,
    socialTitle: t("meta.socialTitle"),
    socialDescription: t("meta.socialDescription"),
  });
}

/** Sample results on the page, left to right. */
const SAMPLE = ["pikachu", "gengar", "snorlax", "lucario", "sylveon", "mimikyu", "gholdengo", "psyduck"];

export default function WhichPokemonPage() {
  const t = serverT(wp);
  const locale = getLocale();
  const samples = SAMPLE.map((slug) => POOL.find((p) => p.slug === slug)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  const nameOf = (id: number, slug: string) => (locale === "en" ? (speciesInfo(id)?.name ?? slug) : wpName(id, locale));
  const ld = {
    "@context": "https://schema.org",
    "@type": "Quiz",
    name: t("meta.ldName"),
    description: t("meta.ldDescription"),
    about: { "@type": "Thing", name: "Pokémon" },
    isAccessibleForFree: true,
  };
  return (
    <div className="space-y-8">
      <BackButton href="/quiz" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <header className="mx-auto max-w-2xl space-y-2 text-center">
        <p className="hud-label max-md:hidden text-screen">{t("page.kicker")}</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">{t("page.title")}</h1>
        <p className="text-muted-foreground">{t("page.lead")}</p>
      </header>
      <ClientMessages namespaces={[quiz]}>
        <WhichPokemonQuiz />
      </ClientMessages>
      <nav aria-label={t("page.samples")} className="mx-auto flex max-w-xl flex-wrap items-center justify-center gap-1">
        {samples.map((p) => (
          <Link key={p.id} href={`${QUIZ_PATH}/${p.slug}`} className="rounded-md p-1 transition-colors hover:bg-accent/50" title={t("page.sample", { name: nameOf(p.id, p.slug) })}>
            <img src={artUrl(p.id, 96)} alt={nameOf(p.id, p.slug)} width={48} height={48} loading="lazy" className="h-12 w-12 object-contain" />
          </Link>
        ))}
      </nav>
    </div>
  );
}
