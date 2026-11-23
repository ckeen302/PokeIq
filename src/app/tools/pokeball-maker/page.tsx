import type { Metadata } from "next";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { getLocale, getT, serverT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import page from "@/messages/pokeball-maker-page";
import maker from "@/messages/pokeball-maker";
import tools from "@/messages/tools";
import { decodeDesign } from "@/lib/pokeball-maker/design";
import { toolJsonLd } from "@/lib/tier-list/seo";
import { shinyLocal } from "@/lib/shiny-maker/local";
import { BallShell } from "@/components/tools/pokeball-maker/BallShell";
import { ShinyLocalContextProvider } from "@/components/tools/pokeball-maker/LocalProvider";

/**
 * /tools/pokeball-maker?d=…: the Poké Ball Maker. A design link opens that design, with its own preview card. In
 * another language the page sends that language's Pokémon names along (for the Pokémon picker).
 */

type Query = { d?: string | string[] };
const PATH = "/tools/pokeball-maker";
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ searchParams }: { searchParams: Promise<Query> }): Promise<Metadata> {
  const t = await getT(page);
  const raw = one((await searchParams).d);
  const d = decodeDesign(raw);
  const base = { title: t("metaTitle"), description: t("metaDescription"), path: PATH, image: { url: `${PATH}/og`, alt: t("title") } };
  if (!d || !raw) return pageMetadata(base);
  const meta = pageMetadata({ ...base, title: d.name ? t("metaDesignTitle", { name: d.name }) : t("metaTitle"), description: t("metaDesignDescription"), image: { url: `${PATH}/og?d=${raw}`, alt: t("ogAlt") } });
  return {
    ...meta,
    // A shared link keeps its design (the card's link), while the canonical page stays the maker itself.
    openGraph: { ...meta.openGraph, url: `${PATH}?d=${raw}` },
    robots: { index: false, follow: true },
  };
}

function HowItWorks() {
  const t = serverT(page);
  const steps = [1, 2, 3, 4] as const;
  return (
    <section className="mx-auto mt-16 max-w-5xl max-sm:mt-12" aria-labelledby="pbm-how">
      <h2 id="pbm-how" className="font-display text-2xl font-semibold tracking-tight">{t("howto.title")}</h2>
      <ol className="mt-6 grid gap-x-10 gap-y-7 md:grid-cols-2">
        {steps.map((n) => (
          <li key={n} className="flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-[15px] font-semibold text-primary" aria-hidden>{n}</span>
            <div>
              <h3 className="text-[16px] font-semibold">{t(`howto.s${n}t`)}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{t(`howto.s${n}`)}</p>
            </div>
          </li>
        ))}
      </ol>
      <h3 className="mt-10 text-[16px] font-semibold">{t("howto.printTitle")}</h3>
      <p className="mt-1.5 max-w-3xl text-[15px] leading-relaxed text-muted-foreground">{t("howto.print")}</p>
    </section>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<Query> }) {
  const raw = one((await searchParams).d);
  const d = decodeDesign(raw);
  const locale = getLocale();
  const t = serverT(page);
  const ld = jsonLd(toolJsonLd({ name: t("title"), path: PATH, description: t("metaDescription"), features: ["Official ball presets", "Type themes", "Patterns", "Finishes", "Stickers", "Opening effects", "PNG, GIF and MP4 downloads", "GLB and STL downloads", "Share links"], crumbs: { tools: serverT(tools)("hub.title"), maker: t("title") }, ...(locale !== "en" && { locale }) }));
  const shell = <BallShell initial={d} linkBroken={!!raw && !d} />;
  return (
    <div data-testid="pokeball-maker-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      {locale === "en" ? shell : (
        <ClientMessages namespaces={[maker, tools]}>
          <ShinyLocalContextProvider value={shinyLocal(locale)}>{shell}</ShinyLocalContextProvider>
        </ClientMessages>
      )}
      <HowItWorks />
    </div>
  );
}
