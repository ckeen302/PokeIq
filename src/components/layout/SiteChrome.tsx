import Link from "@/components/ui/PlainLink";
import { DesktopNav, MobileTabBar } from "@/components/layout/SiteNav";
import { Logo } from "@/components/layout/Logo";
import { AccountSync } from "@/components/account/AccountSync";
import { CommunityLayer } from "@/components/community/CommunityLayer";
import { ReportProblem } from "@/components/layout/ReportProblem";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { SITE_DESCRIPTION, jsonLd } from "@/lib/seo";
import { HAS_OTHER_LOCALES, type Locale } from "@/i18n/config";
import { LanguageLinks, LanguageSuggestion } from "@/components/i18n/Lazy";
import { serverT } from "@/i18n/server";
import nav from "@/messages/nav";
import site from "@/messages/site";
import report from "@/messages/report";
import errorNs from "@/messages/error";
import feedback from "@/messages/feedback";
import copyFallback from "@/messages/copy-fallback";
import community from "@/messages/community";
import chat from "@/messages/chat";
import addFriend from "@/messages/add-friend";
import emailNudge from "@/messages/email-nudge";

// The same @id as the home page's fuller WebSite node (with its SearchAction), so the two read as one site.
const websiteJsonLd = (locale: Locale, description: string) => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  name: SITE_NAME,
  url: SITE_URL,
  description,
  ...(locale !== "en" && { inLanguage: locale }),
});

/** The namespaces the header, footer and tab bar read in the browser (a page in another language sends them along). */
// Plus the small pieces many game pages show: the chat box, the add-friend prompt, the daily email nudge.
export const CHROME_NAMESPACES = [nav, report, errorNs, feedback, copyFallback, community, chat, addFriend, emailNudge];

/** What comes before the page's <main>: the site's JSON-LD and the header. */
export function ChromeBefore({ locale }: { locale: Locale }) {
  const t = serverT(nav);
  const s = serverT(site);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(websiteJsonLd(locale, locale === "en" ? SITE_DESCRIPTION : s("description"))) }} />
      <header className="glass sticky top-0 z-50">
        <div className="grid h-14 w-full grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 sm:px-6 xl:px-10">
          <Link href="/" aria-label={t("logoHome")} className="tap shrink-0 justify-self-start">
            <Logo />
          </Link>
          <DesktopNav />
        </div>
      </header>
    </>
  );
}

/** What comes after the page's <main>: the footer, the phone's tab bar and the community layer. */
export function ChromeAfter(_: { locale: Locale }) {
  const t = serverT(site);
  return (
    <>
      <footer className="mb-[calc(4rem+env(safe-area-inset-bottom))] border-t border-foreground/[0.06] py-8 text-center text-xs text-muted-foreground lg:mb-0">
        <div className="container space-y-2">
          <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2 font-pixel text-[10px] uppercase tracking-wider max-md:grid max-md:grid-cols-2 max-md:gap-x-2 max-md:gap-y-0 max-md:text-[11px] max-md:[&>a:not([href$='/privacy']):not([href$='/credits'])]:hidden max-md:[&>:is(a,button)]:flex max-md:[&>:is(a,button)]:min-h-11 max-md:[&>:is(a,button)]:items-center max-md:[&>:is(a,button)]:justify-center max-md:[&>button]:col-span-2 max-md:[&>button]:text-[11px]">
            <Link href="/privacy" prefetch={false} className="hover:text-foreground">{t("footer.privacy")}</Link>
            <Link href="/credits" prefetch={false} className="hover:text-foreground">{t("footer.credits")}</Link>
            <ReportProblem />
          </nav>
          {HAS_OTHER_LOCALES && <LanguageLinks />}
          <p className="mx-auto max-w-3xl pt-2 text-[11px] leading-relaxed text-muted-foreground/70">{t("footer.disclaimer")}</p>
        </div>
      </footer>
      {HAS_OTHER_LOCALES && <LanguageSuggestion />}
      <MobileTabBar />
      <AccountSync />
      <CommunityLayer />
    </>
  );
}
