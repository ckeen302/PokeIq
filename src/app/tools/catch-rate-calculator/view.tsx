import type { Metadata } from "next";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { getLocale, getT, serverT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import page from "@/messages/catch-rate-page";
import calc from "@/messages/catch-rate";
import maker from "@/messages/pokeball-maker";
import tools from "@/messages/tools";
import { BALLS, type BallId } from "@/lib/catch-rate/formula";
import { decodeInputs, encodeInputs, hasInputs, type Inputs } from "@/lib/catch-rate/link";
import { rank } from "@/lib/catch-rate/rank";
import { toolJsonLd } from "@/lib/tier-list/seo";
import { shinyLocal } from "@/lib/shiny-maker/local";
import { pct } from "@/components/tools/catch-rate/format";
import { CatchRateShell } from "@/components/tools/catch-rate/CatchRateShell";
import { ballCss } from "@/lib/pokeball-maker/css";
import { ballPreset } from "@/lib/pokeball-maker/presets";

/**
 * The Catch Rate Calculator's page, for its two routes: /tools/catch-rate-calculator itself (static, page.tsx) and a
 * shared encounter, /tools/catch-rate-calculator?p=…, which next.config rewrites to ./shared: it opens with those
 * inputs, its own title and its own preview card. The calculator renders on the server too (its maths is plain and
 * synchronous), so the page's HTML already holds the ranking; the explainer is server-only. In another language the
 * page sends that language's Pokémon names along, and the balls' names come from the Poké Ball Maker's translations.
 */

export type Query = Record<string, string | string[] | undefined>;
const PATH = "/tools/catch-rate-calculator";

function shared(q: Query | null): Inputs | null {
  return q && hasInputs(q) ? decodeInputs(q) : null;
}

export async function catchRateMetadata(q: Query | null): Promise<Metadata> {
  const t = await getT(page);
  const base = { title: t("metaTitle"), description: t("metaDescription"), path: PATH, image: { url: `${PATH}/og`, alt: t("title") } };
  const i = shared(q);
  if (!i) return pageMetadata(base);
  const locale = getLocale();
  const r = rank(i);
  const name = locale === "en" ? r.species.name : (shinyLocal(locale).names[r.species.id] ?? r.species.name);
  const ball = (await getT(maker))(`balls.${r.best.ball}` as "balls.poke");
  const query = encodeInputs(i);
  const meta = pageMetadata({
    ...base,
    title: t("metaSharedTitle", { name, pct: pct(r.best.chance, locale), ball }),
    description: t("metaSharedDescription", { name }),
    image: { url: `${PATH}/og?${query}`, alt: t("ogAlt") },
  });
  return {
    ...meta,
    // A shared link keeps its encounter (the card's link), while the canonical page stays the calculator itself.
    openGraph: { ...meta.openGraph, url: `${PATH}?${query}` },
    robots: { index: false, follow: true },
  };
}

/** The formula, as the games publish it (symbols, not words, in every language), on a little game screen. */
function Formula({ children }: { children: string }) {
  return (
    <pre className="dark-scope mt-3 overflow-x-auto rounded-2xl border border-white/[0.08] bg-[linear-gradient(180deg,#17143a,#0f0d26)] px-4 py-3.5 font-mono text-[13.5px] leading-relaxed text-[#e9e6ff] shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_14px_30px_-22px_rgb(0_0_0/0.8)] max-sm:text-[12.5px]">
      <code>{children}</code>
    </pre>
  );
}

/** A heading with a small ball beside it (the Poké Ball Maker's flat CSS ball). */
function Heading({ ball, children }: { ball: BallId; children: string }) {
  return (
    <h3 className="flex items-center gap-2.5 text-[16px] font-semibold">
      <span className="inline-block h-5 w-5 shrink-0 rounded-full border border-black/50" style={{ background: ballCss(ballPreset(ball)), boxShadow: "inset -2px -3px 4px rgb(0 0 0 / 0.3)" }} aria-hidden />
      {children}
    </h3>
  );
}

function Explainer() {
  const t = serverT(page);
  const parts = [
    ["hpTitle", "hp", "poke"],
    ["statusTitle", "status", "dream"],
    ["levelTitle", "level", "nest"],
    ["ballsTitle", "balls", "ultra"],
    ["powerTitle", "power", "quick"],
  ] as const;
  const card = "rounded-[24px] border border-foreground/[0.08] bg-card p-5 shadow-[0_20px_50px_-40px_hsl(var(--shade)/0.7)] sm:p-6";
  return (
    <section className="mx-auto mt-16 max-sm:mt-12" aria-labelledby="cr-how" data-testid="cr-explainer">
      <h2 id="cr-how" className="font-display text-[28px] font-bold tracking-tight max-sm:text-[24px]">
        {t("explain.title")}
      </h2>
      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className={card}>
            <p className="text-[14.5px] leading-relaxed text-muted-foreground">{t("explain.intro")}</p>
            <Formula>{"a = (3 × MaxHP − 2 × HP) × Rate × Ball\n    ÷ (3 × MaxHP) × Status × Bonus"}</Formula>
            <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">{t("explain.legend")}</p>
          </div>
          <div className={card}>
            <Heading ball="timer">{t("explain.shakeTitle")}</Heading>
            <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">{t("explain.shake")}</p>
            <Formula>{"b = 65536 ÷ (255 ÷ a)^(3/16)\nP(catch) = (b ÷ 65536)⁴ ≈ (a ÷ 255)^(3/4)"}</Formula>
            <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">{t("explain.shakeGens")}</p>
          </div>
          <div className={card}>
            <Heading ball="master">{t("explain.critTitle")}</Heading>
            <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">{t("explain.crit")}</p>
            <Formula>{"P(catch) = c × (b ÷ 65536) + (1 − c) × (b ÷ 65536)⁴\nc = ⌊a × P × Charm ÷ 6⌋ ÷ 256"}</Formula>
          </div>
        </div>
        <div className="space-y-4">
          {parts.map(([title, body, ball]) => (
            <div key={body} className={card}>
              <Heading ball={ball}>{t(`explain.${title}`)}</Heading>
              <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">{t(`explain.${body}`)}</p>
            </div>
          ))}
          <div className="rounded-[24px] border border-dashed border-foreground/[0.14] p-5 sm:p-6">
            <h3 className="text-[15px] font-semibold">{t("explain.leftTitle")}</h3>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">{t("explain.left")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function CatchRateView({ query }: { query: Query | null }) {
  const locale = getLocale();
  const t = serverT(page);
  const tm = serverT(maker);
  const ballNames = Object.fromEntries([...BALLS, "premier", "luxury", "heal"].map((b) => [b, tm(`balls.${b}` as "balls.poke")])) as Record<BallId, string>;
  const ld = jsonLd(
    toolJsonLd({
      name: t("title"),
      path: PATH,
      description: t("metaDescription"),
      features: ["Catch chance for every Poké Ball", "Ranked results", "Expected throws", "Generation 3 to 9 formulas", "HP, status, level and turn", "Critical captures", "Badges and capture powers", "Throw preview", "Share links"],
      crumbs: { tools: serverT(tools)("hub.title"), maker: t("title") },
      ...(locale !== "en" && { locale }),
    })
  );
  const local = locale === "en" ? null : shinyLocal(locale);
  return (
    <div className="mx-auto max-w-6xl" data-testid="catch-rate-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      <header className="space-y-1.5 pt-1 max-sm:pt-0">
        <h1 className="font-display text-[44px] font-bold leading-[1.05] tracking-tight max-sm:text-[32px]">{t("title")}</h1>
        <p className="max-w-3xl text-[16px] text-muted-foreground max-sm:text-[14.5px]">{t("subtitle")}</p>
      </header>
      <ClientMessages namespaces={[calc]}>
        <CatchRateShell initial={shared(query)} ballNames={ballNames} {...(local && { names: local.names, alt: local.alt })} />
      </ClientMessages>
      <Explainer />
      <p className="mt-12 text-center text-[12px] leading-relaxed text-muted-foreground/70">{t("credit")}</p>
    </div>
  );
}
