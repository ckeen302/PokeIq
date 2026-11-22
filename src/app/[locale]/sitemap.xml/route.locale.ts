import { LIVE_OTHER_LOCALES, isLiveLocale } from "@/i18n/config";
import { englishSitemap } from "@/lib/sitemap/entries";
import { sitemapXml, withAlternates } from "@/lib/sitemap/languages";

// One sitemap per live language besides English: the pages translated into it, with their hreflang sets.
export const revalidate = 86400;
export const dynamicParams = false;

export function generateStaticParams() {
  return LIVE_OTHER_LOCALES.map((locale) => ({ locale }));
}

export async function GET(_: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLiveLocale(locale) || locale === "en") return new Response("Not found", { status: 404 });
  return new Response(sitemapXml(withAlternates(await englishSitemap(), locale)), { headers: { "Content-Type": "application/xml" } });
}
