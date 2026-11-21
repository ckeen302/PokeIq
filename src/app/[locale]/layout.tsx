import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { LIVE_OTHER_LOCALES, OG_LOCALES, type OtherLocale } from "@/i18n/config";
import { LocaleProvider } from "@/i18n/locale-context";
import { RouteSlot } from "@/components/layout/RouteSlot";
import { MAIN_CLASS } from "@/components/layout/RootChrome";
import { ChromeAfter, ChromeBefore } from "@/components/layout/SiteChrome";

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
  return { openGraph: { locale: OG_LOCALES[locale] } };
}

export default async function LocaleLayout({ children, params }: Props) {
  const locale = liveLocale((await params).locale);
  if (!locale) notFound();
  setRequestLocale(locale);
  return (
    <LocaleProvider locale={locale}>
      {/* Bing reads the page's language from this; Google from <html lang> and hreflang. */}
      <meta httpEquiv="content-language" content={locale} />
      <ChromeBefore locale={locale} />
      <main className={MAIN_CLASS}>
        <RouteSlot>{children}</RouteSlot>
      </main>
      <ChromeAfter locale={locale} />
    </LocaleProvider>
  );
}
