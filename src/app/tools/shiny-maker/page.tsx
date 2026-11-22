import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { getT } from "@/i18n/server";
import tools from "@/messages/tools";
import { decodeDesign } from "@/lib/shiny-maker/design";
import { speciesName } from "@/lib/shiny-maker/server";
import { MakerShell } from "@/components/tools/shiny-maker/MakerShell";

/** /tools/shiny-maker?d=…: the Shiny Pokémon Maker; a design link opens that design, with its own preview card. */

type Query = { d?: string | string[] };
const PATH = "/tools/shiny-maker";
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ searchParams }: { searchParams: Promise<Query> }): Promise<Metadata> {
  const t = await getT(tools);
  const raw = one((await searchParams).d);
  const d = decodeDesign(raw);
  const base = { title: t("maker.metaTitle"), description: t("maker.metaDescription"), path: PATH, image: { url: `${PATH}/og`, alt: t("maker.title") } };
  if (!d || !raw) return pageMetadata(base);
  const pokemon = speciesName(d.id) ?? "Pokémon";
  const title = t("maker.metaDesignTitle", { name: d.name || t("maker.title"), pokemon });
  return {
    ...pageMetadata({ ...base, title, description: t("maker.metaDesignDescription", { pokemon }), image: { url: `${PATH}/og?d=${raw}`, alt: t("maker.ogAlt", { pokemon }) } }),
    // One canonical page; designs are shared, not indexed one by one.
    robots: { index: false, follow: true },
  };
}

export default async function Page({ searchParams }: { searchParams: Promise<Query> }) {
  const raw = one((await searchParams).d);
  const d = decodeDesign(raw);
  return <MakerShell initial={d} linkBroken={!!raw && !d} />;
}
