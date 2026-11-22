/* eslint-disable @next/next/no-img-element -- region maps and artwork are pre-sized static files */
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "@/components/ui/Link";
import { MapPin, Users } from "lucide-react";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList, videoGame } from "@/lib/structured-data";
import { species } from "@/lib/dex/data";
import { pagerFor } from "@/lib/dex/neighbours";
import { VIDEO_GAMES, formatRelease, getVideoGame, relatedGames, type VideoGame } from "@/lib/dex/video-games";
import { boardArtUrl } from "@/lib/pokemon/art";
import { typeColor } from "@/lib/pokemon/type-colors";
import { DetailNav } from "@/components/pokedex/detail/DetailParts";
import { Section } from "@/components/pokedex/entry/Reveal";
import { TypeBadge } from "@/components/pokedex/TypeBadge";
import { GameCover } from "@/components/pokedex/games/GameCover";
import { KindTag } from "@/components/pokedex/games/KindTag";
import { gameTexts, localPlatform, localRelease, localizeGame } from "@/lib/dex/video-games-i18n";
import { speciesName } from "@/lib/names/species";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { getLocale, serverT } from "@/i18n/server";
import type { Translator } from "@/i18n/catalog";
import dexGames from "@/messages/dex-games";

export const dynamicParams = false;

export function generateStaticParams() {
  return VIDEO_GAMES.map((g) => ({ slug: g.slug }));
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

type T = Translator<typeof dexGames.en>;

/** A list of names: "A, B" in English, the language's own separator elsewhere. */
const joinList = (t: T, items: string[]) => items.reduce((a, b) => t("game.list", { a, b }));

/** "Pokémon X & Y (2013): …" — the summary, with where and when it first came out. */
function describe(t: T, g: VideoGame): string {
  return t("game.describe", { name: g.name, year: g.released.slice(0, 4), platforms: joinList(t, g.platforms), summary: g.summary });
}

/** The game in the render's language, with that language's texts (null in English). */
async function load(slug: string) {
  const locale = getLocale();
  const tx = await gameTexts(locale);
  const en = getVideoGame(slug);
  return { locale, tx, en, g: en && localizeGame(en, tx) };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { g } = await load((await params).slug);
  if (!g) return {};
  const t = serverT(dexGames);
  // The preview picture is this segment's opengraph-image (the box art on the site's 1200 × 630 card).
  return pageMetadata({
    title: t("game.metaTitle", { name: g.name, year: g.released.slice(0, 4), kind: t(`kind.${g.kind}`) }),
    description: describe(t, g).slice(0, 300),
    path: `/pokedex/games/${g.slug}`,
    socialTitle: t("game.socialTitle", { name: g.name }),
    socialDescription: g.summary,
  });
}

const PAGER = [...VIDEO_GAMES].reverse();

/** "February 27, 1996 (Japan, as Pokémon Red and Green)": the first release, where, and under what name. */
function releasedFact(t: T, g: VideoGame, locale: Locale): string {
  const date = locale === DEFAULT_LOCALE ? formatRelease(g.released) : localRelease(g.released, locale);
  const note = g.firstIn ? (g.releasedAs ? t("game.list", { a: g.firstIn, b: g.releasedAs }) : g.firstIn) : g.releasedAs;
  return note ? t("game.releasedNote", { date, note }) : date;
}

export default async function GamePage({ params }: PageProps) {
  const { locale, tx, en, g } = await load((await params).slug);
  if (!en || !g) notFound();
  const t = serverT(dexGames);
  const local = (x: VideoGame) => localizeGame(x, tx);
  const release = (d: string) => (locale === DEFAULT_LOCALE ? formatRelease(d) : localRelease(d, locale));
  const pager = pagerFor(PAGER, (x) => x.slug === g.slug, (x) => ({ href: `/pokedex/games/${x.slug}`, label: local(x).name }));
  const related = relatedGames(en).map((r) => ({ ...r, game: local(r.game) }));
  const facts: [string, string][] = [
    [t("game.facts.released"), releasedFact(t, g, locale)],
    [t("game.facts.platform"), joinList(t, g.platforms)],
    ...(g.region ? [[t("game.facts.region"), g.region] as [string, string]] : []),
    ...(g.developer ? [[t("game.facts.developer"), g.developer] as [string, string]] : []),
  ];
  const why = (r: (typeof related)[number]) =>
    r.reason.kind === "region"
      ? t("game.why.region", { region: g.region ?? r.reason.region })
      : r.reason.kind === "platform"
        ? t("game.why.platform", { platform: localPlatform(tx, r.reason.platform) })
        : t(`game.why.${r.reason.kind}`);
  const credit = (chunks: React.ReactNode) => (
    <a href="https://en.wikipedia.org/wiki/List_of_Pok%C3%A9mon_video_games" className="underline-offset-2 hover:underline" rel="noopener" target="_blank">
      {chunks}
    </a>
  );
  let idx = 0;

  return (
    <article className="mx-auto max-w-6xl space-y-10">
      <DetailNav href="/pokedex/games" label={t("game.allGames")} pager={pager} />

      <header className="hud relative overflow-hidden rounded-lg border bg-card" data-testid="game-hero">
        {g.map && (
          <img
            src={`/geo/maps/${g.map}.webp`}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-[5px]"
          />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-card/95 via-card/75 to-card/40" aria-hidden />
        <div className="relative grid items-center gap-5 p-5 sm:p-6 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <GameCover cover={g.cover} eager className="mx-auto max-w-[320px]" tileAlt={g.cover.kind === "art" ? t("cover.tileAlt", { name: g.cover.alt }) : undefined} />
          <div className="min-w-0 space-y-3">
            <p className="hud-label text-screen">
              {t("game.kicker", { gen: g.gen, kind: t(`kind.${g.kind}`) })}
            </p>
            <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">{g.name}</h1>
            <p className="max-w-2xl text-foreground/90">{g.summary}</p>
            <dl className="grid gap-2 sm:grid-cols-2" data-testid="game-facts">
              {facts.map(([k, v]) => (
                <div key={k} className="rounded-md border border-foreground/10 bg-shade/30 px-3 py-2">
                  <dt className="font-pixel text-[9px] uppercase tracking-wider text-muted-foreground max-md:text-xs">{k}</dt>
                  <dd className="text-sm font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            {(g.placesRegion || g.trainers) && (
              <div className="flex flex-wrap gap-2 pt-1">
                {g.placesRegion && (
                  <Link
                    href={`/pokedex/places?region=${encodeURIComponent(g.placesRegion)}`}
                    data-testid="game-places-link"
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-sm border border-primary/40 px-3 py-1.5 font-pixel text-[10px] uppercase tracking-wider hover:bg-primary hover:text-primary-foreground max-md:text-xs"
                  >
                    <MapPin className="h-3.5 w-3.5" aria-hidden /> {t("game.placesLink", { region: g.placesRegion === en.region ? (g.region ?? g.placesRegion) : g.placesRegion })}
                  </Link>
                )}
                {g.trainers && (
                  <Link
                    href={`/pokedex/trainers/${g.trainers}`}
                    data-testid="game-trainers-link"
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-sm border border-primary/40 px-3 py-1.5 font-pixel text-[10px] uppercase tracking-wider hover:bg-primary hover:text-primary-foreground max-md:text-xs"
                  >
                    <Users className="h-3.5 w-3.5" aria-hidden /> {t("game.trainersLink")}
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {g.whatsNew && (
        <Section id="new" index={++idx} title={t("game.whatsNew")}>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="game-new">
            {g.whatsNew.map((n) => (
              <li key={n.title} className="rounded-lg border bg-card p-4">
                <h3 className="font-display text-base font-bold uppercase tracking-wide">{n.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{n.text}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {g.starters && (
        <Section id="starters" index={++idx} title={t(g.starters.length === 1 ? "game.starter" : "game.starters")} subtitle={t(g.starters.length === 1 ? "game.starterSub" : "game.startersSub")}>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="game-starters">
            {g.starters.map((id) => (
              <li key={id}>
                <MonCard id={id} locale={locale} big />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {g.legendaries && (
        <Section id="legendaries" index={++idx} title={t("game.legendaries")} subtitle={t(g.dlc ? "game.legendariesDlcSub" : "game.legendariesSub")}>
          <MonGrid ids={g.legendaries} locale={locale} testId="game-legendaries" />
        </Section>
      )}

      {g.exclusives && (
        <Section id="exclusives" index={++idx} title={t("game.exclusives")} subtitle={t("game.exclusivesSub")}>
          <div className="grid gap-4 md:grid-cols-2" data-testid="game-exclusives">
            {g.exclusives.map((col) => (
              <div key={col.version} className="space-y-2">
                <h3 className="hud-label">{t("game.onlyIn", { version: col.version })}</h3>
                <MonGrid ids={col.ids} locale={locale} cols="half" />
              </div>
            ))}
          </div>
        </Section>
      )}

      {g.dlc && (
        <Section id="dlc" index={++idx} title={t("game.dlc")}>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="game-dlc">
            {g.dlc.map((d) => (
              <li key={d.name} className="rounded-lg border bg-card p-4">
                <p className="hud-label">{release(d.released)}</p>
                <h3 className="mt-1.5 font-display text-lg font-bold uppercase tracking-wide">{d.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{d.text}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {related.length > 0 && (
        <Section id="related" index={++idx} title={t("game.related")}>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="game-related">
            {related.map((rel) => {
              const r = rel.game;
              return (
              <li key={r.slug}>
                <Link href={`/pokedex/games/${r.slug}`} data-testid="games-card" data-slug={r.slug} className="group flex h-full flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:border-screen/60">
                  <span className="block border-b border-foreground/5 bg-shade/30 px-1 py-2">
                    <GameCover cover={r.cover} tileAlt={r.cover.kind === "art" ? t("cover.tileAlt", { name: r.cover.alt }) : undefined} />
                  </span>
                  <span className="flex flex-1 flex-col gap-1.5 p-2.5">
                    <span className="hud-label leading-snug">{why(rel)}</span>
                    <span className="font-display text-sm font-bold uppercase leading-tight tracking-wide group-hover:text-screen">{r.name}</span>
                    <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-0.5">
                      <KindTag kind={r.kind} label={t(`kind.${r.kind}`)} />
                      <span className="text-xs text-muted-foreground">{r.released.slice(0, 4)}</span>
                    </span>
                  </span>
                </Link>
              </li>
              );
            })}
          </ul>
        </Section>
      )}

      <p className="text-center text-xs text-muted-foreground">
        {t.rich(g.exclusives || g.legendaries ? "game.creditSerebii" : "game.credit", { wiki: credit })}
      </p>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd([
            breadcrumbList([
              { name: t("ld.pokedex"), path: "/pokedex" },
              { name: t("ld.games"), path: "/pokedex/games" },
              { name: g.name, path: `/pokedex/games/${g.slug}` },
            ]),
            videoGame({
              name: g.name,
              path: `/pokedex/games/${g.slug}`,
              description: g.summary,
              image: g.cover.kind === "box" ? `/games/${g.cover.files[0]}` : undefined,
              datePublished: g.released,
              platforms: g.platforms,
              developer: g.developer,
            }),
          ]),
        }}
      />
    </article>
  );
}

/** A Pokémon that links to its Pokédex entry: artwork, name and types. */
function MonCard({ id, locale, big = false }: { id: number; locale: Locale; big?: boolean }) {
  const s = species(id);
  if (!s) return null;
  const name = speciesName(id, s.name, locale);
  return (
    <Link
      href={`/pokemon/${s.slug}`}
      data-testid="game-mon"
      className={`group flex h-full items-center overflow-hidden rounded-lg border bg-card transition-colors hover:border-screen/60 ${big ? "flex-col gap-2 p-3 text-center" : "gap-2 p-2"}`}
      style={{ backgroundImage: `linear-gradient(160deg, ${typeColor(s.types[0])}26, transparent 60%)` }}
    >
      <img
        src={boardArtUrl(id)}
        alt=""
        loading="lazy"
        decoding="async"
        width={big ? 112 : 48}
        height={big ? 112 : 48}
        className={big ? "h-24 w-24 object-contain sm:h-28 sm:w-28" : "h-12 w-12 shrink-0 object-contain"}
      />
      <span className={`min-w-0 space-y-1 ${big ? "flex flex-col items-center" : ""}`}>
        <span className={`block font-display font-bold uppercase leading-tight tracking-wide group-hover:text-screen ${big ? "text-base" : "text-sm"}`}>{name}</span>
        <span className={`flex flex-wrap gap-1 ${big ? "justify-center" : ""}`}>
          {s.types.map((t) => (
            <TypeBadge key={t} type={t} size="sm" />
          ))}
        </span>
      </span>
    </Link>
  );
}

function MonGrid({ ids, locale, cols = "full", testId }: { ids: number[]; locale: Locale; cols?: "full" | "half"; testId?: string }) {
  return (
    <ul
      className={cols === "full" ? "grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" : "grid grid-cols-2 gap-2 lg:grid-cols-3"}
      data-testid={testId}
    >
      {ids.map((id) => (
        <li key={id}>
          <MonCard id={id} locale={locale} />
        </li>
      ))}
    </ul>
  );
}
