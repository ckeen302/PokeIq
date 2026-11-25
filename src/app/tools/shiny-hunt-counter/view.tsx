/* eslint-disable @next/next/no-img-element -- a shared hunt's one shiny picture, from PokéAPI's sprites */
import type { Metadata } from "next";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { getLocale, getT, serverT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import { localeHref } from "@/i18n/href";
import page from "@/messages/shiny-counter-page";
import counter from "@/messages/shiny-counter";
import tools from "@/messages/tools";
import { toolJsonLd } from "@/lib/tier-list/seo";
import { speciesNameIn } from "@/lib/shiny-maker/local";
import { huntLocal } from "@/lib/shiny-hunt/local";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { homeRenderUrl } from "@/lib/pokemon/art";
import { decodeHunt, foundDate, type SharedHunt } from "@/lib/shiny-hunt/share";
import { shinyChance } from "@/lib/shiny-hunt/odds";
import { clock, oneIn } from "@/lib/shiny-hunt/math";
import { INTL_LOCALE, formatNumber } from "@/i18n/format";
import type { Locale } from "@/i18n/config";
import { CounterShell } from "@/components/tools/shiny-hunt/CounterShell";

/**
 * The Shiny Hunt Counter's page, for its two routes: /tools/shiny-hunt-counter itself (static, page.tsx) and a shared
 * hunt, /tools/shiny-hunt-counter?d=…, which next.config rewrites to ./shared: the hunt shows above the counter, with
 * its own title and preview card. The how-to is in the page's HTML; the counter runs in the browser. In another
 * language the page sends that language's Pokémon names along.
 */

export type Query = { d?: string | string[] };
export const PATH = "/tools/shiny-hunt-counter";
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function pokemonName(id: number, locale: Locale): string {
  return (locale === "en" ? getPokemon(id)?.name : speciesNameIn(id, locale)) ?? "Pokémon";
}

export async function shinyCounterMetadata(raw: string | undefined): Promise<Metadata> {
  const t = await getT(page);
  const base = { title: t("metaTitle"), description: t("metaDescription"), path: PATH, image: { url: `${PATH}/og`, alt: t("ogAlt") } };
  const h = decodeHunt(raw);
  if (!h || !raw) return pageMetadata(base);
  const locale = getLocale();
  const pokemon = pokemonName(h.species, locale);
  const n = formatNumber(h.count, locale);
  const meta = pageMetadata({
    ...base,
    title: h.found ? t("metaSharedFound", { pokemon, n }) : t("metaSharedHunting", { pokemon, n }),
    description: t("metaSharedDescription"),
    image: { url: `${PATH}/og?d=${raw}`, alt: t("ogAlt") },
  });
  return {
    ...meta,
    // A shared link keeps its hunt (the card's link), while the canonical page stays the counter itself.
    openGraph: { ...meta.openGraph, url: `${PATH}?d=${raw}` },
    robots: { index: false, follow: true },
  };
}

function HowItWorks() {
  const t = serverT(page);
  const steps = [1, 2, 3, 4] as const;
  return (
    <section className="mt-16 max-w-5xl max-sm:mt-12" aria-labelledby="sh-how">
      <h2 id="sh-how" className="font-display text-2xl font-semibold tracking-tight">{t("howto.title")}</h2>
      <ol className="mt-6 grid gap-x-10 gap-y-7 md:grid-cols-2">
        {steps.map((s) => (
          <li key={s} className="flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-[15px] font-semibold text-primary" aria-hidden>{s}</span>
            <div>
              <h3 className="text-[16px] font-semibold">{t(`howto.s${s}t`)}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{t(`howto.s${s}`)}</p>
            </div>
          </li>
        ))}
      </ol>
      <h3 className="mt-10 text-[16px] font-semibold">{t("howto.oddsTitle")}</h3>
      <p className="mt-1.5 max-w-3xl text-[15px] leading-relaxed text-muted-foreground">{t("howto.odds")}</p>
      <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-muted-foreground">{t("howto.privacy")}</p>
    </section>
  );
}

/** A shared hunt, drawn on the server from the link alone. */
function SharedCard({ h }: { h: SharedHunt }) {
  const t = serverT(page);
  const c = serverT(counter);
  const locale = getLocale();
  const pokemon = pokemonName(h.species, locale);
  const p = shinyChance(h.game, h.method, h);
  const stats = [
    { label: t("shared.encounters"), value: formatNumber(h.count, locale) },
    { label: t("shared.odds"), value: t("shared.oddsValue", { n: formatNumber(oneIn(p), locale) }) },
    { label: t("shared.time"), value: clock(h.minutes * 60_000) },
    ...(h.phases ? [{ label: t("shared.phases"), value: formatNumber(h.phases, locale) }] : []),
    ...(h.found ? [{ label: t("shared.date"), value: new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: "medium", timeZone: "UTC" }).format(foundDate(h.found)) }] : []),
  ];
  return (
    <section className="relative mt-6 overflow-hidden rounded-[28px] border border-[hsl(var(--warning)/0.35)] bg-[radial-gradient(60%_80%_at_20%_40%,hsl(var(--warning)/0.16),transparent_70%),hsl(var(--card))] p-5 sm:p-7" data-testid="sh-shared">
      <div className="flex items-center gap-5 max-sm:flex-col max-sm:items-start">
        <img src={homeRenderUrl(h.species, true)} alt={c("counter.shinyAlt", { name: pokemon })} width={160} height={160} className="h-40 w-40 shrink-0 object-contain drop-shadow-[0_14px_18px_hsl(var(--shade)/0.35)] max-sm:h-32 max-sm:w-32" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold uppercase tracking-[0.2em] text-[hsl(var(--warning))]">{h.found ? t("shared.found") : t("shared.hunting")}</p>
          <h2 className="mt-1 font-display text-[30px] font-bold leading-tight tracking-tight sm:text-[36px]">{h.found ? t("shared.headlineFound", { pokemon }) : t("shared.headlineHunting", { pokemon })}</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">
            {c(`games.${h.game}`)} · {c(`methods.${h.method}`)}
          </p>
          <dl className="mt-4 flex flex-wrap gap-2">
            {stats.map((s) => (
              <div key={s.label} className="rounded-2xl bg-foreground/[0.05] px-3.5 py-2">
                <dt className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">{s.label}</dt>
                <dd className="font-display text-[18px] font-bold [font-variant-numeric:tabular-nums]">{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <a href={localeHref(PATH, locale).href} className="mt-5 inline-flex h-11 items-center rounded-full bg-primary px-5 text-[14px] font-semibold text-primary-foreground transition-[filter] hover:brightness-110">
        {t("shared.cta")}
      </a>
    </section>
  );
}

export function ShinyCounterView({ raw }: { raw: string | undefined }) {
  const locale = getLocale();
  const t = serverT(page);
  const shared = decodeHunt(raw);
  const ld = jsonLd(
    toolJsonLd({
      name: t("title"),
      path: PATH,
      description: t("metaDescription"),
      features: ["Shiny hunt counter", "Real shiny odds for every main game", "Shiny Charm, Masuda method, chain fishing, SOS chains, outbreaks, Sparkling Power", "Chance by now", "Encounters per hour", "Phases", "Trophy case", "Share cards"],
      crumbs: { tools: serverT(tools)("hub.title"), maker: t("title") },
      ...(locale !== "en" && { locale }),
    })
  );
  const local = locale === "en" ? undefined : huntLocal(locale);
  return (
    <div className="mx-auto max-w-6xl" data-testid="shiny-counter-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      <header className="space-y-2 pt-2 max-sm:pt-0">
        <h1 className="font-display text-5xl font-bold tracking-tight max-sm:text-[34px] max-sm:leading-tight">{t("title")}</h1>
        <p className="max-w-2xl text-[17px] text-muted-foreground max-sm:text-[15px]">{t("subtitle")}</p>
      </header>
      {shared && <SharedCard h={shared} />}
      {!shared && raw && <p className="mt-6 rounded-2xl bg-foreground/[0.05] px-4 py-3 text-[14px] text-muted-foreground">{t("shared.broken")}</p>}
      <ClientMessages namespaces={[counter]}>
        <CounterShell {...(local && { local })} />
      </ClientMessages>
      <HowItWorks />
      <p className="mt-12 text-center text-[12px] leading-relaxed text-muted-foreground/70">{t("credit")}</p>
    </div>
  );
}
