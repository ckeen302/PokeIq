import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { censorEntry, censorEntryIn } from "@/engines/modules/dex";
import type { QuizLang } from "@/engines/i18n";
import { StudyMode, type StudyCard } from "@/components/pokedex/StudyMode";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import pages from "@/messages/pokedex-pages";
import studyNs from "@/messages/pokedex-study";
import { speciesName } from "@/lib/names/species";
import { dexTexts, genusIn, regionNames, typeNames } from "@/lib/pokemon/dex-local";

export function generateMetadata(): Metadata {
  const t = serverT(pages);
  return pageMetadata({
    title: t("study.metaTitle"),
    description: t("study.metaDescription"),
    image: SHARE_IMAGES.pokedex,
    path: "/pokedex/study",
  });
}

export default function StudyPage() {
  const locale = getLocale();
  if (locale === "en") {
    const cards: StudyCard[] = POKEDEX.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      genus: p.genus,
      types: p.types,
      gen: p.gen,
      entry: p.flavor[0] ? censorEntry(p.flavor[0], p) : "",
    }));
    return <StudyMode cards={cards} />;
  }
  // Another language: its names, categories and the games' own Pokédex entries in it (none after Generation 8, so those
  // cards sit out the entry prompt), each with the Pokémon's names hidden.
  const texts = dexTexts(locale, "species");
  // The entry censor only asks a language for its code and its species' names.
  const lang = { locale, pokemon: (p: number | { id: number; name: string }) => (typeof p === "number" ? speciesName(p, "", locale) || undefined : speciesName(p.id, p.name, locale)) } as unknown as QuizLang;
  const cards: StudyCard[] = POKEDEX.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: speciesName(p.id, p.name, locale),
    genus: genusIn(locale, p.genus),
    types: p.types,
    gen: p.gen,
    entry: (texts[p.id] ?? []).map((e) => censorEntryIn(e.text, p, lang)).find((e): e is string => !!e) ?? "",
  }));
  return (
    <ClientMessages namespaces={[studyNs]}>
      <StudyMode cards={cards} local={{ types: typeNames(locale), regions: regionNames(locale) }} />
    </ClientMessages>
  );
}
