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
 * The Shiny Pokémon Maker's page, for its two routes: /tools/shiny-maker itself (static, page.tsx) and a design link,
 * /tools/shiny-maker?d=…, which next.config rewrites to ./shared: it opens that design, with its own preview card. In
 * another language the page sends that language's Pokémon and part names along.
 */

export type Query = { d?: string | string[] };
const PATH = "/tools/shiny-maker";
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function shinyMakerMetadata(raw: string | undefined): Promise<Metadata> {
  const t = await getT(tools);
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

export function ShinyMakerView({ raw }: { raw: string | undefined }) {
  const d = decodeDesign(raw);
  const locale = getLocale();
  if (locale === "en") return <MakerShell initial={d} linkBroken={!!raw && !d} />;
  return (
    <ClientMessages namespaces={[tools]}>
      <MakerShell initial={d} linkBroken={!!raw && !d} local={shinyLocal(locale)} />
    </ClientMessages>
  );
}
