import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { enterLocale, serverT } from "@/i18n/server";
import { LIVE_OTHER_LOCALES, OG_LOCALES, type OtherLocale } from "@/i18n/config";
import { LocaleProvider } from "@/i18n/locale-context";
import { RouteSlot } from "@/components/layout/RouteSlot";
import { MAIN_CLASS } from "@/components/layout/RootChrome";
import { CHROME_NAMESPACES, ChromeAfter, ChromeBefore } from "@/components/layout/SiteChrome";
import { ClientMessages } from "@/i18n/ClientMessages";
import site from "@/messages/site";
import { SITE_NAME } from "@/lib/site";
import { JA_CSS } from "@/i18n/ja-style";
import { metadata as rootMetadata } from "@/app/layout";

/**
 * Every page in another language (/es/..., /ja/...): the root layout's <html> and <head> with this language's
 * header, <main> and footer. Only live languages (LIVE_LOCALES) are built; anything else under a code is a 404.
 * No dynamicParams here: a long-tail page in a language may render on first request (its own file decides).
 */
interface Props {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

function liveLocale(locale: string): OtherLocale | null {
  return (LIVE_OTHER_LOCALES as readonly string[]).includes(locale) ? (locale as OtherLocale) : null;
}

export function generateStaticParams() {
  return LIVE_OTHER_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = liveLocale((await params).locale);
  if (!locale) return {};
  await enterLocale(locale);
  const t = serverT(site);
  const title = `${SITE_NAME}: ${t("tagline")}`;
  // A segment's openGraph replaces its parent's whole object: the site's defaults, in this language.
  return {
    title: { default: title, template: `%s · ${SITE_NAME}` },
    description: t("description"),
    openGraph: { ...rootMetadata.openGraph, locale: OG_LOCALES[locale], title, description: t("description") },
    twitter: { ...rootMetadata.twitter, title, description: t("description") },
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const locale = liveLocale((await params).locale);
  if (!locale) notFound();
  await enterLocale(locale);
  return (
    <LocaleProvider locale={locale}>
      <ClientMessages namespaces={CHROME_NAMESPACES}>
      {/* Bing reads the page's language from this; Google from <html lang> and hreflang. */}
      <meta httpEquiv="content-language" content={locale} />
      {locale === "ja" && <style dangerouslySetInnerHTML={{ __html: JA_CSS }} />}
      <ChromeBefore locale={locale} />
      <main className={MAIN_CLASS}>
        <RouteSlot>{children}</RouteSlot>
      </main>
      <ChromeAfter locale={locale} />
      </ClientMessages>
    </LocaleProvider>
  );
}
