import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SHARE_IMAGES, jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList } from "@/lib/structured-data";
import { MOVES, getMove, species } from "@/lib/dex/data";
import { dexLocal, type DexLocal } from "@/lib/dex/local";
import type { Translator } from "@/i18n/catalog";
import { Section } from "@/components/pokedex/entry/Reveal";
import { TypeBadge } from "@/components/pokedex/TypeBadge";
import { DetailHero, DetailNav, SpeciesGrid, StatBox } from "@/components/pokedex/detail/DetailParts";
import { pagerFor } from "@/lib/dex/neighbours";
import { getLocale, serverT } from "@/i18n/server";
import dexRef from "@/messages/dex-ref";

export const dynamicParams = false;

export function generateStaticParams() {
  return MOVES.map((m) => ({ slug: m.slug }));
}

type T = Translator<typeof dexRef.en>;
type Cls = "physical" | "special" | "status";

/** A move's name for its tab title: Z-Moves come in a physical and a special version under one name, so a twin's title adds its class. */
function titleName(t: T, m: (typeof MOVES)[number], name: string): string {
  return MOVES.some((o) => o !== m && o.name === m.name) ? t("move.twin", { name, cls: m.cls }) : name;
}

/** How a Pokémon learns the move ("Lv. 36", "Evolution", "TM24", "Egg"), in the page's language. */
function howLabel(t: T, L: DexLocal, how: string): string {
  if (L.locale === "en") return how;
  const level = /^Lv\. (\d+)$/.exec(how);
  if (level) return t("move.how.level", { n: level[1] });
  if (how === "Evolution") return t("move.how.evolution");
  if (how === "Tutor") return t("move.how.tutor");
  if (how === "Egg") return t("move.how.egg");
  // A machine ("TM24", "TR05", "HM03"): the item's official name.
  return L.item(how);
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const m = getMove((await params).slug);
  if (!m) return {};
  const t = serverT(dexRef);
  const L = await dexLocal(getLocale());
  const name = L.move(m.name);
  const effect = L.locale === "en" ? m.effect : (L.moveText(m.id) ?? "");
  return pageMetadata({
    title: t("move.metaTitle", { name: titleName(t, m, name) }),
    description: t("move.metaDescription", { name, type: L.type(m.type), cls: m.cls, effect }),
    path: `/pokedex/moves/${m.slug}`,
    image: SHARE_IMAGES.pokedex,
    socialTitle: t("social", { name }),
  });
}

export default async function MovePage({ params }: PageProps) {
  const m = getMove((await params).slug);
  if (!m) notFound();
  const t = serverT(dexRef);
  const L = await dexLocal(getLocale());
  const name = L.move(m.name);
  const effect = L.locale === "en" ? m.effect : L.moveText(m.id);
  const pager = pagerFor(MOVES, (x) => x.slug === m.slug, (x) => ({ href: `/pokedex/moves/${x.slug}`, label: L.move(x.name) }));
  const learners = m.learners.flatMap((l) => {
    const s = species(l.id);
    return s ? [{ ...s, name: L.species(s.id, s.name), note: l.how.slice(0, 3).map((h) => howLabel(t, L, h)).join(" · ") }] : [];
  });

  return (
    <article className="mx-auto max-w-6xl space-y-10">
      <DetailNav tab="moves" label={t("move.back")} pager={pager} />
      <DetailHero kicker={t("move.kicker", { gen: m.gen })} title={name}>
        <div className="flex flex-wrap items-center gap-2">
          <TypeBadge type={m.type} size="lg" />
          <span className="rounded-[4px] border border-foreground/10 bg-shade/30 px-3 py-1.5 font-display text-sm font-bold uppercase tracking-wider">{L.locale === "en" ? m.cls : t(`move.cls.${m.cls as Cls}`)}</span>
        </div>
        <p className="max-w-2xl text-foreground/90">{effect || t("move.noEffect")}</p>
      </DetailHero>

      <Section id="stats" index={1} title={t("move.data")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatBox label={t("move.power")} value={m.power ?? "—"} />
          <StatBox label={t("move.accuracy")} value={m.accuracy ?? "—"} />
          <StatBox label={t("move.pp")} value={m.pp ?? "—"} />
          <StatBox label={t("move.priority")} value={m.priority > 0 ? `+${m.priority}` : m.priority} />
        </div>
      </Section>

      <Section id="learners" index={2} title={t("move.learnedBy")}>
        {learners.length ? (
          <>
            <SpeciesGrid list={learners} />
            <p className="mt-3 text-[11px] text-muted-foreground">{t("move.learnsetNote")}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("move.noLearners")}</p>
        )}
      </Section>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList([{ name: t("crumb.pokedex"), path: "/pokedex" }, { name: t("crumb.moves"), path: "/pokedex/moves" }, { name, path: `/pokedex/moves/${m.slug}` }])) }} />
    </article>
  );
}
