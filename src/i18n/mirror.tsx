import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
import { enterLocale, getT } from "./server";
import ogAlt from "@/messages/og-alt";
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

/** An English share-image route (opengraph-image.tsx) as app/[locale]'s mirror of it imports it. */
interface ImageSource {
  default: (props: never) => unknown;
  alt?: string;
  size?: { width: number; height: number };
  contentType?: string;
}

/**
 * The /<lang>/ version of a share image (src/app/[locale]/**\/opengraph-image.locale.tsx, see scripts/i18n/mirror.mjs):
 * the English route's own drawing, given the language in its params (lib/og/i18n reads it there: an image route
 * renders outside React, so `enterLocale` can't carry it), and its alt text from og-alt under `altKey`. Next reads the
 * alt per request through generateImageMetadata (an English route's alt is a fixed export), so the language's image
 * sits one segment deeper: /<lang>/<path>/opengraph-image-<hash>/<lang>.
 */
export function mirrorImage(altKey: string, source: ImageSource) {
  return {
    async generateImageMetadata({ params }: { params: Params & { locale?: string } }) {
      const locale = params?.locale;
      if (!isLiveLocale(locale)) return [];
      const t = await getT(ogAlt, locale);
      const alt = t.has(altKey) ? t(altKey as never) : source.alt;
      return [{ id: locale, alt, size: source.size, contentType: source.contentType }];
    },
    async Image(props: { params: Params | Promise<Params>; id?: string }) {
      const params = await props.params;
      if (!isLiveLocale(params?.locale)) notFound();
      return source.default({ ...props, params } as never);
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
