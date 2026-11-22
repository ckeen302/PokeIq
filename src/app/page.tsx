import type { Metadata } from "next";
import { Coffee } from "lucide-react";
import { COFFEE_URL } from "@/lib/support";
import { Hero } from "@/components/home/Hero";
import { SocialLinks } from "@/components/home/SocialLinks";
import { TodaySection } from "@/components/home/TodaySection";
import { SITE_NAME } from "@/lib/site";
import { SITE_DESCRIPTION, SITE_TAGLINE, jsonLd, pageMetadata } from "@/lib/seo";
import { websiteWithSearch } from "@/lib/structured-data";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import home from "@/messages/home";
import site from "@/messages/site";

export function generateMetadata(): Metadata {
  const t = serverT(home);
  const s = serverT(site);
  const en = t.locale === "en";
  const title = `${SITE_NAME}: ${en ? SITE_TAGLINE : s("tagline")}`;
  return {
    ...pageMetadata({
      title,
      description: en ? SITE_DESCRIPTION : s("description"),
      path: "/",
      socialTitle: t("socialTitle"),
      socialDescription: t("socialDescription"),
    }),
    // The home page's title is the whole name, not "… · PokéIQ".
    title: { absolute: title },
  };
}

/**
 * The landing page, kept to the point: the banner (the site's name, what's
 * here and a way down to Today), today's dailies with the streak, the coffee
 * button and the socials.
 */
export default function HomePage() {
  const t = serverT(home);
  return (
    // A phone's title screen starts under the header's bottom edge; the structured data goes last so it takes no space.
    // On a desktop the first screen is filled: the hero grows with the window so the coffee button and socials sit just above its bottom edge.
    <div className="mx-auto -mt-4 max-w-6xl space-y-12 sm:mt-0 sm:space-y-4 max-sm:-mt-8 max-sm:space-y-9 lg:flex lg:min-h-[calc(100svh-7rem)] lg:flex-col lg:space-y-8">
      {/* Soft colour drifting behind the page: the brand's pink, violet and green, very faint. Still for reduced motion. */}
      <span className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
        <span className="absolute -left-[25vw] -top-[20vh] block h-[80vh] w-[80vw] rounded-full bg-[radial-gradient(closest-side,hsl(var(--primary)/0.13),transparent)] motion-safe:animate-glow-a" />
        <span className="absolute -right-[25vw] top-[20vh] block h-[85vh] w-[75vw] rounded-full bg-[radial-gradient(closest-side,hsl(var(--screen)/0.14),transparent)] motion-safe:animate-glow-b" />
        <span className="absolute -bottom-[30vh] left-[5vw] block h-[75vh] w-[70vw] rounded-full bg-[radial-gradient(closest-side,hsl(var(--success)/0.08),transparent)] motion-safe:animate-glow-c" />
      </span>
      <div className="space-y-6 max-sm:space-y-5 lg:flex lg:flex-1 lg:flex-col">
        <Hero />
        <ClientMessages namespaces={[home]}>
          <TodaySection />
        </ClientMessages>
      </div>
      <div className="flex flex-col items-center gap-4 pb-2 lg:gap-5">
        <a
          href={COFFEE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex items-center gap-2 rounded-md border bg-card px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wider text-foreground transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-[0_0_16px_hsl(var(--primary)/0.25)]"
          data-testid="coffee-button"
        >
          <Coffee className="h-4 w-4 text-primary" aria-hidden />
          {t("coffee")}
        </a>
        <SocialLinks />
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(t.locale === "en" ? websiteWithSearch() : websiteWithSearch(t.locale, serverT(site)("description"))) }} />
    </div>
  );
}
