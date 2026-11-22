import { BackButton } from "@/components/ui/BackButton";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "@/components/ui/Link";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { dexBreadcrumbs, dexDescription, dexSummary, dexTitle } from "@/lib/pokemon/dex-seo";
import { POKEDEX, artworkUrl, getPokemonBySlug } from "@/lib/pokemon/pokedex";
import { getDexEntry } from "@/lib/pokemon/details";
import { DexEntry } from "@/components/pokedex/entry/DexEntry";
import { PokemonCards } from "@/components/tcg/PokemonCards";
import { cardLinksForDex } from "@/lib/tcg/card-index";
import { capitalize } from "@/lib/pokemon/type-matrix";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import pageNs from "@/messages/pokemon-page";
import dexEntryNs from "@/messages/dex-entry";
import dexPager from "@/messages/dex-pager";
import { speciesName } from "@/lib/names/species";
import { dexTexts, typeNames } from "@/lib/pokemon/dex-local";
import { localDexBreadcrumbs, localDexDescription, localDexSummary, localDexTitle, localizeDexEntry } from "@/lib/pokemon/dex-entry-local";

/** Static, crawlable study page for every species (1,025 pages at build time). */

export const dynamicParams = false;

export function generateStaticParams() {
  return POKEDEX.map((p) => ({ slug: p.slug }));
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const p = getPokemonBySlug((await params).slug);
  if (!p) return {};
  const t = serverT(pageNs);
  const locale = getLocale();
  return pageMetadata({
    title: locale === "en" ? dexTitle(p) : localDexTitle(p, locale),
    description: locale === "en" ? dexDescription(p) : localDexDescription(p, locale),
    path: `/pokemon/${p.slug}`,
    socialTitle: t("social", { name: locale === "en" ? p.name : speciesName(p.id, p.name, locale), id: p.id }),
  });
}

export default async function PokemonPage({ params }: PageProps) {
  const p = getPokemonBySlug((await params).slug);
  if (!p) notFound();
  const t = serverT(pageNs);
  const locale = getLocale();
  const data = locale === "en" ? getDexEntry(p) : localizeDexEntry(getDexEntry(p), locale);
  const cards = await cardLinksForDex(p.id, 6);
  const name = data.core.name;
  const typeName = locale === "en" ? capitalize : (ty: string) => typeNames(locale)[ty];

  const pageLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: t("ldName", { name }),
    about: { "@type": "Thing", name, description: locale === "en" ? p.flavor[0] : dexTexts(locale, "species")[p.id]?.[0]?.text },
    primaryImageOfPage: artworkUrl(p.id),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(pageLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(locale === "en" ? dexBreadcrumbs(p) : localDexBreadcrumbs(p, locale)) }} />
      <BackButton href="/pokedex" label={t("back")} className="mb-4" />
      <ClientMessages namespaces={[dexEntryNs, dexPager]}>
        <DexEntry key={p.id} data={data} />
      </ClientMessages>
      <PokemonCards key={`cards-${p.id}`} dex={p.id} name={name} />
      <section className="mx-auto mt-10 max-w-3xl space-y-3 text-sm text-muted-foreground" aria-label={t("about", { name })}>
        <h2 className="font-display text-base font-bold uppercase tracking-wider text-foreground">{t("summary", { name })}</h2>
        <p>{locale === "en" ? dexSummary(p) : localDexSummary(p, locale)}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/quiz/whos-that-pokemon" className="underline-offset-2 hover:text-foreground hover:underline">{t("whosThat")}</Link>
          <Link href="/battle/teams" className="underline-offset-2 hover:text-foreground hover:underline">{t("teams")}</Link>
          <Link href="/battle/calc" className="underline-offset-2 hover:text-foreground hover:underline">{t("calc")}</Link>
          <Link href={`/pokedex/sizes/${p.slug}`} className="underline-offset-2 hover:text-foreground hover:underline">{t("big", { name })}</Link>
          <Link href={`/pokedex/race/run?vs=${p.slug}`} className="underline-offset-2 hover:text-foreground hover:underline">{t("fast", { name })}</Link>
          <Link href="/pokedex" className="underline-offset-2 hover:text-foreground hover:underline">{t("full")}</Link>
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          {p.types.map((ty) => (
            <Link key={ty} href={`/pokedex/types/${ty}`} className="underline-offset-2 hover:text-foreground hover:underline" data-testid="dex-type-link">
              {t("typed", { type: typeName(ty) })}
            </Link>
          ))}
        </p>
        {cards.total > 0 && (
          <p className="flex flex-wrap gap-x-4 gap-y-1" data-testid="dex-card-links">
            <span className="text-foreground">{t("cards", { name })}</span>
            {cards.cards.map((c) => (
              <Link key={c.id} href={`/pokedex/tcg/card/${c.id}`} prefetch={false} className="underline-offset-2 hover:text-foreground hover:underline">
                {c.name} ({c.setName} {c.number})
              </Link>
            ))}
            {cards.total > cards.cards.length && (
              <Link href={`/pokedex/tcg?dex=${p.id}`} prefetch={false} className="underline-offset-2 hover:text-foreground hover:underline">
                {t("allCards", { n: cards.total })}
              </Link>
            )}
          </p>
        )}
      </section>
    </>
  );
}
