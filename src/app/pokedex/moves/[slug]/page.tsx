import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { MOVES, getMove, species } from "@/lib/dex/data";
import { capitalize } from "@/lib/pokemon/type-matrix";
import { Section } from "@/components/pokedex/entry/Reveal";
import { TypeBadge } from "@/components/pokedex/TypeBadge";
import { DetailHero, DetailNav, SpeciesGrid, StatBox } from "@/components/pokedex/detail/DetailParts";

export const dynamicParams = false;

export function generateStaticParams() {
  return MOVES.map((m) => ({ slug: m.slug }));
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const m = getMove((await params).slug);
  if (!m) return {};
  return pageMetadata({
    title: `${m.name} — Pokémon Move`,
    description: `${m.name} is a ${capitalize(m.type)}-type ${m.cls} move. ${m.effect} See its power, accuracy, PP and every Pokémon that learns it.`,
    path: `/pokedex/moves/${m.slug}`,
    socialTitle: `${m.name} · PokéIQ Pokédex`,
  });
}

export default async function MovePage({ params }: PageProps) {
  const m = getMove((await params).slug);
  if (!m) notFound();
  const learners = m.learners.flatMap((l) => {
    const s = species(l.id);
    return s ? [{ ...s, note: l.how.slice(0, 3).join(" · ") }] : [];
  });

  return (
    <article className="mx-auto max-w-6xl space-y-10">
      <DetailNav tab="moves" label="Back to all moves" />
      <DetailHero kicker={`Move · Gen ${m.gen}`} title={m.name}>
        <div className="flex flex-wrap items-center gap-2">
          <TypeBadge type={m.type} size="lg" />
          <span className="rounded-[4px] border border-foreground/10 bg-shade/30 px-3 py-1.5 font-display text-sm font-bold uppercase tracking-wider">{m.cls}</span>
        </div>
        <p className="max-w-2xl text-foreground/90">{m.effect || "No additional effect."}</p>
      </DetailHero>

      <Section id="stats" index={1} title="Move data">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatBox label="Power" value={m.power ?? "—"} />
          <StatBox label="Accuracy" value={m.accuracy ?? "—"} />
          <StatBox label="PP" value={m.pp ?? "—"} />
          <StatBox label="Priority" value={m.priority > 0 ? `+${m.priority}` : m.priority} />
        </div>
      </Section>

      <Section id="learners" index={2} title="Learned by" subtitle={`${learners.length} Pokémon`}>
        {learners.length ? (
          <>
            <SpeciesGrid list={learners} />
            <p className="mt-3 text-[11px] text-muted-foreground">Learnsets from each Pokémon&apos;s most recent main-series game in the Pokédex.</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No Pokémon learn this move in the games covered by the Pokédex.</p>
        )}
      </Section>
    </article>
  );
}
