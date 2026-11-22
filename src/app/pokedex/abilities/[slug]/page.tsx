import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SHARE_IMAGES, jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList } from "@/lib/structured-data";
import { ABILITIES, getAbility, species } from "@/lib/dex/data";
import { dexLocal } from "@/lib/dex/local";
import { Section } from "@/components/pokedex/entry/Reveal";
import { DetailHero, DetailNav, SpeciesGrid } from "@/components/pokedex/detail/DetailParts";
import { pagerFor } from "@/lib/dex/neighbours";
import { getLocale, serverT } from "@/i18n/server";
import dexRef from "@/messages/dex-ref";

export const dynamicParams = false;

export function generateStaticParams() {
  return ABILITIES.map((a) => ({ slug: a.slug }));
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const a = getAbility((await params).slug);
  if (!a) return {};
  const t = serverT(dexRef);
  const L = await dexLocal(getLocale());
  const name = L.ability(a.name);
  const effect = L.locale === "en" ? a.effect : (L.abilityText(a.slug) ?? "");
  return pageMetadata({
    title: t("ability.metaTitle", { name }),
    description: t("ability.metaDescription", { name, effect }),
    path: `/pokedex/abilities/${a.slug}`,
    image: SHARE_IMAGES.pokedex,
    socialTitle: t("social", { name }),
  });
}

export default async function AbilityPage({ params }: PageProps) {
  const a = getAbility((await params).slug);
  if (!a) notFound();
  const t = serverT(dexRef);
  const L = await dexLocal(getLocale());
  const name = L.ability(a.name);
  const effect = L.locale === "en" ? a.effect : L.abilityText(a.slug);
  const chips = (hidden: boolean) =>
    a.holders.filter((h) => h.hidden === hidden).flatMap((h) => {
      const s = species(h.id);
      return s ? [{ ...s, name: L.species(s.id, s.name) }] : [];
    });
  const pager = pagerFor(ABILITIES, (x) => x.slug === a.slug, (x) => ({ href: `/pokedex/abilities/${x.slug}`, label: L.ability(x.name) }));
  const normal = chips(false);
  const hidden = chips(true);

  return (
    <article className="mx-auto max-w-6xl space-y-10">
      <DetailNav tab="abilities" label={t("ability.back")} pager={pager} />
      <DetailHero kicker={t("ability.kicker")} title={name}>
        <p className="max-w-2xl text-foreground/90">{effect || t("ability.noEffect")}</p>
      </DetailHero>

      {normal.length > 0 && (
        <Section id="normal" index={1} title={t("ability.normal")}>
          <SpeciesGrid list={normal} />
        </Section>
      )}
      {hidden.length > 0 && (
        <Section id="hidden" index={normal.length > 0 ? 2 : 1} title={t("ability.hidden")}>
          <SpeciesGrid list={hidden} />
        </Section>
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList([{ name: t("crumb.pokedex"), path: "/pokedex" }, { name: t("crumb.abilities"), path: "/pokedex/abilities" }, { name, path: `/pokedex/abilities/${a.slug}` }])) }} />
    </article>
  );
}
