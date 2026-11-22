/* eslint-disable @next/next/no-img-element -- PokéGuessr screenshots come from the shot proxy */
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "@/components/ui/Link";
import { MapPin } from "lucide-react";
import { SHARE_IMAGES, jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList } from "@/lib/structured-data";
import { species } from "@/lib/dex/data";
import { PLACES, getPlace, gymsFor, placesIn, wildAt } from "@/lib/dex/places-data";
import { groupByGame } from "@/lib/dex/places";
import { VERSION_BY_KEY } from "@/lib/pokemon/encounter-types";
import { Section } from "@/components/pokedex/entry/Reveal";
import { Badges } from "@/components/pokedex/entry/EncountersSection";
import { TypeBadge } from "@/components/pokedex/TypeBadge";
import { DetailHero, DetailNav } from "@/components/pokedex/detail/DetailParts";
import { pagerFor, placeLabel } from "@/lib/dex/neighbours";
import { dexNames, type DexNames } from "@/lib/dex/local-names";
import { nameKey } from "@/lib/geo-i18n";
import { serverT } from "@/i18n/server";
import type { Translator } from "@/i18n/catalog";
import placesNs from "@/messages/places";

export const dynamicParams = false;

export function generateStaticParams() {
  return PLACES.map((p) => ({ slug: p.slug }));
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

type PlacesT = Translator<typeof placesNs.en>;

const ROMAN_GEN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9 };

/** A game in the Games list: a PokéGuessr family ("FireRed / LeafGreen"), a version, or "Generation IV games". */
function gameName(t: PlacesT, names: DexNames, label: string): string {
  if (t.locale === "en") return label;
  const gen = /^Generation ([IVX]+) games$/.exec(label);
  if (gen) return t("games.generation", { gen: t.locale === "ja" ? String(ROMAN_GEN[gen[1]] ?? gen[1]) : gen[1] });
  return names.game(label);
}

/** An encounter method in the page's language: the site's own wording, else the move or item it names, else as given. */
function methodName(t: PlacesT, names: DexNames, m: string): string {
  if (t.locale === "en") return m;
  const key = `methods.${nameKey(m)}`;
  if (t.has(key)) return t(key as `methods.${keyof typeof placesNs.en.methods}`);
  for (const local of [names.item(m), names.move(m), names.game(m)]) if (local !== m) return local;
  return m;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const p = getPlace((await params).slug);
  if (!p) return {};
  const t = serverT(placesNs);
  const names = dexNames();
  const name = names.place(p.name);
  const region = names.region(p.region);
  const last = p.games.at(-1);
  return pageMetadata({
    title: t("meta.placeTitle", { name, region, type: t(`types.${p.type}`) }),
    description: last ? t("meta.placeDescriptionGame", { name, region, game: gameName(t, names, last) }) : t("meta.placeDescription", { name, region }),
    path: `/pokedex/places/${p.slug}`,
    image: SHARE_IMAGES.pokedex,
    socialTitle: t("meta.socialTitle", { name }),
  });
}

export default async function PlacePage({ params }: PageProps) {
  const place = getPlace((await params).slug);
  if (!place) notFound();
  const t = serverT(placesNs);
  const names = dexNames();
  const en = t.locale === "en";
  const name = names.place(place.name);
  const region = names.region(place.region);
  const wild = groupByGame(wildAt(place.key));
  const gyms = gymsFor(place);
  const inside = placesIn(place.region, place.name);
  const parent = place.parent ? PLACES.find((p) => p.region === place.region && p.name === place.parent && !p.parent) : undefined;
  const pager = pagerFor(PLACES, (x) => x.slug === place.slug, (x) => ({ href: `/pokedex/places/${x.slug}`, label: en ? placeLabel(x, place) : x.region === place.region ? names.place(x.name) : `${names.place(x.name)} · ${names.region(x.region)}` }));
  let idx = 0;

  return (
    <article className="mx-auto max-w-6xl space-y-10">
      <DetailNav tab="places" label={t("back")} pager={pager} />
      <DetailHero kicker={t("kicker", { type: t(`types.${place.type}`), region })} title={name}>
        <div className="space-y-3">
          {parent && (
            <p className="text-sm text-muted-foreground">
              {t.rich("inside", {
                name: names.place(parent.name),
                link: (chunks) => (
                  <Link href={`/pokedex/places/${parent.slug}`} className="font-semibold text-foreground hover:text-screen">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          )}
          {place.atlas ? (
            <Link
              href={`/atlas?q=${encodeURIComponent(place.parent ? `${place.parent} · ${place.region}` : place.key)}`}
              data-testid="place-atlas-link"
              className="inline-flex items-center gap-1.5 rounded-sm border border-primary/40 px-3 py-1.5 font-pixel text-[10px] uppercase tracking-wider hover:bg-primary hover:text-primary-foreground"
            >
              <MapPin className="h-3.5 w-3.5" /> {t("atlas")}
            </Link>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="place-no-map">
              {t("noAtlas")}
            </p>
          )}
        </div>
      </DetailHero>

      {place.shot && (
        <Section id="screenshot" index={++idx} title={t("shot.title")} subtitle={names.game(place.shot.game)}>
          <figure className="hud overflow-hidden rounded-lg border bg-card">
            <img
              src={place.shot.preview}
              alt={t("shot.alt", { place: name, game: names.game(place.shot.game) })}
              data-testid="place-shot"
              loading="lazy"
              className="block aspect-[16/9] w-full bg-shade/40 object-cover"
            />
            <figcaption className="px-3 py-2 text-xs text-muted-foreground">
              {t("shot.caption", { place: name, game: names.game(place.shot.game) })}
            </figcaption>
          </figure>
        </Section>
      )}

      {place.games.length > 0 && (
        <Section id="games" index={++idx} title={t("games.title")} subtitle={t("games.subtitle")}>
          <div className="flex flex-wrap gap-1.5">
            {place.games.map((g) => (
              <span key={g} className="rounded-sm border border-primary bg-primary px-2.5 py-1.5 font-pixel text-[10px] uppercase tracking-wider text-primary-foreground">
                {gameName(t, names, g)}
              </span>
            ))}
          </div>
        </Section>
      )}

      {place.sections.length > 0 && (
        <Section id="areas" index={++idx} title={t("areas.title")} subtitle={t("areas.subtitle", { n: place.sections.length })}>
          <ul className="flex flex-wrap gap-1.5" data-testid="place-areas">
            {place.sections.map((s) => (
              <li key={s} className="rounded-sm border px-2.5 py-1.5 text-xs">
                {s}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {gyms.length > 0 && (
        <Section id="gym" index={++idx} title={t("gym.title")} subtitle={t("gym.subtitle", { n: gyms.length })}>
          <div className="grid gap-3 sm:grid-cols-2" data-testid="place-gyms">
            {gyms.map((g) => (
              <div key={`${g.game}-${g.leader}`} className="hud space-y-1.5 rounded-lg border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-lg font-bold uppercase tracking-wide">{g.leader}</span>
                  {g.type && <TypeBadge type={g.type.toLowerCase()} size="sm" label={names.locale === "en" ? undefined : names.type(g.type)} />}
                </div>
                {g.badge && <div className="text-sm">{g.badge}</div>}
                <div className="text-xs text-muted-foreground">
                  {names.gameList(g.game)} ·{" "}
                  <a href={g.source} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
                    {t("gym.source")}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {wild.length > 0 && (
        <Section id="wild" index={++idx} title={t("wild.title")} subtitle={t("wild.subtitle")}>
          <div className="space-y-4">
            {wild.map((g) => {
              const timed = g.rows.some((r) => r.t);
              const showLv = g.rows.some((r) => r.lv);
              const showRate = g.rows.some((r) => r.r || r.t);
              return (
                <div key={g.versions.join()} className="hud overflow-x-auto rounded-lg border bg-card p-2" data-hscroll data-testid="place-wild-game">
                  <h3 className="flex flex-wrap items-center gap-2 p-2 font-pixel text-[10px] uppercase tracking-wider text-muted-foreground">
                    <Badges versions={g.versions} />
                    {g.versions.map((v) => (en ? (VERSION_BY_KEY[v]?.name ?? v) : names.version(v))).join(" / ")}
                  </h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="p-2">{t("wild.pokemon")}</th>
                        <th className="p-2">{t("wild.method")}</th>
                        {showLv && <th className="p-2">{t("wild.levels")}</th>}
                        {showRate &&
                          (timed ? (
                            <>
                              <th className="p-2 text-center">{t("wild.morning")}</th>
                              <th className="p-2 text-center">{t("wild.day")}</th>
                              <th className="p-2 text-center">{t("wild.night")}</th>
                            </>
                          ) : (
                            <th className="p-2 text-right">{t("wild.rate")}</th>
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
                                  {names.species(s.id, s.name)}
                                </Link>
                              ) : (
                                `#${r.id}`
                              )}
                              {r.n && <div className="text-[11px] font-normal text-muted-foreground">{r.n}</div>}
                            </td>
                            <td className="p-2">{r.m ? methodName(t, names, r.m) : "—"}</td>
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
        <Section id="inside" index={++idx} title={t("insidePlaces.title")} subtitle={t("insidePlaces.subtitle", { n: inside.length })}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
            {inside.map((p) => (
              <Link key={p.slug} href={`/pokedex/places/${p.slug}`} className="rounded-lg border bg-card p-3 hover:border-screen/60">
                <span className="block font-display text-sm font-bold uppercase tracking-wide">{names.place(p.name)}</span>
                <span className="block font-pixel text-[9px] uppercase tracking-wider text-muted-foreground">{t(`types.${p.type}`)}</span>
              </Link>
            ))}
          </div>
        </Section>
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList([{ name: t("crumbs.pokedex"), path: "/pokedex" }, { name: t("crumbs.places"), path: "/pokedex/places" }, { name, path: `/pokedex/places/${place.slug}` }])) }} />
    </article>
  );
}
