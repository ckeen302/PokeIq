import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { POKEDEX, artworkUrl, getPokemonBySlug } from "@/lib/pokemon/pokedex";
import { capitalize } from "@/lib/pokemon/type-matrix";
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
  const types = p.types.map(capitalize).join("/");
  return pageMetadata({
    title: `${p.name} Pokédex — Stats, Evolution, Moves & Weaknesses`,
    description: `${p.name} (#${p.id}) is a ${types}-type ${p.genus} from Gen ${p.gen}. Base stats, evolution, full moveset, abilities, type weaknesses and every Pokédex entry.`,
    path: `/pokemon/${p.slug}`,
    socialTitle: `${p.name} (#${p.id}) · PokéIQ Pokédex`,
  });
}

export default async function PokemonPage({ params }: PageProps) {
  const p = getPokemonBySlug((await params).slug);
  if (!p) notFound();
  const data = getDexEntry(p);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${p.name} — PokéIQ Pokédex`,
    about: { "@type": "Thing", name: p.name, description: p.flavor[0] },
    primaryImageOfPage: artworkUrl(p.id),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <DexEntry key={p.id} data={data} />
    </>
  );
}
