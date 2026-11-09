/* eslint-disable @next/next/no-img-element -- thumbnails are pre-sized static files (public/art/160) */
import type { Metadata } from "next";
import Link from "@/components/ui/Link";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList, itemList } from "@/lib/structured-data";
import { boardArtUrl } from "@/lib/pokemon/art";
import { GENERATION_REGIONS } from "@/lib/pokemon/constants";
import { TYPES, capitalize } from "@/lib/pokemon/type-matrix";
import { TypeBadge } from "@/components/pokedex/TypeBadge";
import { Breadcrumbs, rankingCrumbs } from "@/components/pokedex/rankings/RankingView";
import { METRICS, RANKINGS_PATH, formatValue, isBuiltPage, metricShortLabel, ranking, rankingHeading, rankingImagePath, rankingPath, type Scope } from "@/lib/dex/rankings";

const TITLE = "Pokémon Rankings: Heaviest, Tallest, Fastest & Strongest Pokémon";
const DESCRIPTION =
  "Every Pokémon ranked by weight, height, Speed, base stat total and each base stat, with lists for every type and generation and versions including Mega Evolutions and forms.";

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: RANKINGS_PATH, socialTitle: "Pokémon rankings · PokéIQ Pokédex", image: { url: rankingImagePath(), alt: "Pokémon rankings: the heaviest, tallest, fastest and strongest Pokémon" } });

const linkCls = "underline-offset-2 hover:text-foreground hover:underline";

function LinkRow({ scope }: { scope: Scope }) {
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
      {METRICS.filter((m) => isBuiltPage(m.slug, scope)).map((m) => (
        <Link key={m.slug} href={rankingPath(m.slug, scope)} className={linkCls}>
          {metricShortLabel(m)}
        </Link>
      ))}
    </p>
  );
}

export default function RankingsHub() {
  const crumbs = rankingCrumbs(null);
  const list = itemList(
    "Pokémon rankings",
    METRICS.map((m) => ({ name: rankingHeading(m, { kind: "all" }), path: rankingPath(m.slug) }))
  );
  return (
    <article className="mx-auto max-w-6xl space-y-8" data-testid="rankings-hub">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList(crumbs)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(list) }} />
      <Breadcrumbs crumbs={crumbs} />

      <header className="space-y-2 text-center">
        <p className="hud-label text-screen">National database</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">
          Pokémon <span className="text-primary">rankings</span>
        </h1>
        <p className="mx-auto max-w-2xl text-muted-foreground">
          Every Pokémon ranked by size and base stats, from the heaviest and tallest to the fastest and strongest. Each list is one full table, computed from the Pokédex data, with lists per type and generation and versions with Mega Evolutions and forms.
        </p>
      </header>

      <section aria-labelledby="hub-lists" className="space-y-3">
        <h2 id="hub-lists" className="font-display text-lg font-bold uppercase tracking-wider">
          All Pokémon
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {METRICS.map((m) => {
            const rows = ranking(m);
            const top = rows[0];
            const tied = rows.filter((r) => r.rank === 1).length;
            const v = formatValue(m.key, top.value);
            return (
              <li key={m.slug}>
                <Link href={rankingPath(m.slug)} className="hud group flex h-full items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-screen/60" data-testid="hub-list-link">
                  <img src={boardArtUrl(top.entry.art)} alt={top.entry.name} width={56} height={56} loading="lazy" decoding="async" className="h-14 w-14 shrink-0 object-contain" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-base font-bold uppercase tracking-wide group-hover:text-screen">{rankingHeading(m, { kind: "all" })}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      #1 {top.entry.name}
                      {tied > 1 && " (tied)"} · <span className="font-mono tabular-nums">{v.main}</span>
                      {v.alt && <span className="font-mono tabular-nums"> / {v.alt}</span>}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="hub-types" className="space-y-3">
        <h2 id="hub-types" className="font-display text-lg font-bold uppercase tracking-wider">
          By type
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TYPES.map((t) => (
            <li key={t} className="hud space-y-2 rounded-lg border bg-card p-3">
              <h3 className="flex items-center gap-2">
                <TypeBadge type={t} />
                <span className="sr-only">{capitalize(t)}-type Pokémon rankings</span>
              </h3>
              <LinkRow scope={{ kind: "type", type: t }} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="hub-gens" className="space-y-3">
        <h2 id="hub-gens" className="font-display text-lg font-bold uppercase tracking-wider">
          By generation
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(GENERATION_REGIONS).map(([g, region]) => (
            <li key={g} className="hud space-y-2 rounded-lg border bg-card p-3">
              <h3 className="font-pixel text-[10px] uppercase tracking-wider text-screen">
                Gen {g} · {region}
              </h3>
              <LinkRow scope={{ kind: "gen", gen: Number(g) }} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="hub-forms" className="hud space-y-2 rounded-lg border bg-card p-3">
        <h2 id="hub-forms" className="font-pixel text-[10px] uppercase tracking-wider text-screen">
          With Mega Evolutions and forms
        </h2>
        <LinkRow scope={{ kind: "forms" }} />
      </section>
    </article>
  );
}
