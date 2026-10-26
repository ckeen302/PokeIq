import { BackButton } from "@/components/ui/BackButton";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { dexBreadcrumbs, dexDescription, dexSummary, dexTitle } from "@/lib/pokemon/dex-seo";
import { POKEDEX, artworkUrl, getPokemonBySlug } from "@/lib/pokemon/pokedex";
import { getDexEntry } from "@/lib/pokemon/details";
import { DexEntry } from "@/components/pokedex/entry/DexEntry";

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
  return pageMetadata({
    title: dexTitle(p),
    description: dexDescription(p),
    path: `/pokemon/${p.slug}`,
    socialTitle: `${p.name} (#${p.id}) · PokéIQ Pokédex`,
  });
}

export default async function PokemonPage({ params }: PageProps) {
  const p = getPokemonBySlug((await params).slug);
  if (!p) notFound();
  const data = getDexEntry(p);

  const pageLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${p.name} — PokéIQ Pokédex`,
    about: { "@type": "Thing", name: p.name, description: p.flavor[0] },
    primaryImageOfPage: artworkUrl(p.id),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(pageLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(dexBreadcrumbs(p)) }} />
      <BackButton href="/pokedex" label="Back to Pokédex" className="mb-4" />
      <DexEntry key={p.id} data={data} />
      <section className="mx-auto mt-10 max-w-3xl space-y-3 text-sm text-muted-foreground" aria-label={`About ${p.name}`}>
        <h2 className="font-display text-base font-bold uppercase tracking-wider text-foreground">{p.name} summary</h2>
        <p>{dexSummary(p)}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/quiz/whos-that-pokemon" className="underline-offset-2 hover:text-foreground hover:underline">Who&apos;s That Pokémon quiz</Link>
          <Link href="/battle/teams" className="underline-offset-2 hover:text-foreground hover:underline">Pokémon team builder</Link>
          <Link href="/battle/calc" className="underline-offset-2 hover:text-foreground hover:underline">Pokémon damage calculator</Link>
          <Link href="/pokedex" className="underline-offset-2 hover:text-foreground hover:underline">Full Pokédex</Link>
        </p>
      </section>
    </>
  );
}
