import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "@/components/ui/Link";
import { SHARE_IMAGES, jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList, itemList } from "@/lib/structured-data";
import { TYPES, capitalize, type PokemonType } from "@/lib/pokemon/type-matrix";
import { isType, movesOfType, pokemonOfType, typeMatchups } from "@/lib/dex/type-pages";
import type { MoveRecord } from "@/lib/dex/build";
import { Section } from "@/components/pokedex/entry/Reveal";
import { TypeBadge } from "@/components/pokedex/TypeBadge";
import { DetailHero, DetailNav, SpeciesGrid, StatBox } from "@/components/pokedex/detail/DetailParts";
import { pagerFor } from "@/lib/dex/neighbours";
import type { Locale } from "@/i18n/config";
import type { Translator } from "@/i18n/catalog";
import { getLocale, serverT } from "@/i18n/server";
import pages from "@/messages/pokedex-pages";
import { speciesName } from "@/lib/names/species";
import { dexTable, listIn, nameIn, typeNames } from "@/lib/pokemon/dex-local";

export const dynamicParams = false;

export function generateStaticParams() {
  return TYPES.map((type) => ({ type }));
}

interface PageProps {
  params: Promise<{ type: string }>;
}

type T = Translator<typeof pages.en>;

/** A type's name in the page's language (official names; English as it always was). */
function typeNamer(locale: Locale): (type: string) => string {
  const names = locale === "en" ? null : typeNames(locale);
  return (type) => names?.[type] ?? capitalize(type);
}

/** The page's description: what the type hits hard, what hits it, and what the page lists. */
function typeDescription(t: T, type: PokemonType, locale: Locale): string {
  const name = typeNamer(locale);
  const m = typeMatchups(type);
  const { pure, dual } = pokemonOfType(type);
  const list = (ts: PokemonType[]) => (locale === "en" ? ts.map(name).join(", ") : listIn(locale, ts.map(name)));
  const own = name(type);
  return [
    m.superEffective.length ? t("type.descSuper", { type: own, list: list(m.superEffective) }) : t("type.descSuperNone", { type: own }),
    m.weakTo.length ? t("type.descWeak", { type: own, list: list(m.weakTo) }) : t("type.descWeakNone", { type: own }),
    // Other languages leave the count out of the copy.
    locale === "en" ? t("type.descAll", { n: pure.length + dual.length, type: own }) : t("type.descEvery", { type: own }),
  ].join(" ");
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const ty = (await params).type;
  if (!isType(ty)) return {};
  const t = serverT(pages);
  const locale = getLocale();
  const name = typeNamer(locale)(ty);
  return pageMetadata({
    title: t("type.metaTitle", { type: name }),
    description: typeDescription(t, ty, locale),
    path: `/pokedex/types/${ty}`,
    socialTitle: t("type.social", { type: name }),
    image: SHARE_IMAGES.pokedex,
  });
}

function TypeLinks({ types, empty, names }: { types: PokemonType[]; empty: string; names: (type: string) => string }) {
  if (!types.length) return <span className="text-sm text-muted-foreground">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {types.map((ty) => (
        <Link key={ty} href={`/pokedex/types/${ty}`} className="rounded-[4px] transition-transform hover:-translate-y-0.5">
          <TypeBadge type={ty} label={names(ty)} />
        </Link>
      ))}
    </span>
  );
}

function MatchupRows({ rows, names }: { rows: { label: string; mult: string; types: PokemonType[]; empty: string }[]; names: (type: string) => string }) {
  return (
    <dl className="hud divide-y divide-foreground/10 rounded-lg border bg-card">
      {rows.map((r) => (
        <div key={r.label} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4">
          <dt className="flex shrink-0 items-center gap-2 sm:w-56">
            <span className="font-mono text-lg font-bold tabular-nums text-screen">{r.mult}</span>
            <span className="font-pixel text-[10px] uppercase tracking-wider text-muted-foreground">{r.label}</span>
          </dt>
          <dd>
            <TypeLinks types={r.types} empty={r.empty} names={names} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function MoveList({ moves }: { moves: MoveRecord[] }) {
  const t = serverT(pages);
  const locale = getLocale();
  const classes = locale === "en" ? null : dexTable(locale, "damage-classes");
  return (
    <ul className="hud divide-y divide-foreground/10 rounded-lg border bg-card">
      {moves.map((m) => (
        <li key={m.slug}>
          <Link href={`/pokedex/moves/${m.slug}`} className="group flex items-center gap-3 px-3 py-2.5">
            <span className="min-w-0 flex-1 truncate font-display font-bold uppercase tracking-wide group-hover:text-screen">{locale === "en" ? m.name : nameIn(locale, "moves", m.name)}</span>
            <span className="hidden font-pixel text-[9px] uppercase tracking-wider text-muted-foreground sm:inline">{classes?.[m.cls] ?? m.cls}</span>
            <span className="w-16 shrink-0 text-right font-mono text-sm tabular-nums">{m.power ?? "—"} <span className="text-[10px] text-muted-foreground">{t("type.pwr")}</span></span>
            <span className="w-20 shrink-0 text-right font-mono text-sm tabular-nums">
              {m.learners.length} <span className="text-[10px] text-muted-foreground">{t("type.mons")}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function TypePage({ params }: PageProps) {
  const ty = (await params).type;
  if (!isType(ty)) notFound();
  const t = serverT(pages);
  const locale = getLocale();
  const names = typeNamer(locale);
  const name = names(ty);
  const m = typeMatchups(ty);
  const { pure, dual } = pokemonOfType(ty);
  const moves = movesOfType(ty);
  const pager = pagerFor(TYPES, (x) => x === ty, (x) => ({ href: `/pokedex/types/${x}`, label: t("type.name", { type: names(x) }) }));
  const chip = (p: (typeof pure)[number]) => ({ id: p.id, slug: p.slug, name: locale === "en" ? p.name : speciesName(p.id, p.name, locale), types: p.types });

  const crumbs = breadcrumbList([
    { name: t("crumbs.pokedex"), path: "/pokedex" },
    { name: t("crumbs.types"), path: "/pokedex/types" },
    { name: t("type.name", { type: name }), path: `/pokedex/types/${ty}` },
  ]);
  const list = itemList(
    t("type.typedPokemon", { type: name }),
    [...pure, ...dual].map((p) => ({ name: chip(p).name, path: `/pokemon/${p.slug}` }))
  );

  return (
    <article className="mx-auto max-w-6xl space-y-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(crumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(list) }} />
      <DetailNav tab="types" label={t("type.back")} pager={pager} />
      <DetailHero kicker={t("type.kicker")} title={t("type.name", { type: name })}>
        <TypeBadge type={ty} size="lg" label={name} />
        <p className="max-w-2xl text-foreground/90">{typeDescription(t, ty, locale)}</p>
      </DetailHero>

      <Section id="attacking" index={1} title={t("type.attacking", { type: name })}>
        <MatchupRows
          names={names}
          rows={[
            { label: t("type.superVs"), mult: "2×", types: m.superEffective, empty: t("type.noType") },
            { label: t("type.notVeryVs"), mult: "½×", types: m.notVeryEffective, empty: t("type.noType") },
            { label: t("type.noEffectOn"), mult: "0×", types: m.noEffect, empty: t("type.noType") },
          ]}
        />
      </Section>

      <Section id="defending" index={2} title={t("type.defending", { type: name })} subtitle={t("type.singleTyped")}>
        <MatchupRows
          names={names}
          rows={[
            { label: t("type.weakTo"), mult: "2×", types: m.weakTo, empty: t("type.noType") },
            { label: t("type.resists"), mult: "½×", types: m.resists, empty: t("type.noType") },
            { label: t("type.immuneTo"), mult: "0×", types: m.immuneTo, empty: t("type.noType") },
          ]}
        />
        <p className="mt-3 text-[11px] text-muted-foreground">
          {t.rich("type.dualNote", {
            link: (c) => (
              <Link href="/pokedex/types" className="underline underline-offset-2 hover:text-foreground">
                {c}
              </Link>
            ),
          })}
        </p>
      </Section>

      <Section id="moves" index={3} title={t("type.moves", { type: name })}>
        <div className="mb-4 grid grid-cols-3 gap-3 sm:max-w-md">
          <StatBox label={t("type.physical")} value={moves.physical} />
          <StatBox label={t("type.special")} value={moves.special} />
          <StatBox label={t("type.status")} value={moves.status} />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {moves.strongest.length > 0 && (
            <div className="min-w-0 space-y-2">
              <h3 className="font-pixel text-[10px] uppercase tracking-wider text-muted-foreground">{t("type.strongest")}</h3>
              <MoveList moves={moves.strongest} />
            </div>
          )}
          {moves.common.length > 0 && (
            <div className="min-w-0 space-y-2">
              <h3 className="font-pixel text-[10px] uppercase tracking-wider text-muted-foreground">{t("type.common")}</h3>
              <MoveList moves={moves.common} />
            </div>
          )}
        </div>
      </Section>

      <Section id="pokemon" index={4} title={t("type.typedPokemon", { type: name })} subtitle={t("type.split", { pure: pure.length, dual: dual.length })}>
        <div className="space-y-6">
          {pure.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-pixel text-[10px] uppercase tracking-wider text-muted-foreground">{t("type.pure", { type: name, n: pure.length })}</h3>
              <SpeciesGrid list={pure.map(chip)} />
            </div>
          )}
          {dual.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-pixel text-[10px] uppercase tracking-wider text-muted-foreground">{t("type.part", { type: name, n: dual.length })}</h3>
              <SpeciesGrid list={dual.map(chip)} />
            </div>
          )}
        </div>
      </Section>

      <nav aria-label={t("type.others")} className="space-y-2">
        <h2 className="font-pixel text-[10px] uppercase tracking-wider text-muted-foreground">{t("type.others")}</h2>
        <TypeLinks types={TYPES.filter((x) => x !== ty)} empty="" names={names} />
      </nav>
    </article>
  );
}
