/* eslint-disable @next/next/no-img-element -- item sprites are tiny remote PNGs */
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { ITEMS, getItem, moveFromApiSlug, speciesBySlug } from "@/lib/dex/data";
import { itemSpriteUrl, versionGroupLabel, versionLabel } from "@/lib/dex/build";
import { Section } from "@/components/pokedex/entry/Reveal";
import { TypeBadge } from "@/components/pokedex/TypeBadge";
import { DetailHero, DetailNav } from "@/components/pokedex/detail/DetailParts";

export const dynamicParams = false;

export function generateStaticParams() {
  return ITEMS.map((i) => ({ slug: i.slug }));
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const i = getItem((await params).slug);
  if (!i) return {};
  return pageMetadata({
    title: `${i.name} — Pokémon Item`,
    description: `${i.name} (${i.category}): ${i.effect} See which wild Pokémon hold it and which games it appears in.`,
    path: `/pokedex/items/${i.slug}`,
    socialTitle: `${i.name} · PokéIQ Pokédex`,
  });
}

export default async function ItemPage({ params }: PageProps) {
  const item = getItem((await params).slug);
  if (!item) notFound();
  const held = item.held.flatMap(([slug, rarity]) => {
    const s = speciesBySlug(slug);
    return s ? [{ s, rarity }] : [];
  });
  const byGen = new Map<number, [string, string][]>();
  for (const [gen, vg, move] of item.machines) {
    const list = byGen.get(gen) ?? [];
    list.push([vg, move]);
    byGen.set(gen, list);
  }
  let idx = 0;

  return (
    <article className="mx-auto max-w-6xl space-y-10">
      <DetailNav tab="items" label="Back to all items" />
      <DetailHero
        kicker={`Item · ${item.category}`}
        title={item.name}
        media={
          <span className="screen flex h-24 w-24 shrink-0 items-center justify-center rounded-md">
            <img src={itemSpriteUrl(item.slug)} alt={`${item.name} sprite`} width={64} height={64} data-testid="item-sprite" className="relative z-[1] h-16 w-16 object-contain [image-rendering:pixelated]" />
          </span>
        }
      >
        <p className="max-w-2xl text-foreground/90">{item.effect || "No effect description available."}</p>
      </DetailHero>

      <Section id="games" index={++idx} title="Games" subtitle="Generations it appears in">
        <div className="flex flex-wrap gap-1.5">
          {item.gens.map((g) => (
            <span key={g} className="rounded-sm border border-primary bg-primary px-2.5 py-1.5 font-pixel text-[10px] uppercase tracking-wider text-primary-foreground">
              Gen {g}
            </span>
          ))}
        </div>
      </Section>

      {byGen.size > 0 && (
        <Section id="teaches" index={++idx} title="Teaches" subtitle="By generation">
          <div className="hud space-y-4 rounded-lg border bg-card p-4">
            {[...byGen.entries()].map(([gen, rows]) => (
              <div key={gen} className="space-y-2">
                <h3 className="font-pixel text-[10px] uppercase tracking-wider text-muted-foreground">Gen {gen}</h3>
                <ul className="divide-y divide-foreground/5 text-sm">
                  {rows.map(([vg, move]) => {
                    const m = moveFromApiSlug(move);
                    return (
                      <li key={vg} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                        <span className="text-muted-foreground">{versionGroupLabel(vg)}</span>
                        <span className="flex items-center gap-2 font-semibold">
                          {m ? (
                            <>
                              <TypeBadge type={m.type} size="sm" />
                              <Link href={`/pokedex/moves/${m.slug}`} className="hover:text-screen">{m.name}</Link>
                            </>
                          ) : (
                            move
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      {held.length > 0 && (
        <Section id="held" index={++idx} title="Held by wild Pokémon" subtitle={`${held.length} Pokémon`}>
          <div className="hud overflow-x-auto rounded-lg border bg-card p-2" data-hscroll>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="p-2">Pokémon</th>
                  <th className="p-2">Chance · games</th>
                </tr>
              </thead>
              <tbody>
                {held.map(({ s, rarity }) => (
                  <tr key={s.id} className="border-b border-foreground/5 align-top" data-testid="item-holder">
                    <td className="p-2 font-semibold">
                      <Link href={`/pokemon/${s.slug}`} className="hover:text-screen">{s.name}</Link>
                    </td>
                    <td className="space-y-0.5 p-2 text-xs text-muted-foreground">
                      {rarity.map(([pct, versions]) => (
                        <div key={pct}>
                          <span className="font-mono text-foreground">{pct}%</span> · {versions.map(versionLabel).join(", ")}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </article>
  );
}
