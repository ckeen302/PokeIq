import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
import { enterLocale } from "./server";
import { isLiveLocale, type Locale } from "./config";
import { localizeMetadata } from "./metadata";
import { isPageLive } from "./routes";

type Params = Record<string, string | string[] | undefined>;
interface Props {
  params: Promise<Params & { locale: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/** An English page module, as app/[locale]'s mirror of it imports it. */
interface Source {
  default: ComponentType<never>;
  metadata?: Metadata;
  generateMetadata?: (props: never, parent: ResolvingMetadata) => Metadata | Promise<Metadata>;
  generateStaticParams?: (args: { params: Params }) => Params[] | Promise<Params[]>;
}

/** "/pokemon/[slug]" with { slug: "pikachu" } → "/pokemon/pikachu". */
function fill(route: string, params: Params): string {
  return route.replace(/\[\[?(?:\.\.\.)?([^\]]+)\]\]?/g, (_, key: string) => {
    const v = params[key];
    return Array.isArray(v) ? v.join("/") : (v ?? "");
  }).replace(/\/+$/, "") || "/";
}

/**
 * The /<lang>/ version of an English page (src/app/[locale] holds one generated file per page, see
 * scripts/i18n/mirror.mjs): the same component and data, served only where the page is live in that language,
 * with its metadata pointed at the language's own URL. `openParams`: the English page renders params it doesn't
 * list in generateStaticParams (dynamicParams = true), so they aren't checked against that list.
 */
export function mirrorPage(route: string, source: Source, { openParams = false }: { openParams?: boolean } = {}) {
  // Unknown params 404 like the English page's own (whose generateStaticParams lists every valid one).
  let valid: Promise<Set<string>> | null = null;
  const validPaths = () =>
    (valid ??= Promise.resolve(source.generateStaticParams?.({ params: {} }) ?? []).then((list) => new Set(list.map((p) => fill(route, p)))));

  async function guard(props: Props): Promise<{ locale: Locale; path: string }> {
    const { locale, ...params } = await props.params;
    const path = fill(route, params);
    if (!isLiveLocale(locale) || !isPageLive(path, locale)) notFound();
    if (!openParams && source.generateStaticParams && route.includes("[") && !(await validPaths()).has(path)) notFound();
    await enterLocale(locale);
    return { locale, path };
  }

  return {
    async generateStaticParams({ params }: { params: { locale: string } }): Promise<Params[]> {
      const list = source.generateStaticParams ? await source.generateStaticParams({ params: {} }) : [{}];
      return list.filter((p) => isLiveLocale(params.locale) && isPageLive(fill(route, p), params.locale as Locale));
    },
    async generateMetadata(props: Props, parent: ResolvingMetadata): Promise<Metadata> {
      const { locale } = await guard(props);
      const meta = source.generateMetadata ? await source.generateMetadata(props as never, parent) : (source.metadata ?? {});
      return localizeMetadata(meta, locale);
    },
    Page: async function LocalePage(props: Props) {
      await guard(props);
      const Component = source.default as ComponentType<Props>;
      return <Component {...props} />;
    },
  };
}

/** A mirrored layout's metadata: the English layout's, pointed at the language's URL. */
export function mirrorMetadata(source: Pick<Source, "metadata" | "generateMetadata">) {
  return async function generateMetadata(props: { params: Promise<{ locale: string }> }, parent: ResolvingMetadata): Promise<Metadata> {
    const { locale } = await props.params;
    if (!isLiveLocale(locale)) return {};
    await enterLocale(locale);
    const meta = source.generateMetadata ? await source.generateMetadata(props as never, parent) : (source.metadata ?? {});
    return localizeMetadata(meta, locale);
  };
}

/**
 * A mirrored layout: the English layout's component, rendered in the language (a layout renders apart from its page,
 * so it sets the render's language itself before its server components read it).
 */
export function mirrorLayout(source: { default: ComponentType<never> }) {
  return async function LocaleLayout(props: { params: Promise<{ locale: string }>; children: ReactNode }) {
    const { locale } = await props.params;
    if (!isLiveLocale(locale)) notFound();
    await enterLocale(locale);
    const Component = source.default as ComponentType<typeof props>;
    return <Component {...props} />;
  };
}
