import { HAS_OTHER_LOCALES, LIVE_OTHER_LOCALES } from "@/i18n/config";
import { SITE_URL } from "@/lib/site";

// The sitemap index: one sitemap per live language (English's is /sitemap.xml). Only once a second language is live.
export const dynamic = "force-static";

export function GET() {
  if (!HAS_OTHER_LOCALES) return new Response("Not found", { status: 404 });
  const maps = [`${SITE_URL}/sitemap.xml`, ...LIVE_OTHER_LOCALES.map((l) => `${SITE_URL}/${l}/sitemap.xml`)];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${maps.map((m) => `<sitemap><loc>${m}</loc></sitemap>`).join("\n")}\n</sitemapindex>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml" } });
}
