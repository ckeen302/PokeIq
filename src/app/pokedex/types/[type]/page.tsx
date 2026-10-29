import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { SHARE_IMAGES, jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList, itemList } from "@/lib/structured-data";
import { TYPES, capitalize, type PokemonType } from "@/lib/pokemon/type-matrix";
import { isType, movesOfType, pokemonOfType, typeDescription, typeMatchups, typeTitle } from "@/lib/dex/type-pages";
import type { MoveRecord } from "@/lib/dex/build";
import { Section } from "@/components/pokedex/entry/Reveal";
import { TypeBadge } from "@/components/pokedex/TypeBadge";
import { DetailHero, DetailNav, SpeciesGrid, StatBox } from "@/components/pokedex/detail/DetailParts";

export const dynamicParams = false;

export function generateStaticParams() {
  return TYPES.map((type) => ({ type }));
}

interface PageProps {
  params: Promise<{ type: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = (await params).type;
  if (!isType(t)) return {};
  return pageMetadata({
    title: typeTitle(t),
    description: typeDescription(t),
    path: `/pokedex/types/${t}`,
    socialTitle: `${capitalize(t)} type · PokéIQ Pokédex`,
    image: SHARE_IMAGES.pokedex,
  });
}

function TypeLinks({ types, empty }: { types: PokemonType[]; empty: string }) {
  if (!types.length) return <span className="text-sm text-muted-foreground">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {types.map((t) => (
        <Link key={t} href={`/pokedex/types/${t}`} className="rounded-[4px] transition-transform hover:-translate-y-0.5">
          <TypeBadge type={t} />
        </Link>
      ))}
    </span>
  );
}

function MatchupRows({ rows }: { rows: { label: string; mult: string; types: PokemonType[]; empty: string }[] }) {
  return (
    <dl className="hud divide-y divide-foreground/10 rounded-lg border bg-card">
      {rows.map((r) => (
        <div key={r.label} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4">
          <dt className="flex shrink-0 items-center gap-2 sm:w-56">
            <span className="font-mono text-lg font-bold tabular-nums text-screen">{r.mult}</span>
            <span className="font-pixel text-[10px] uppercase tracking-wider text-muted-foreground">{r.label}</span>
          </dt>
          <dd>
            <TypeLinks types={r.types} empty={r.empty} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function MoveList({ moves }: { moves: MoveRecord[] }) {
  return (
    <ul className="hud divide-y divide-foreground/10 rounded-lg border bg-card">
      {moves.map((m) => (
        <li key={m.slug}>
          <Link href={`/pokedex/moves/${m.slug}`} className="group flex items-center gap-3 px-3 py-2.5">
            <span className="min-w-0 flex-1 truncate font-display font-bold uppercase tracking-wide group-hover:text-screen">{m.name}</span>
            <span className="hidden font-pixel text-[9px] uppercase tracking-wider text-muted-foreground sm:inline">{m.cls}</span>
            <span className="w-16 text-right font-mono text-sm tabular-nums">{m.power ?? "—"} <span className="text-[10px] text-muted-foreground">PWR</span></span>
            <span className="w-20 text-right font-mono text-sm tabular-nums">
              {m.learners.length} <span className="text-[10px] text-muted-foreground">MONS</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function TypePage({ params }: PageProps) {
  const t = (await params).type;
  if (!isType(t)) notFound();
  const name = capitalize(t);
  const m = typeMatchups(t);
  const { pure, dual } = pokemonOfType(t);
  const moves = movesOfType(t);
  const chip = (p: (typeof pure)[number]) => ({ id: p.id, slug: p.slug, name: p.name, types: p.types });

  const crumbs = breadcrumbList([
    { name: "Pokédex", path: "/pokedex" },
    { name: "Types", path: "/pokedex/types" },
    { name: `${name} type`, path: `/pokedex/types/${t}` },
  ]);
  const list = itemList(
    `${name}-type Pokémon`,
    [...pure, ...dual].map((p) => ({ name: p.name, path: `/pokemon/${p.slug}` }))
  );

  return (
    <article className="mx-auto max-w-6xl space-y-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(crumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(list) }} />
      <DetailNav tab="types" label="Type chart" />
      <DetailHero kicker={`Type · ${pure.length + dual.length} Pokémon`} title={`${name} type`}>
        <TypeBadge type={t} size="lg" />
        <p className="max-w-2xl text-foreground/90">{typeDescription(t)}</p>
      </DetailHero>

      <Section id="attacking" index={1} title={`${name} moves attacking`}>
        <MatchupRows
          rows={[
            { label: "Super effective vs", mult: "2×", types: m.superEffective, empty: "No type" },
            { label: "Not very effective vs", mult: "½×", types: m.notVeryEffective, empty: "No type" },
            { label: "No effect on", mult: "0×", types: m.noEffect, empty: "No type" },
          ]}
        />
      </Section>

      <Section id="defending" index={2} title={`${name} Pokémon defending`} subtitle="Single-typed">
        <MatchupRows
          rows={[
            { label: "Weak to", mult: "2×", types: m.weakTo, empty: "No type" },
            { label: "Resists", mult: "½×", types: m.resists, empty: "No type" },
            { label: "Immune to", mult: "0×", types: m.immuneTo, empty: "No type" },
          ]}
        />
        <p className="mt-3 text-[11px] text-muted-foreground">
          For a dual-typed Pokémon, multiply both types&apos; values — see the <Link href="/pokedex/types" className="underline underline-offset-2 hover:text-foreground">full type chart</Link>.
        </p>
      </Section>

      <Section id="moves" index={3} title={`${name} moves`} subtitle={`${moves.total} moves`}>
        <div className="mb-4 grid grid-cols-3 gap-3 sm:max-w-md">
          <StatBox label="Physical" value={moves.physical} />
          <StatBox label="Special" value={moves.special} />
          <StatBox label="Status" value={moves.status} />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {moves.strongest.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-pixel text-[10px] uppercase tracking-wider text-muted-foreground">Highest base power</h3>
              <MoveList moves={moves.strongest} />
            </div>
          )}
          {moves.common.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-pixel text-[10px] uppercase tracking-wider text-muted-foreground">Learned by the most Pokémon</h3>
              <MoveList moves={moves.common} />
            </div>
          )}
        </div>
      </Section>

      <Section id="pokemon" index={4} title={`${name}-type Pokémon`} subtitle={`${pure.length} pure · ${dual.length} dual`}>
        <div className="space-y-6">
          {pure.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-pixel text-[10px] uppercase tracking-wider text-muted-foreground">Pure {name} type · {pure.length}</h3>
              <SpeciesGrid list={pure.map(chip)} />
            </div>
          )}
          {dual.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-pixel text-[10px] uppercase tracking-wider text-muted-foreground">Part {name} type · {dual.length}</h3>
              <SpeciesGrid list={dual.map(chip)} />
            </div>
          )}
        </div>
      </Section>

      <nav aria-label="Other types" className="space-y-2">
        <h2 className="font-pixel text-[10px] uppercase tracking-wider text-muted-foreground">Other types</h2>
        <TypeLinks types={TYPES.filter((x) => x !== t)} empty="" />
      </nav>
    </article>
  );
}
