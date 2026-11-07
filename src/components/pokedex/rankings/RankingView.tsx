/* eslint-disable @next/next/no-img-element -- thumbnails are pre-sized static files (public/art/160) or /api/art */
import Link from "@/components/ui/Link";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Table2 } from "lucide-react";
import { jsonLd } from "@/lib/seo";
import { breadcrumbList, itemList } from "@/lib/structured-data";
import { artUrl, boardArtUrl } from "@/lib/pokemon/art";
import { GENERATION_REGIONS, STAT_LABELS, type StatKey } from "@/lib/pokemon/constants";
import { TYPES, capitalize } from "@/lib/pokemon/type-matrix";
import { TypeBadge } from "@/components/pokedex/TypeBadge";
import { cn } from "@/lib/utils";
import {
  ALL,
  METRICS,
  RANKINGS_PATH,
  countingNote,
  explorerHref,
  formatValue,
  getMetric,
  isBuiltPage,
  leaderSentence,
  metricShortLabel,
  ranking,
  rankingFaq,
  rankingHeading,
  rankingPath,
  runnersUpSentence,
  type Metric,
  type RankEntry,
  type Scope,
} from "@/lib/dex/rankings";

/** Rows whose picture loads straight away (the first screen); the rest load as they scroll in. */
const EAGER_ROWS = 8;
/** ItemList JSON-LD carries the top of the list, as the ranking sites do. */
const LD_ITEMS = 50;
const STATS: StatKey[] = ["hp", "atk", "def", "spa", "spd", "spe"];

export function scopeLabel(s: Scope): string {
  if (s.kind === "type") return `${capitalize(s.type)} type`;
  if (s.kind === "gen") return `Gen ${s.gen} · ${GENERATION_REGIONS[s.gen]}`;
  if (s.kind === "forms") return "With forms";
  return "All Pokémon";
}

export function rankingCrumbs(m: Metric | null, s: Scope = ALL) {
  const crumbs = [
    { name: "Pokédex", path: "/pokedex" },
    { name: "Rankings", path: RANKINGS_PATH },
  ];
  if (m) crumbs.push({ name: rankingHeading(m, ALL), path: rankingPath(m.slug) });
  if (m && s.kind !== "all") crumbs.push({ name: scopeLabel(s), path: rankingPath(m.slug, s) });
  return crumbs;
}

export function Breadcrumbs({ crumbs }: { crumbs: { name: string; path: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {crumbs.map((c, i) => (
          <li key={c.path} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden>›</span>}
            {i === crumbs.length - 1 ? (
              <span aria-current="page" className="text-foreground">
                {c.name}
              </span>
            ) : (
              <Link href={c.path} className="underline-offset-2 hover:text-foreground hover:underline">
                {c.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

const chip = "inline-flex h-8 items-center rounded-md border px-2.5 font-pixel text-[10px] uppercase tracking-wider transition-colors";
const chipOn = "border-transparent bg-primary text-primary-foreground";
const chipOff = "border-foreground/15 bg-card text-muted-foreground hover:border-screen/60 hover:text-foreground";

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn(chip, active ? chipOn : chipOff)}>
      {children}
    </Link>
  );
}

/** Where a type badge in the table goes: this list for that type, if it has a page, else the type's page. */
function typeHref(m: Metric, type: string): string {
  const s: Scope = { kind: "type", type: type as (typeof TYPES)[number] };
  return isBuiltPage(m.slug, s) ? rankingPath(m.slug, s) : `/pokedex/types/${type}`;
}

function Types({ m, types }: { m: Metric; types: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {types.map((t) => (
        <a key={t} href={typeHref(m, t)} className="rounded-[4px]">
          <TypeBadge type={t} size="sm" />
        </a>
      ))}
    </span>
  );
}

function ValueCell({ m, v }: { m: Metric; v: number }) {
  const f = formatValue(m.key, v);
  return (
    <>
      <span className="block font-mono font-bold tabular-nums">{f.main}</span>
      {f.alt && <span className="block font-mono text-[11px] tabular-nums text-muted-foreground">{f.alt}</span>}
    </>
  );
}

function Picture({ e, eager }: { e: RankEntry; eager: boolean }) {
  return (
    <img
      src={e.form ? artUrl(e.art, 96) : boardArtUrl(e.art)}
      alt={e.name}
      width={40}
      height={40}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className="h-10 w-10 shrink-0 object-contain"
    />
  );
}

/** The full list as a real table: rank, Pokémon, types, the value, and a couple of context columns. */
function RankingTable({ m, s }: { m: Metric; s: Scope }) {
  const rows = ranking(m, s);
  const size = m.key === "weight" || m.key === "height";
  const other = m.key === "weight" ? getMetric("tallest")! : getMetric("heaviest")!;
  const sortIcon = m.dir === "desc" ? <ArrowDownWideNarrow className="h-3.5 w-3.5" aria-hidden /> : <ArrowUpNarrowWide className="h-3.5 w-3.5" aria-hidden />;
  return (
    <div className="hud overflow-x-auto rounded-lg border bg-card">
      <table className="w-full border-collapse text-sm [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-2 sm:[&_td]:px-3 sm:[&_th]:px-3" data-testid="ranking-table">
        <caption className="sr-only">{rankingHeading(m, s)}</caption>
        <thead className="border-b border-foreground/10 bg-shade/30 text-left font-pixel text-[9px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th scope="col" className="w-10 text-right">
              Rank
            </th>
            <th scope="col">Pokémon</th>
            <th scope="col" className="max-sm:hidden">
              Type
            </th>
            <th scope="col" aria-sort={m.dir === "desc" ? "descending" : "ascending"} className="text-right text-screen">
              <span className="inline-flex items-center gap-1">
                {m.column}
                {sortIcon}
              </span>
            </th>
            {size && (
              <th scope="col" className="text-right max-md:hidden">
                {other.column}
              </th>
            )}
            {m.key === "bst" &&
              STATS.map((k) => (
                <th key={k} scope="col" className="text-right max-lg:hidden">
                  {STAT_LABELS[k]}
                </th>
              ))}
            {!size && m.key !== "bst" && (
              <th scope="col" className="text-right max-md:hidden">
                Total
              </th>
            )}
            <th scope="col" className="text-right max-md:hidden">
              Gen
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-foreground/10">
          {rows.map((r, i) => (
            <tr key={r.entry.key} id={r.entry.key} className="scroll-mt-24 target:bg-screen/10">
              <td className="text-right font-mono tabular-nums text-muted-foreground">
                {r.rank}
                {r.tied && <span className="sr-only"> (tied)</span>}
              </td>
              <td>
                <a href={`/pokemon/${r.entry.slug}`} className="group flex min-w-0 items-center gap-2">
                  <Picture e={r.entry} eager={i < EAGER_ROWS} />
                  <span className="min-w-0">
                    <span className="block font-display font-bold uppercase tracking-wide group-hover:text-screen max-sm:text-[13px] max-sm:tracking-normal">{r.entry.name}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground">
                      #{String(r.entry.species).padStart(4, "0")}
                      {r.entry.speciesName && ` · ${r.entry.speciesName}`}
                    </span>
                  </span>
                </a>
                <span className="mt-1 block sm:hidden">
                  <Types m={m} types={r.entry.types} />
                </span>
              </td>
              <td className="max-sm:hidden">
                <Types m={m} types={r.entry.types} />
              </td>
              <td className="text-right">
                <ValueCell m={m} v={r.value} />
              </td>
              {size && (
                <td className="text-right max-md:hidden">
                  <ValueCell m={other} v={m.key === "weight" ? r.entry.height : r.entry.weight} />
                </td>
              )}
              {m.key === "bst" &&
                STATS.map((k) => (
                  <td key={k} className="text-right font-mono tabular-nums text-muted-foreground max-lg:hidden">
                    {r.entry.stats[k]}
                  </td>
                ))}
              {!size && m.key !== "bst" && <td className="text-right font-mono tabular-nums text-muted-foreground max-md:hidden">{r.entry.bst}</td>}
              <td className="text-right font-mono tabular-nums text-muted-foreground max-md:hidden">{r.entry.gen}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Other lists for the same scope, and the same list for the other scopes. */
function Switchers({ m, s }: { m: Metric; s: Scope }) {
  const siblings = METRICS.filter((x) => isBuiltPage(x.slug, s));
  return (
    <div className="space-y-3" data-testid="ranking-switchers">
      <div className="space-y-1.5">
        <h2 className="font-pixel text-[10px] uppercase tracking-wider text-muted-foreground">Rank by</h2>
        <div className="flex flex-wrap gap-1.5">
          {siblings.map((x) => (
            <Chip key={x.slug} href={rankingPath(x.slug, s)} active={x.slug === m.slug}>
              {metricShortLabel(x)}
            </Chip>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <h2 className="font-pixel text-[10px] uppercase tracking-wider text-muted-foreground">Which Pokémon</h2>
        <div className="flex flex-wrap gap-1.5">
          <Chip href={rankingPath(m.slug)} active={s.kind === "all"}>
            All Pokémon
          </Chip>
          <Chip href={rankingPath(m.slug, { kind: "forms" })} active={s.kind === "forms"}>
            With Megas &amp; forms
          </Chip>
          {m.byGen &&
            Object.keys(GENERATION_REGIONS).map((g) => {
              const gen = Number(g);
              const sc: Scope = { kind: "gen", gen };
              return isBuiltPage(m.slug, sc) ? (
                <Chip key={g} href={rankingPath(m.slug, sc)} active={s.kind === "gen" && s.gen === gen}>
                  Gen {g}
                </Chip>
              ) : null;
            })}
        </div>
        {m.byType && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {TYPES.map((t) => {
              const sc: Scope = { kind: "type", type: t };
              if (!isBuiltPage(m.slug, sc)) return null;
              const on = s.kind === "type" && s.type === t;
              return (
                <Link
                  key={t}
                  href={rankingPath(m.slug, sc)}
                  aria-current={on ? "page" : undefined}
                  className={cn("rounded-[4px] transition-transform hover:-translate-y-0.5", on ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : "opacity-90")}
                >
                  <TypeBadge type={t} />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function faqLd(faq: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

export function RankingView({ m, s }: { m: Metric; s: Scope }) {
  const rows = ranking(m, s);
  const heading = rankingHeading(m, s);
  const crumbs = rankingCrumbs(m, s);
  const faq = rankingFaq(m, s);
  const opposite = m.opposite ? getMetric(m.opposite) : undefined;
  const oppositeScope = opposite && isBuiltPage(opposite.slug, s) ? s : ALL;
  const list = itemList(
    heading,
    rows.slice(0, LD_ITEMS).map((r) => ({ name: r.entry.name, path: `/pokemon/${r.entry.slug}` }))
  );
  const more = s.kind === "type" || s.kind === "gen" ? METRICS.filter((x) => x.slug !== m.slug && isBuiltPage(x.slug, s)) : [];

  return (
    <article className="mx-auto max-w-6xl space-y-6" data-testid="ranking-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList(crumbs)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(list) }} />
      {faq.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(faqLd(faq)) }} />}
      <Breadcrumbs crumbs={crumbs} />

      <header className="hud space-y-3 rounded-lg border bg-card p-5 sm:p-6">
        <p className="hud-label text-screen">Pokémon rankings · {m.measure}</p>
        <h1 className="font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl">{heading}</h1>
        <p className="max-w-3xl text-foreground/90" data-testid="ranking-intro">
          {leaderSentence(m, s, rows)} {runnersUpSentence(m, rows)}
        </p>
        <p className="max-w-3xl text-sm text-muted-foreground">{countingNote(m, s)} Data from PokéAPI.</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link href={explorerHref(m, s)} className="hud-btn inline-flex h-9 items-center gap-1.5 rounded-md border border-foreground/15 bg-shade/30 px-3 font-display text-xs font-semibold uppercase tracking-wider hover:border-screen/60" data-testid="ranking-explorer-link">
            <Table2 className="h-3.5 w-3.5" aria-hidden />
            Open in the Pokédex
          </Link>
          {opposite && (
            <Link href={rankingPath(opposite.slug, oppositeScope)} className="inline-flex h-9 items-center rounded-md border border-foreground/15 px-3 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:border-screen/60 hover:text-foreground">
              {rankingHeading(opposite, oppositeScope)}
            </Link>
          )}
        </div>
      </header>

      <Switchers m={m} s={s} />

      <RankingTable m={m} s={s} />

      {faq.length > 0 && (
        <section aria-labelledby="ranking-faq" className="max-w-3xl space-y-3">
          <h2 id="ranking-faq" className="font-display text-lg font-bold uppercase tracking-wider">
            Questions
          </h2>
          <dl className="space-y-3 text-sm">
            {faq.map((f) => (
              <div key={f.q}>
                <dt className="font-semibold">{f.q}</dt>
                <dd className="text-muted-foreground">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section aria-labelledby="ranking-more" className="space-y-2">
        <h2 id="ranking-more" className="font-display text-lg font-bold uppercase tracking-wider">
          More rankings
        </h2>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {more.map((x) => (
            <Link key={x.slug} href={rankingPath(x.slug, s)} className="underline-offset-2 hover:text-foreground hover:underline">
              {rankingHeading(x, s)}
            </Link>
          ))}
          {s.kind === "type" && (
            <Link href={`/pokedex/types/${s.type}`} className="underline-offset-2 hover:text-foreground hover:underline">
              {capitalize(s.type)} type matchups
            </Link>
          )}
          <Link href={RANKINGS_PATH} className="underline-offset-2 hover:text-foreground hover:underline">
            All Pokémon rankings
          </Link>
          <Link href="/pokedex" className="underline-offset-2 hover:text-foreground hover:underline">
            Full Pokédex
          </Link>
        </p>
      </section>
    </article>
  );
}
