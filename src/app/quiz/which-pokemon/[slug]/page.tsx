/* eslint-disable @next/next/no-img-element -- artwork comes pre-sized from /api/art */
import Link from "@/components/ui/Link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BackButton } from "@/components/ui/BackButton";
import { ResultView } from "@/components/which-pokemon/ResultView";
import { TraitBars, TypeChips, WpLocalProvider } from "@/components/which-pokemon/parts";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { artUrl } from "@/lib/pokemon/art";
import { typeColor } from "@/lib/pokemon/type-colors";
import { POOL, pooledBySlug, speciesInfo } from "@/lib/which-pokemon/pool";
import { QUIZ_PATH, matchProfile } from "@/lib/which-pokemon/match";
import { firstSentence, wpLocal, wpName, wpText } from "@/lib/which-pokemon/i18n";
import type { PooledPokemon } from "@/lib/which-pokemon/types";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import wp from "@/messages/which-pokemon";
import resultNs from "@/messages/which-pokemon-result";
import share from "@/messages/share";

/**
 * /quiz/which-pokemon/[slug]: one static page per pooled Pokémon ("I got
 * Gengar"), with the write-up, the evidence behind its profile and its trait
 * bars. A player's own result arrives in the fragment and is rendered on
 * the client (ResultView); without one the page invites a visitor to play.
 */

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return POOL.map((p) => ({ slug: p.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const pokemon = pooledBySlug((await params).slug);
  if (!pokemon) return {};
  const t = serverT(wp);
  const locale = getLocale();
  const name = wpName(pokemon.id, locale);
  const text = wpText(pokemon, locale);
  const first = firstSentence(text.blurb, locale);
  return pageMetadata({
    title: t("result.metaTitle", { name }),
    description: t("result.metaDescription", {
      name,
      title: text.title,
      first,
    }),
    path: `${QUIZ_PATH}/${pokemon.slug}`,
    socialTitle: t("result.socialTitle", { name }),
    socialDescription: t("result.socialDescription", {
      title: text.title,
      first,
    }),
  });
}

export default async function WhichPokemonResultPage({ params }: PageProps) {
  const pokemon = pooledBySlug((await params).slug);
  if (!pokemon) notFound();
  const t = serverT(wp);
  const locale = getLocale();
  const species = speciesInfo(pokemon.id)!;
  const name = wpName(pokemon.id, locale);
  const text = wpText(pokemon, locale);
  const titleOf = (p: PooledPokemon) => wpText(p, locale).title;
  const accent = typeColor(species.types[0]);
  const own = matchProfile(pokemon.p, pokemon);
  const ld = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: t("result.ldName", { name }),
    description: text.blurb,
    isPartOf: { "@type": "WebSite", name: "PokéIQ" },
    about: { "@type": "Thing", name },
  };

  return (
    <ClientMessages namespaces={[resultNs, share]}>
      <WpLocalProvider local={wpLocal(locale)}>
        <div className="mx-auto max-w-3xl space-y-8">
          <BackButton href={QUIZ_PATH} label={t("result.back")} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />

          <header className="overflow-hidden rounded-lg border bg-card" data-testid="wp-hero">
            <div
              className="flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:text-left"
              style={{
                background: `radial-gradient(circle at 20% 0%, ${accent}33, transparent 60%)`,
              }}
            >
              <img src={artUrl(pokemon.id, 400)} alt={name} width={400} height={400} className="h-48 w-48 shrink-0 object-contain drop-shadow-[0_12px_24px_rgba(0,0,0,0.5)] sm:h-56 sm:w-56" />
              <div className="min-w-0 space-y-2">
                <p className="hud-label text-screen">{t("result.kicker")}</p>
                <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">
                  {t.rich("result.youAre", {
                    name,
                    c: (c) => <span style={{ color: accent }}>{c}</span>,
                  })}
                </h1>
                <p className="font-display text-lg uppercase tracking-wide text-muted-foreground">{text.title}</p>
                <TypeChips types={species.types} className="justify-center sm:justify-start" />
                <p className="hud-label">
                  {t.rich("result.dexLine", {
                    num: String(pokemon.id).padStart(4, "0"),
                    gen: species.gen,
                    link: (c) => (
                      <Link href={`/pokemon/${pokemon.slug}`} className="underline-offset-2 hover:text-foreground hover:underline">
                        {c}
                      </Link>
                    ),
                  })}
                </p>
              </div>
            </div>
            <div className="space-y-3 border-t border-foreground/[0.07] p-6">
              <p className="text-[17px] leading-relaxed" data-testid="wp-blurb">
                {text.blurb}
              </p>
              <p className="text-sm text-muted-foreground">
                {t.rich("result.why", {
                  name,
                  why: text.why,
                  b: (c) => <b className="text-foreground">{c}</b>,
                })}
              </p>
            </div>
          </header>

          <ResultView pokemon={pokemon} name={name} />

          <section className="space-y-3">
            <h2 className="font-display text-lg font-bold uppercase tracking-wide">{t("result.profile", { name })}</h2>
            <TraitBars a={pokemon.p} aLabel={name} testId="wp-profile" />
          </section>

          <section className="grid gap-3 text-sm sm:grid-cols-2">
            <Link href={`${QUIZ_PATH}/${own.partner.pokemon.slug}`} className="rounded-lg border bg-card p-4 transition-colors hover:border-screen/50">
              <span className="hud-label">{t("result.partner", { name })}</span>
              <span className="mt-1 block font-display text-base font-bold uppercase tracking-wide">{wpName(own.partner.pokemon.id, locale)}</span>
              <span className="text-muted-foreground">{titleOf(own.partner.pokemon)}</span>
            </Link>
            <Link href={`${QUIZ_PATH}/${own.rival.pokemon.slug}`} className="rounded-lg border bg-card p-4 transition-colors hover:border-screen/50">
              <span className="hud-label">{t("result.rival", { name })}</span>
              <span className="mt-1 block font-display text-base font-bold uppercase tracking-wide">{wpName(own.rival.pokemon.id, locale)}</span>
              <span className="text-muted-foreground">{titleOf(own.rival.pokemon)}</span>
            </Link>
          </section>
        </div>
      </WpLocalProvider>
    </ClientMessages>
  );
}
