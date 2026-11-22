import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { PokedexExplorer, type DexRow } from "@/components/pokedex/PokedexExplorer";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import pages from "@/messages/pokedex-pages";
import explorerNs from "@/messages/pokedex-explorer";
import { speciesName } from "@/lib/names/species";
import { dexListLocal, genusIn } from "@/lib/pokemon/dex-local";

export function generateMetadata(): Metadata {
  const t = serverT(pages);
  return pageMetadata({
    title: t("hub.metaTitle"),
    description: t("hub.metaDescription"),
    path: "/pokedex",
  });
}

export default function PokedexPage() {
  const t = serverT(pages);
  const locale = getLocale();
  // Another language: the rows carry its names and categories, and the list gets its type names and search aliases.
  const local = locale === "en" ? undefined : dexListLocal(locale);
  const rows: DexRow[] = POKEDEX.map((p) => [
    p.id,
    p.slug,
    locale === "en" ? p.name : speciesName(p.id, p.name, locale),
    locale === "en" ? p.genus : genusIn(locale, p.genus),
    p.types.join(" "),
    p.gen,
    p.stats.hp,
    p.stats.atk,
    p.stats.def,
    p.stats.spa,
    p.stats.spd,
    p.stats.spe,
    p.height,
    p.weight,
    (p.legendary ? 1 : 0) | (p.mythical ? 2 : 0) | (p.fullyEvolved ? 4 : 0),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="space-y-2 text-center">
        <p className="hud-label max-md:hidden text-screen">{t("hub.kicker")}</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">
          {t.rich("title", { accent: (c) => <span className="text-primary">{c}</span> })}
        </h1>
        <p className="mx-auto max-w-2xl text-muted-foreground">
          {t("hub.blurb")}
        </p>
      </div>
      <DexTabs active="pokemon" />
      <ClientMessages namespaces={[explorerNs]}>
        <PokedexExplorer rows={rows} {...(local && { local })} />
      </ClientMessages>
    </div>
  );
}
