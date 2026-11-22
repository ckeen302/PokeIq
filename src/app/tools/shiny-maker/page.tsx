import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { getLocale, getT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import tools from "@/messages/tools";
import { decodeDesign } from "@/lib/shiny-maker/design";
import { speciesName } from "@/lib/shiny-maker/server";
import { shinyLocal, speciesNameIn } from "@/lib/shiny-maker/local";
import { MakerShell } from "@/components/tools/shiny-maker/MakerShell";

/**
 * /tools/shiny-maker?d=…: the Shiny Pokémon Maker; a design link opens that design, with its own preview card. In
 * another language the page sends that language's Pokémon and part names along.
 */

type Query = { d?: string | string[] };
const PATH = "/tools/shiny-maker";
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ searchParams }: { searchParams: Promise<Query> }): Promise<Metadata> {
  const t = await getT(tools);
  const raw = one((await searchParams).d);
  const d = decodeDesign(raw);
  const base = { title: t("maker.metaTitle"), description: t("maker.metaDescription"), path: PATH, image: { url: `${PATH}/og`, alt: t("maker.title") } };
  if (!d || !raw) return pageMetadata(base);
  const locale = getLocale();
  const pokemon = (locale === "en" ? speciesName(d.id) : speciesNameIn(d.id, locale)) ?? "Pokémon";
  const title = t("maker.metaDesignTitle", { name: d.name || t("maker.title"), pokemon });
  const meta = pageMetadata({ ...base, title, description: t("maker.metaDesignDescription", { pokemon }), image: { url: `${PATH}/og?d=${raw}`, alt: t("maker.ogAlt", { pokemon }) } });
  return {
    ...meta,
    // A shared link keeps its design (the card's link), while the canonical page stays the maker itself; designs are
    // shared, not indexed one by one.
    openGraph: { ...meta.openGraph, url: `${PATH}?d=${raw}` },
    robots: { index: false, follow: true },
  };
}

export default async function Page({ searchParams }: { searchParams: Promise<Query> }) {
  const raw = one((await searchParams).d);
  const d = decodeDesign(raw);
  const locale = getLocale();
  if (locale === "en") return <MakerShell initial={d} linkBroken={!!raw && !d} />;
  return (
    <ClientMessages namespaces={[tools]}>
      <MakerShell initial={d} linkBroken={!!raw && !d} local={shinyLocal(locale)} />
    </ClientMessages>
  );
}
