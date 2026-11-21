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
import { KIND_LABEL } from "@/lib/dex/video-games-types";
import { boardArtUrl } from "@/lib/pokemon/art";
import { typeColor } from "@/lib/pokemon/type-colors";
import { DetailNav } from "@/components/pokedex/detail/DetailParts";
import { Section } from "@/components/pokedex/entry/Reveal";
import { TypeBadge } from "@/components/pokedex/TypeBadge";
import { GameCover } from "@/components/pokedex/games/GameCover";
import { KindTag } from "@/components/pokedex/games/KindTag";

export const dynamicParams = false;

export function generateStaticParams() {
  return VIDEO_GAMES.map((g) => ({ slug: g.slug }));
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** "Pokémon X & Y (2013): …" — the summary, with where and when it first came out. */
function describe(g: VideoGame): string {
  return `${g.name} (${g.released.slice(0, 4)}, ${g.platforms.join(", ")}): ${g.summary}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const g = getVideoGame((await params).slug);
  if (!g) return {};
  // The preview picture is this segment's opengraph-image (the box art on the site's 1200 × 630 card).
  return pageMetadata({
    title: `${g.name} (${g.released.slice(0, 4)}) — ${KIND_LABEL[g.kind]} Pokémon game`,
    description: describe(g).slice(0, 300),
    path: `/pokedex/games/${g.slug}`,
    socialTitle: `${g.name} · PokéIQ Pokédex`,
    socialDescription: g.summary,
  });
}

const PAGER = [...VIDEO_GAMES].reverse();

export default async function GamePage({ params }: PageProps) {
  const g = getVideoGame((await params).slug);
  if (!g) notFound();
  const pager = pagerFor(PAGER, (x) => x.slug === g.slug, (x) => ({ href: `/pokedex/games/${x.slug}`, label: x.name }));
  const related = relatedGames(g);
  const facts: [string, string][] = [
    ["Released", `${formatRelease(g.released)}${g.firstIn ? ` (${g.firstIn}${g.releasedAs ? `, ${g.releasedAs}` : ""})` : g.releasedAs ? ` (${g.releasedAs})` : ""}`],
    ["Platform", g.platforms.join(", ")],
    ...(g.region ? [["Region", g.region] as [string, string]] : []),
    ...(g.developer ? [["Developer", g.developer] as [string, string]] : []),
  ];
  let idx = 0;

  return (
    <article className="mx-auto max-w-6xl space-y-10">
      <DetailNav href="/pokedex/games" label="All games" pager={pager} />

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
          <GameCover cover={g.cover} eager className="mx-auto max-w-[320px]" />
          <div className="min-w-0 space-y-3">
            <p className="hud-label text-screen">
              Generation {g.gen} · {KIND_LABEL[g.kind]}
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
                    <MapPin className="h-3.5 w-3.5" aria-hidden /> {g.placesRegion} in Places
                  </Link>
                )}
                {g.trainers && (
                  <Link
                    href={`/pokedex/trainers/${g.trainers}`}
                    data-testid="game-trainers-link"
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-sm border border-primary/40 px-3 py-1.5 font-pixel text-[10px] uppercase tracking-wider hover:bg-primary hover:text-primary-foreground max-md:text-xs"
                  >
                    <Users className="h-3.5 w-3.5" aria-hidden /> Trainer teams
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {g.whatsNew && (
        <Section id="new" index={++idx} title="What's new">
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
        <Section id="starters" index={++idx} title={g.starters.length === 1 ? "Starter" : "Starters"} subtitle={g.starters.length === 1 ? "Your first partner" : "Pick your first partner"}>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="game-starters">
            {g.starters.map((id) => (
              <li key={id}>
                <MonCard id={id} big />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {g.legendaries && (
        <Section id="legendaries" index={++idx} title="Legendary & Mythical Pokémon" subtitle={g.dlc ? "Found in the game and its DLC" : "Found in the game"}>
          <MonGrid ids={g.legendaries} testId="game-legendaries" />
        </Section>
      )}

      {g.exclusives && (
        <Section id="exclusives" index={++idx} title="Version exclusives" subtitle="Only found in one version">
          <div className="grid gap-4 md:grid-cols-2" data-testid="game-exclusives">
            {g.exclusives.map((col) => (
              <div key={col.version} className="space-y-2">
                <h3 className="hud-label">Only in {col.version}</h3>
                <MonGrid ids={col.ids} cols="half" />
              </div>
            ))}
          </div>
        </Section>
      )}

      {g.dlc && (
        <Section id="dlc" index={++idx} title="DLC & expansions">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="game-dlc">
            {g.dlc.map((d) => (
              <li key={d.name} className="rounded-lg border bg-card p-4">
                <p className="hud-label">{formatRelease(d.released)}</p>
                <h3 className="mt-1.5 font-display text-lg font-bold uppercase tracking-wide">{d.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{d.text}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {related.length > 0 && (
        <Section id="related" index={++idx} title="Related games">
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="game-related">
            {related.map(({ game: r, why }) => (
              <li key={r.slug}>
                <Link href={`/pokedex/games/${r.slug}`} data-testid="games-card" data-slug={r.slug} className="group flex h-full flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:border-screen/60">
                  <span className="block border-b border-foreground/5 bg-shade/30 px-1 py-2">
                    <GameCover cover={r.cover} />
                  </span>
                  <span className="flex flex-1 flex-col gap-1.5 p-2.5">
                    <span className="hud-label leading-snug">{why}</span>
                    <span className="font-display text-sm font-bold uppercase leading-tight tracking-wide group-hover:text-screen">{r.name}</span>
                    <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-0.5">
                      <KindTag kind={r.kind} />
                      <span className="text-xs text-muted-foreground">{r.released.slice(0, 4)}</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Release details from Wikipedia&apos;s{" "}
        <a href="https://en.wikipedia.org/wiki/List_of_Pok%C3%A9mon_video_games" className="underline-offset-2 hover:underline" rel="noopener" target="_blank">
          list of Pokémon video games
        </a>
        {g.exclusives || g.legendaries ? "; version exclusives and Legendary Pokémon from Serebii, checked against the Pokédex's own encounter data" : ""}. Box art and logos belong to their publishers.
      </p>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd([
            breadcrumbList([
              { name: "Pokédex", path: "/pokedex" },
              { name: "Games", path: "/pokedex/games" },
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
function MonCard({ id, big = false }: { id: number; big?: boolean }) {
  const s = species(id);
  if (!s) return null;
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
        <span className={`block font-display font-bold uppercase leading-tight tracking-wide group-hover:text-screen ${big ? "text-base" : "text-sm"}`}>{s.name}</span>
        <span className={`flex flex-wrap gap-1 ${big ? "justify-center" : ""}`}>
          {s.types.map((t) => (
            <TypeBadge key={t} type={t} size="sm" />
          ))}
        </span>
      </span>
    </Link>
  );
}

function MonGrid({ ids, cols = "full", testId }: { ids: number[]; cols?: "full" | "half"; testId?: string }) {
  return (
    <ul
      className={cols === "full" ? "grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" : "grid grid-cols-2 gap-2 lg:grid-cols-3"}
      data-testid={testId}
    >
      {ids.map((id) => (
        <li key={id}>
          <MonCard id={id} />
        </li>
      ))}
    </ul>
  );
}
