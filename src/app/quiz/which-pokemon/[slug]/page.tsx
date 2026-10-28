/* eslint-disable @next/next/no-img-element -- artwork comes pre-sized from /api/art */
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BackButton } from "@/components/ui/BackButton";
import { ResultView } from "@/components/which-pokemon/ResultView";
import { TraitBars, TypeChips } from "@/components/which-pokemon/parts";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { artUrl } from "@/lib/pokemon/art";
import { typeColor } from "@/lib/pokemon/type-colors";
import { POOL, pooledBySlug, speciesInfo } from "@/lib/which-pokemon/pool";
import { QUIZ_PATH, matchProfile, nameOf } from "@/lib/which-pokemon/match";

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
  const name = nameOf(pokemon);
  const first = pokemon.blurb.split(/(?<=\.)\s/)[0];
  return pageMetadata({
    title: `I Got ${name}! Which Pokémon Are You?`,
    description: `${name}, ${pokemon.title}: ${first} Take the 18-question Pokémon personality quiz and find your own match from 200 Pokémon.`,
    path: `${QUIZ_PATH}/${pokemon.slug}`,
    socialTitle: `I'm ${name}! Which Pokémon are you?`,
    socialDescription: `${pokemon.title}. ${first}`,
  });
}

export default async function WhichPokemonResultPage({ params }: PageProps) {
  const pokemon = pooledBySlug((await params).slug);
  if (!pokemon) notFound();
  const species = speciesInfo(pokemon.id)!;
  const name = species.name;
  const accent = typeColor(species.types[0]);
  const own = matchProfile(pokemon.p, pokemon);
  const ld = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `I got ${name}: Which Pokémon Are You?`,
    description: pokemon.blurb,
    isPartOf: { "@type": "WebSite", name: "PokéIQ" },
    about: { "@type": "Thing", name },
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <BackButton href={QUIZ_PATH} label="Which Pokémon Are You?" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />

      <header className="overflow-hidden rounded-lg border bg-card" data-testid="wp-hero">
        <div className="flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:text-left" style={{ background: `radial-gradient(circle at 20% 0%, ${accent}33, transparent 60%)` }}>
          <img src={artUrl(pokemon.id, 400)} alt={name} width={400} height={400} className="h-48 w-48 shrink-0 object-contain drop-shadow-[0_12px_24px_rgba(0,0,0,0.5)] sm:h-56 sm:w-56" />
          <div className="min-w-0 space-y-2">
            <p className="hud-label text-screen">Which Pokémon are you?</p>
            <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">
              You&apos;re <span style={{ color: accent }}>{name}</span>
            </h1>
            <p className="font-display text-lg uppercase tracking-wide text-muted-foreground">{pokemon.title}</p>
            <TypeChips types={species.types} className="justify-center sm:justify-start" />
            <p className="hud-label">
              #{String(pokemon.id).padStart(4, "0")} · Gen {species.gen} ·{" "}
              <Link href={`/pokemon/${pokemon.slug}`} className="underline-offset-2 hover:text-foreground hover:underline">
                Pokédex entry
              </Link>
            </p>
          </div>
        </div>
        <div className="space-y-3 border-t border-foreground/[0.07] p-6">
          <p className="text-[17px] leading-relaxed" data-testid="wp-blurb">
            {pokemon.blurb}
          </p>
          <p className="text-sm text-muted-foreground">
            <b className="text-foreground">Why {name}:</b> {pokemon.why}
          </p>
        </div>
      </header>

      <ResultView pokemon={pokemon} name={name} />

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide">{name}&apos;s profile</h2>
        <TraitBars a={pokemon.p} aLabel={name} testId="wp-profile" />
      </section>

      <section className="grid gap-3 text-sm sm:grid-cols-2">
        <Link href={`${QUIZ_PATH}/${own.partner.pokemon.slug}`} className="rounded-lg border bg-card p-4 transition-colors hover:border-screen/50">
          <span className="hud-label">{name}&apos;s natural partner</span>
          <span className="mt-1 block font-display text-base font-bold uppercase tracking-wide">{nameOf(own.partner.pokemon)}</span>
          <span className="text-muted-foreground">{own.partner.pokemon.title}</span>
        </Link>
        <Link href={`${QUIZ_PATH}/${own.rival.pokemon.slug}`} className="rounded-lg border bg-card p-4 transition-colors hover:border-screen/50">
          <span className="hud-label">{name}&apos;s rival</span>
          <span className="mt-1 block font-display text-base font-bold uppercase tracking-wide">{nameOf(own.rival.pokemon)}</span>
          <span className="text-muted-foreground">{own.rival.pokemon.title}</span>
        </Link>
      </section>

      <p className="text-xs text-muted-foreground">
        How it works: 18 in-world statements rated from &ldquo;Not me at all&rdquo; to &ldquo;Totally me&rdquo; score seven traits (the Big Five plus competitiveness and
        independence). Your scores are matched to 200 Pokémon profiles built from Pokédex entries across the games, Mystery Dungeon, Pokémon Sleep and Legends behaviour
        and the anime, weighting the traits you&apos;re most extreme on. Everything runs in your browser; your result lives in the link.
      </p>
    </div>
  );
}
