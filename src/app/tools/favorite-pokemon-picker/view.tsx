import type { Metadata } from "next";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { getLocale, getT, serverT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import page from "@/messages/favorite-picker-page";
import picker from "@/messages/favorite-picker";
import tools from "@/messages/tools";
import { decodeResult } from "@/lib/favorite-picker/link";
import { BRACKET_MAX, KEEP } from "@/lib/favorite-picker/run";
import { resolveShared } from "@/lib/favorite-picker/server";
import { toolJsonLd } from "@/lib/tier-list/seo";
import { tierListLocal } from "@/lib/tier-list/local";
import { ROSTER_JSON_VERSION } from "@/lib/tier-list/version";
import { PickerShell } from "@/components/tools/favorite-picker/PickerShell";

/**
 * The Favorite Pokémon Picker's page, for its two routes: /tools/favorite-pokemon-picker itself (static, page.tsx) and
 * a shared result, /tools/favorite-pokemon-picker?d=…, which next.config rewrites to ./shared: it opens that result,
 * with its own title and preview card. The how-to is in the page's HTML; the picker itself runs in the browser. In
 * another language the page sends that language's Pokémon names along.
 */

export type Query = { d?: string | string[] };
const PATH = "/tools/favorite-pokemon-picker";
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function favoritePickerMetadata(raw: string | undefined): Promise<Metadata> {
  const t = await getT(page);
  const base = { title: t("metaTitle"), description: t("metaDescription"), path: PATH, image: { url: `${PATH}/og`, alt: t("title") } };
  const shared = decodeResult(raw);
  if (!shared || !raw) return pageMetadata(base);
  const r = resolveShared(shared, getLocale());
  const chart = r.chartFirst;
  const fav = r.top[0]?.mon.n;
  const meta = pageMetadata({
    ...base,
    title: !chart && fav ? t("metaSharedTitle", { name: fav }) : t("metaSharedChartTitle"),
    description: t("metaSharedDescription"),
    image: { url: `${PATH}/og?d=${raw}`, alt: chart ? t("ogChartAlt") : t("ogAlt") },
  });
  return {
    ...meta,
    // A shared link keeps its result (the card's link), while the canonical page stays the picker itself.
    openGraph: { ...meta.openGraph, url: `${PATH}?d=${raw}` },
    robots: { index: false, follow: true },
  };
}

function HowItWorks() {
  const t = serverT(page);
  const steps = [1, 2, 3, 4] as const;
  const n = { keep: KEEP, max: BRACKET_MAX };
  return (
    <section className="mx-auto mt-16 max-w-5xl max-sm:mt-12" aria-labelledby="fp-how">
      <h2 id="fp-how" className="font-display text-2xl font-semibold tracking-tight">{t("howto.title")}</h2>
      <ol className="mt-6 grid gap-x-10 gap-y-7 md:grid-cols-2">
        {steps.map((s) => (
          <li key={s} className="flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-[15px] font-semibold text-primary" aria-hidden>{s}</span>
            <div>
              <h3 className="text-[16px] font-semibold">{t(`howto.s${s}t`)}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{t(`howto.s${s}`, n)}</p>
            </div>
          </li>
        ))}
      </ol>
      <h3 className="mt-10 text-[16px] font-semibold">{t("howto.chartTitle")}</h3>
      <p className="mt-1.5 max-w-3xl text-[15px] leading-relaxed text-muted-foreground">{t("howto.chart")}</p>
    </section>
  );
}

export function FavoritePickerView({ raw }: { raw: string | undefined }) {
  const locale = getLocale();
  const t = serverT(page);
  const ld = jsonLd(
    toolJsonLd({
      name: t("title"),
      path: PATH,
      description: t("metaDescription"),
      features: ["Favorite Pokémon picker", "Head-to-head bracket", "Top 10", "Favorite Pokémon of every type chart", "Shiny sprites", "PNG downloads", "Share links"],
      crumbs: { tools: serverT(tools)("hub.title"), maker: t("title") },
      ...(locale !== "en" && { locale }),
    })
  );
  return (
    <div className="mx-auto max-w-5xl" data-testid="favorite-picker-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      <header className="space-y-2 pt-2 max-sm:pt-0">
        <h1 className="font-display text-5xl font-bold tracking-tight max-sm:text-[34px] max-sm:leading-tight">{t("title")}</h1>
        <p className="max-w-2xl text-[17px] text-muted-foreground max-sm:text-[15px]">{t("subtitle")}</p>
      </header>
      <ClientMessages namespaces={[picker]}>
        <PickerShell shared={raw ?? null} version={ROSTER_JSON_VERSION} {...(locale !== "en" && { local: tierListLocal(locale) })} />
      </ClientMessages>
      <HowItWorks />
      <p className="mt-12 text-center text-[12px] leading-relaxed text-muted-foreground/70">{t("credit")}</p>
    </div>
  );
}
