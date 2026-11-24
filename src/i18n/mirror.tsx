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
export function mirrorPage(route: string, source: Source, { openParams = false, image }: { openParams?: boolean; image?: ShareImage } = {}) {
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
      return withShareImage(localizeMetadata(meta, locale), locale, image, await props.params, parent);
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
}

/**
 * The /<lang>/<path>/share-image route handler (src/app/[locale]/**\/share-image/route.locale.ts, see
 * scripts/i18n/mirror.mjs): the English route's own drawing, given the language in its params (lib/og/i18n reads it
 * there: an image route renders outside React, so `enterLocale` can't carry it). Drawn on request.
 */
export function mirrorImageRoute(source: ImageSource) {
  return async function GET(_request: Request, context: { params: Promise<Params> }): Promise<Response> {
    const params = await context.params;
    if (!isLiveLocale(params?.locale)) notFound();
    return (await source.default({ params: Promise.resolve(params) } as never)) as Response;
  };
}

/** The share image a mirrored page or layout shows: the English route (pattern) of its image and its og-alt key. */
export interface ShareImage {
  route: string;
  alt: string;
}

/** An English share-image URL ("/battle/opengraph-image", "/opengraph-image?…") as its folder ("/battle", ""), or null. */
function imageFolder(url: unknown): string | null {
  const href = typeof url === "string" ? url : url instanceof URL ? url.pathname : null;
  const m = href ? /^(\/[^?#]*?)?\/opengraph-image(?:[?#].*)?$/.exec(href) : null;
  return m ? (m[1] ?? "") : null;
}

const shareImageUrl = (locale: Locale, folder: string) => `/${locale}${folder === "/" ? "" : folder}/share-image`;

type OgImage = { url: string | URL; alt?: string; width?: number | string; height?: number | string; type?: string };

/**
 * A page's share image in its language. The language's pages have no image files of their own (see mirrorImageRoute),
 * so every one names its image here: a site card the English page names (SHARE_IMAGES, "/leaderboard/opengraph-image")
 * becomes the language's copy of it, and a page that names none gets the language's copy of the image its English page
 * shows (its folder's, or the nearest one above). Another image (a card scan, a set logo) stays as it is.
 */
async function withShareImage(meta: Metadata, locale: Locale, image: ShareImage | undefined, params: Params, parent: ResolvingMetadata): Promise<Metadata> {
  const t = await getT(ogAlt, locale);
  const altOf = (key: string, fallback?: string) => (t.has(key) ? t(key as never) : fallback);
  const localized = (img: OgImage): OgImage => {
    const folder = imageFolder(img.url);
    if (folder === null) return img;
    const key = folder.replace(/^\//, "").replace(/[^A-Za-z0-9]+/g, "_") || "home";
    return { ...img, url: shareImageUrl(locale, folder || "/"), alt: altOf(key, img.alt) };
  };
  const list = (images: unknown): OgImage[] | null =>
    images === undefined ? null : (Array.isArray(images) ? images : [images]).map((i) => (typeof i === "string" || i instanceof URL ? { url: i } : (i as OgImage)));

  const named = list(meta.openGraph?.images) ?? list(meta.twitter?.images);
  let images: OgImage[] | null = named ? named.map(localized) : null;
  if (!images && image) {
    images = [{ url: shareImageUrl(locale, fill(image.route, params)), alt: altOf(image.alt), width: 1200, height: 630, type: "image/png" }];
  }
  if (!images) return meta;
  // A page without Open Graph or Twitter fields of its own keeps its layout's, with this image.
  const from = meta.openGraph && meta.twitter ? null : await parent;
  const openGraph = meta.openGraph ?? (from?.openGraph as Metadata["openGraph"]) ?? {};
  const twitter = meta.twitter ?? (from?.twitter as Metadata["twitter"]) ?? {};
  return { ...meta, openGraph: { ...openGraph, images }, twitter: { ...twitter, images } as Metadata["twitter"] };
}

/** A mirrored layout's metadata: the English layout's, pointed at the language's URL. */
export function mirrorMetadata(source: Pick<Source, "metadata" | "generateMetadata">, image?: ShareImage) {
  return async function generateMetadata(props: { params: Promise<{ locale: string }> }, parent: ResolvingMetadata): Promise<Metadata> {
    const params = await props.params;
    const { locale } = params;
    if (!isLiveLocale(locale)) return {};
    await enterLocale(locale);
    const meta = source.generateMetadata ? await source.generateMetadata(props as never, parent) : (source.metadata ?? {});
    return withShareImage(localizeMetadata(meta, locale), locale, image, params, parent);
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
