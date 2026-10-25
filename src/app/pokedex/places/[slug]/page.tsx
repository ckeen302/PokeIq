/* eslint-disable @next/next/no-img-element -- PokéGuessr screenshots come from the shot proxy */
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { pageMetadata } from "@/lib/seo";
import { species } from "@/lib/dex/data";
import { PLACES, getPlace, gymsFor, placesIn, wildAt } from "@/lib/dex/places-data";
import { groupByGame } from "@/lib/dex/places";
import { VERSION_BY_KEY } from "@/lib/pokemon/encounter-types";
import { Section } from "@/components/pokedex/entry/Reveal";
import { Badges } from "@/components/pokedex/entry/EncountersSection";
import { TypeBadge } from "@/components/pokedex/TypeBadge";
import { DetailHero, DetailNav } from "@/components/pokedex/detail/DetailParts";

export const dynamicParams = false;

export function generateStaticParams() {
  return PLACES.map((p) => ({ slug: p.slug }));
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const p = getPlace((await params).slug);
  if (!p) return {};
  return pageMetadata({
    title: `${p.name} (${p.region}) — Pokémon ${p.type}`,
    description: `${p.name} in ${p.region}: the wild Pokémon found there in each game${p.games.length ? `, and how it looks in ${p.games.at(-1)}` : ""}.`,
    path: `/pokedex/places/${p.slug}`,
    socialTitle: `${p.name} · PokéIQ Pokédex`,
  });
}

export default async function PlacePage({ params }: PageProps) {
  const place = getPlace((await params).slug);
  if (!place) notFound();
  const wild = groupByGame(wildAt(place.key));
  const gyms = gymsFor(place);
  const inside = placesIn(place.region, place.name);
  const parent = place.parent ? PLACES.find((p) => p.region === place.region && p.name === place.parent && !p.parent) : undefined;
  let idx = 0;

  return (
    <article className="mx-auto max-w-6xl space-y-10">
      <DetailNav tab="places" label="All places" />
      <DetailHero kicker={`Place · ${place.type} · ${place.region}`} title={place.name}>
        <div className="space-y-3">
          {parent && (
            <p className="text-sm text-muted-foreground">
              Inside{" "}
              <Link href={`/pokedex/places/${parent.slug}`} className="font-semibold text-foreground hover:text-screen">
                {parent.name}
              </Link>
            </p>
          )}
          <Link
            href={`/atlas?q=${encodeURIComponent(place.parent ? `${place.parent} · ${place.region}` : place.key)}`}
            data-testid="place-atlas-link"
            className="inline-flex items-center gap-1.5 rounded-sm border border-primary/40 px-3 py-1.5 font-pixel text-[10px] uppercase tracking-wider hover:bg-primary hover:text-primary-foreground"
          >
            <MapPin className="h-3.5 w-3.5" /> View on World Atlas
          </Link>
        </div>
      </DetailHero>

      {place.shot && (
        <Section id="screenshot" index={++idx} title="Screenshot" subtitle={place.shot.game}>
          <figure className="hud overflow-hidden rounded-lg border bg-card">
            <img
              src={`/api/geo/shot/${place.shot.id}`}
              alt={`${place.name} in Pokémon ${place.shot.game}`}
              data-testid="place-shot"
              loading="lazy"
              className="block aspect-[16/9] w-full bg-shade/40 object-cover"
            />
            <figcaption className="px-3 py-2 text-xs text-muted-foreground">
              {place.name} in {place.shot.game} · from PokéGuessr
            </figcaption>
          </figure>
        </Section>
      )}

      {place.games.length > 0 && (
        <Section id="games" index={++idx} title="Games" subtitle="Games it appears in">
          <div className="flex flex-wrap gap-1.5">
            {place.games.map((g) => (
              <span key={g} className="rounded-sm border border-primary bg-primary px-2.5 py-1.5 font-pixel text-[10px] uppercase tracking-wider text-primary-foreground">
                {g}
              </span>
            ))}
          </div>
        </Section>
      )}

      {gyms.length > 0 && (
        <Section id="gym" index={++idx} title="Gym" subtitle={`${gyms.length} leader${gyms.length > 1 ? "s" : ""}`}>
          <div className="grid gap-3 sm:grid-cols-2" data-testid="place-gyms">
            {gyms.map((g) => (
              <div key={`${g.game}-${g.leader}`} className="hud space-y-1.5 rounded-lg border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-lg font-bold uppercase tracking-wide">{g.leader}</span>
                  {g.type && <TypeBadge type={g.type.toLowerCase()} size="sm" />}
                </div>
                {g.badge && <div className="text-sm">{g.badge}</div>}
                <div className="text-xs text-muted-foreground">
                  {g.game} ·{" "}
                  <a href={g.source} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
                    source
                  </a>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {wild.length > 0 && (
        <Section id="wild" index={++idx} title="Wild Pokémon" subtitle="By game">
          <div className="space-y-4">
            {wild.map((g) => {
              const timed = g.rows.some((r) => r.t);
              const showLv = g.rows.some((r) => r.lv);
              const showRate = g.rows.some((r) => r.r || r.t);
              return (
                <div key={g.versions.join()} className="hud overflow-x-auto rounded-lg border bg-card p-2" data-hscroll data-testid="place-wild-game">
                  <h3 className="flex flex-wrap items-center gap-2 p-2 font-pixel text-[10px] uppercase tracking-wider text-muted-foreground">
                    <Badges versions={g.versions} />
                    {g.versions.map((v) => VERSION_BY_KEY[v]?.name ?? v).join(" / ")}
                  </h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="p-2">Pokémon</th>
                        <th className="p-2">Method</th>
                        {showLv && <th className="p-2">Levels</th>}
                        {showRate &&
                          (timed ? (
                            <>
                              <th className="p-2 text-center">Morning</th>
                              <th className="p-2 text-center">Day</th>
                              <th className="p-2 text-center">Night</th>
                            </>
                          ) : (
                            <th className="p-2 text-right">Rate</th>
                          ))}
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r, i) => {
                        const s = species(r.id);
                        return (
                          <tr key={i} className="border-b border-foreground/5 align-top" data-testid="place-wild-row">
                            <td className="p-2 font-semibold">
                              {s ? (
                                <Link href={`/pokemon/${s.slug}`} className="hover:text-screen">
                                  {s.name}
                                </Link>
                              ) : (
                                `#${r.id}`
                              )}
                              {r.n && <div className="text-[11px] font-normal text-muted-foreground">{r.n}</div>}
                            </td>
                            <td className="p-2">{r.m ?? "—"}</td>
                            {showLv && <td className="p-2 font-mono text-xs tabular-nums">{r.lv ?? "—"}</td>}
                            {showRate &&
                              (timed ? (
                                r.t ? (
                                  r.t.map((v, k) => (
                                    <td key={k} className="p-2 text-center font-mono text-xs tabular-nums">
                                      {v}
                                    </td>
                                  ))
                                ) : (
                                  <td colSpan={3} className="p-2 text-center font-mono text-xs tabular-nums">
                                    {r.r ?? "—"}
                                  </td>
                                )
                              ) : (
                                <td className="p-2 text-right font-mono text-xs tabular-nums">{r.r ?? "—"}</td>
                              ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {inside.length > 0 && (
        <Section id="inside" index={++idx} title="Inside" subtitle={`${inside.length} building${inside.length > 1 ? "s" : ""} and landmarks`}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
            {inside.map((p) => (
              <Link key={p.slug} href={`/pokedex/places/${p.slug}`} className="rounded-lg border bg-card p-3 hover:border-screen/60">
                <span className="block font-display text-sm font-bold uppercase tracking-wide">{p.name}</span>
                <span className="block font-pixel text-[9px] uppercase tracking-wider text-muted-foreground">{p.type}</span>
              </Link>
            ))}
          </div>
        </Section>
      )}
    </article>
  );
}
