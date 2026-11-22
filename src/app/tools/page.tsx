/* eslint-disable @next/next/no-img-element -- a tiny pixel-art picture scaled with crisp pixels, and the tier list card's small renders */
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import Link from "@/components/ui/Link";
import { pageMetadata } from "@/lib/seo";
import { getT } from "@/i18n/server";
import tools from "@/messages/tools";
import tierList from "@/messages/tier-list";
import { serverT } from "@/i18n/server";
import { hex } from "@/lib/shiny-maker/color";
import { DEFAULT_ID, firstDesign } from "@/lib/shiny-maker/presets";
import { partSwatch } from "@/lib/shiny-maker/recolor";
import { readSpecies } from "@/lib/shiny-maker/server";

/** /tools: the Tools tab: the Shiny Pokémon Maker and the Pokémon Tier List Maker. */

/** The tier list card's picture: three tiers with a few favourites (the site's own renders). */
const TIERS: { label: string; color: string; ids: number[] }[] = [
  { label: "S", color: "#f25f7d", ids: [6, 448, 658] },
  { label: "A", color: "#f7954a", ids: [25, 149, 197, 1000] },
  { label: "B", color: "#f6c94a", ids: [133, 54] },
];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(tools);
  return pageMetadata({ title: t("hub.metaTitle"), description: t("hub.metaDescription"), path: "/tools", image: { url: "/tools/shiny-maker/og", alt: t("maker.title") } });
}

export default async function ToolsPage() {
  const t = await getT(tools);
  const tl = serverT(tierList);
  const sp = await readSpecies(DEFAULT_ID).catch(() => null);
  const d = sp ? firstDesign(sp) : null;
  const dots = sp && d ? sp.parts.map((p, i) => (p.o ? null : hex(partSwatch(sp, d, i)))).filter((c): c is string => !!c) : [];
  const scale = sp ? Math.max(2, Math.floor(300 / Math.max(sp.w, sp.h))) : 3;
  return (
    <div className="mx-auto max-w-5xl pt-4 max-sm:pt-0" data-testid="tools-page">
      <h1 className="font-display text-5xl font-bold uppercase tracking-tight sm:text-6xl">{t("hub.title")}</h1>

      <Link
        href="/tools/shiny-maker"
        className="dark-scope group mt-10 grid overflow-hidden rounded-[28px] border border-white/[0.07] bg-[hsl(248_30%_9%)] transition-colors hover:border-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:mt-6 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]"
        data-testid="tool-card-shiny-maker"
      >
        <div className="relative flex h-[400px] items-center justify-center overflow-hidden max-sm:h-[300px]" style={{ background: "radial-gradient(70% 60% at 50% 48%, hsl(250 40% 14% / 0.65), transparent 75%), linear-gradient(180deg, hsl(248 34% 9%), hsl(248 36% 6%))" }}>
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-[90%] w-[90%] -translate-x-1/2 -translate-y-1/2" style={{ background: "radial-gradient(closest-side, hsl(24 95% 58% / 0.24), hsl(24 95% 58% / 0.08) 55%, transparent)", filter: "blur(8px)" }} aria-hidden />
          {sp && (
            <img
              src="/shiny-maker/hub.png"
              alt=""
              width={sp.w * scale}
              height={sp.h * scale}
              className="relative transition-transform duration-500 [image-rendering:pixelated] group-hover:scale-[1.03] max-sm:scale-[0.78] max-sm:group-hover:scale-[0.8] motion-reduce:transition-none"
            />
          )}
        </div>
        <div className="flex flex-col justify-center gap-5 p-10 max-sm:p-6">
          <h2 className="font-display text-[34px] font-semibold leading-tight tracking-tight max-sm:text-[26px]">{t("maker.title")}</h2>
          <p className="-mt-2 text-[17px] text-muted-foreground">{t("maker.subtitle")}</p>
          <div className="flex gap-2" aria-hidden>
            {dots.map((c, i) => (
              <span key={i} className="inline-block h-4 w-4 rounded-full" style={{ background: `radial-gradient(circle at 32% 28%, rgb(255 255 255 / 0.28), transparent 55%), ${c}`, boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.14), 0 1px 2px rgb(0 0 0 / 0.5)" }} />
            ))}
          </div>
          <span className="mt-3 inline-flex h-11 w-fit items-center gap-2 rounded-full bg-primary px-6 font-display text-sm font-semibold uppercase tracking-wider text-primary-foreground">
            {t("hub.open")} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </div>
      </Link>

      <Link
        href="/tools/tier-list"
        className="dark-scope group mt-6 grid overflow-hidden rounded-[28px] border border-white/[0.07] bg-[hsl(248_30%_9%)] transition-colors hover:border-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:mt-4 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]"
        data-testid="tool-card-tier-list"
      >
        <div className="relative flex h-[400px] items-center justify-center overflow-hidden px-10 max-sm:h-[300px] max-sm:px-5" style={{ background: "radial-gradient(70% 60% at 50% 48%, hsl(250 40% 14% / 0.65), transparent 75%), linear-gradient(180deg, hsl(248 34% 9%), hsl(248 36% 6%))" }}>
          <div className="w-full max-w-[460px] space-y-2 transition-transform duration-500 group-hover:scale-[1.02] motion-reduce:transition-none" aria-hidden>
            {TIERS.map((row) => (
              <div key={row.label} className="flex h-[84px] overflow-hidden rounded-2xl bg-white/[0.04] max-sm:h-[64px]">
                <div className="flex w-[72px] shrink-0 items-center justify-center font-display text-[30px] font-bold text-[#16131f] max-sm:w-[54px] max-sm:text-2xl" style={{ background: row.color }}>
                  {row.label}
                </div>
                <div className="flex items-center gap-1.5 px-2">
                  {row.ids.map((id) => (
                    <img key={id} src={`/sizes/art/256/${id}.webp`} alt="" width={72} height={72} loading="lazy" className="h-[72px] w-[72px] rounded-xl bg-white/[0.05] object-contain p-1 max-sm:h-[52px] max-sm:w-[52px]" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col justify-center gap-5 p-10 max-sm:p-6">
          <h2 className="font-display text-[34px] font-semibold leading-tight tracking-tight max-sm:text-[26px]">{tl("card.title")}</h2>
          <p className="-mt-2 text-[17px] text-muted-foreground">{tl("card.subtitle")}</p>
          <span className="mt-3 inline-flex h-11 w-fit items-center gap-2 rounded-full bg-primary px-6 font-display text-sm font-semibold uppercase tracking-wider text-primary-foreground">
            {t("hub.open")} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </div>
      </Link>
    </div>
  );
}
