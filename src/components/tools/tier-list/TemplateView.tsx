import "server-only";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { serverT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import tierList from "@/messages/tier-list";
import { getTemplate } from "@/lib/tier-list/templates";
import { peekShare } from "@/lib/tier-list/share";
import { toolJsonLd } from "@/lib/tier-list/seo";
import { ROSTER_JSON_VERSION } from "@/lib/tier-list/version";
import { TierListShell } from "./TierListShell";
import { TemplateGrid } from "./TemplateGrid";
import { modeNoun, templateName, templateSeoName } from "./names";

/** The Tier List Maker's template page, shared by the static page and its shared-link twin (./shared). */

export type Params = { template: string };
export type Query = { s?: string | string[] };
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/** A template's title, description and card, or a shared result's (from its link alone, without the roster). */
export function templateMetadata(slug: string, raw: string | null): Metadata {
  const tpl = getTemplate(slug);
  if (!tpl) return {};
  const t = serverT(tierList);
  const path = `/tools/tier-list/${tpl.slug}`;
  const name = templateSeoName(t, tpl);
  const base = { title: t("templateTitle", { name }), description: t("templateDescription", { name }), path, image: { url: `${path}/og`, alt: t("templateTitle", { name }) } };
  const peek = peekShare(raw);
  if (!raw || !peek || peek.template !== tpl.slug) return pageMetadata(base);
  const title = peek.title || templateName(t, tpl);
  const meta = pageMetadata({
    ...base,
    title: t("sharedTitle", { title, mode: modeNoun(t, peek.mode, peek.topLength) }),
    description: t("sharedDescription"),
    image: { url: `${path}/og?s=${raw}`, alt: t("ogAlt", { title }) },
  });
  return { ...meta, openGraph: { ...meta.openGraph, url: `${path}?s=${raw}` }, robots: { index: false, follow: true } };
}

export function TemplateView({ slug, raw }: { slug: string; raw: string | null }) {
  const tpl = getTemplate(slug);
  if (!tpl) notFound();
  const t = serverT(tierList);
  const name = templateSeoName(t, tpl);
  const path = `/tools/tier-list/${tpl.slug}`;
  return (
    <div data-testid="tier-list-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(toolJsonLd({ name: t("templateTitle", { name }), path, description: t("templateDescription", { name }) })) }} />
      <h1 className="sr-only">{t("templateTitle", { name })}</h1>
      <ClientMessages namespaces={[tierList]}>
        <TierListShell key={tpl.slug} template={tpl.slug} shared={raw} version={ROSTER_JSON_VERSION} />
        <section className="mx-auto mt-16 max-w-5xl max-sm:mt-12" aria-labelledby="tl-more">
          <h2 id="tl-more" className="mb-5 font-display text-2xl font-semibold tracking-tight">{t("pick.heading")}</h2>
          <TemplateGrid current={tpl.slug} />
        </section>
      </ClientMessages>
      <p className="mt-12 text-center text-[12px] leading-relaxed text-muted-foreground/70">{t("credit")}</p>
    </div>
  );
}
