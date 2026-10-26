import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { ABILITIES, getAbility, species } from "@/lib/dex/data";
import { Section } from "@/components/pokedex/entry/Reveal";
import { DetailHero, DetailNav, SpeciesGrid } from "@/components/pokedex/detail/DetailParts";

export const dynamicParams = false;

export function generateStaticParams() {
  return ABILITIES.map((a) => ({ slug: a.slug }));
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const a = getAbility((await params).slug);
  if (!a) return {};
  return pageMetadata({
    title: `${a.name} — Pokémon Ability`,
    description: `${a.effect} See every Pokémon with ${a.name} as a normal or hidden ability.`,
    path: `/pokedex/abilities/${a.slug}`,
    socialTitle: `${a.name} · PokéIQ Pokédex`,
  });
}

export default async function AbilityPage({ params }: PageProps) {
  const a = getAbility((await params).slug);
  if (!a) notFound();
  const chips = (hidden: boolean) =>
    a.holders.filter((h) => h.hidden === hidden).flatMap((h) => {
      const s = species(h.id);
      return s ? [s] : [];
    });
  const normal = chips(false);
  const hidden = chips(true);

  return (
    <article className="mx-auto max-w-6xl space-y-10">
      <DetailNav tab="abilities" label="Back to all abilities" />
      <DetailHero kicker="Ability" title={a.name}>
        <p className="max-w-2xl text-foreground/90">{a.effect || "No effect description available."}</p>
      </DetailHero>

      {normal.length > 0 && (
        <Section id="normal" index={1} title="Pokémon with this ability" subtitle={`${normal.length} Pokémon`}>
          <SpeciesGrid list={normal} />
        </Section>
      )}
      {hidden.length > 0 && (
        <Section id="hidden" index={normal.length > 0 ? 2 : 1} title="Hidden ability of" subtitle={`${hidden.length} Pokémon`}>
          <SpeciesGrid list={hidden} />
        </Section>
      )}
    </article>
  );
}
