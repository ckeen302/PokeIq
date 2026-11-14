import type { Metadata, Viewport } from "next";
import Link from "next/link";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import { DesktopNav, MobileTabBar } from "@/components/layout/SiteNav";
import { Logo } from "@/components/layout/Logo";
import { AccountSync } from "@/components/account/AccountSync";
import { CommunityLayer } from "@/components/community/CommunityLayer";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { SITE_DESCRIPTION, SITE_TAGLINE, jsonLd } from "@/lib/seo";
import { SPLASH_INIT_SCRIPT, THEME_INIT_SCRIPT } from "@/lib/theme";
import { BootLoader } from "@/components/layout/BootLoader";
import { RouteSlot } from "@/components/layout/RouteSlot";
import { ErrorReporter, ReportProblem } from "@/components/layout/ReportProblem";
import { SHINY_ORIGIN } from "@/lib/shiny";
import SPLASH_SCREENS from "@/lib/splash-screens.json";
import "./globals.css";

// The site's fonts are committed in src/fonts (the same latin files Google Fonts serves, all under the SIL Open Font License),
// so a build never has to fetch them from Google: those fetches failed builds now and then.
const display = localFont({
  src: [
    { path: "../fonts/chakra-petch-normal-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/chakra-petch-normal-600.woff2", weight: "600", style: "normal" },
    { path: "../fonts/chakra-petch-normal-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});
const body = localFont({
  src: [{ path: "../fonts/inter-normal-100-900.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-body",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});
const pixel = localFont({
  src: [
    { path: "../fonts/silkscreen-normal-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/silkscreen-normal-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-pixel",
  display: "swap",
  fallback: ["monospace"],
});

/** The token from Search Console's "HTML tag" method: only the content="…" value. */
const GOOGLE_SITE_VERIFICATION = process.env.GOOGLE_SITE_VERIFICATION?.trim();

/**
 * Site-wide defaults. `metadataBase` is SITE_URL (NEXT_PUBLIC_SITE_URL, else
 * playpokeiq.com), so every Open Graph image URL is absolute. Pages set
 * their own title, description and preview through `pageMetadata`.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME}: ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  manifest: "/manifest.webmanifest",
  openGraph: { siteName: SITE_NAME, type: "website", locale: "en_US", title: `${SITE_NAME}: ${SITE_TAGLINE}`, description: SITE_DESCRIPTION },
  twitter: { card: "summary_large_image", title: `${SITE_NAME}: ${SITE_TAGLINE}`, description: SITE_DESCRIPTION },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: SITE_NAME, startupImage: SPLASH_SCREENS.map((x) => ({ url: x.href, media: x.media })) },
  // Google Search Console's HTML-tag check (docs/search-console.md). Read at build time.
  ...(GOOGLE_SITE_VERIFICATION && { verification: { google: GOOGLE_SITE_VERIFICATION } }),
};

export const viewport: Viewport = {
  themeColor: "#08071a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// The same @id as the home page's fuller WebSite node (with its SearchAction), so the two read as one site.
const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
};

/** The credits line, in full on wider screens and folded away on phones (mobile-polish). Phones also keep only Privacy and Report a problem of the footer links: the tab bar is their site map. */
const CREDITS = (
  <>
              PokéIQ is a free, non-commercial fan project and is not affiliated with, endorsed or sponsored by
              Nintendo, Game Freak, Creatures or The Pokémon Company. Pokémon and all related names are trademarks
              of their respective owners. Data from PokéAPI. Battles run on Pokémon Showdown&apos;s simulator, and its battle timer and replay format are adapted from Pokémon Showdown (MIT licence, © Guangcong Luo and contributors). Battle music: original chiptune by Ted Kerr, celestialghost8 and
              congusbongus via OpenGameArt.org, under CC0 (
              <a href="/audio/battle/CREDITS.md" className="underline-offset-2 hover:underline">
                credits
              </a>
              ). Sizes music by cynicmusic and city textures from Poly Haven, both CC0 (
              <a href="/sizes/CREDITS.md" className="underline-offset-2 hover:underline">
                credits
              </a>
              ). Race stadium textures from Poly Haven and crowd sounds from OpenGameArt.org, all CC0 (
              <a href="/race/CREDITS.md" className="underline-offset-2 hover:underline">
                credits
              </a>
              ). The two films&apos; scores are original, written for PokéIQ and played with the MuseScore General sound font (MIT; strings from VSCO 2 CE, CC0) (credits:{" "}
              <a href="/audio/world-history/CREDITS.md" className="underline-offset-2 hover:underline">
                History of the Pokémon World
              </a>
              ,{" "}
              <a href="/audio/pokemon-story/CREDITS.md" className="underline-offset-2 hover:underline">
                Story of Pokémon
              </a>
              ).
  </>
);

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${pixel.variable}`} suppressHydrationWarning>
      <head>
        {process.env.NEXT_PUBLIC_SUPABASE_URL && (
          <>
            {/* API calls (CORS) and storage images (no-CORS) use separate connections. */}
            <link rel="preconnect" href={new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin} crossOrigin="anonymous" />
            <link rel="preconnect" href={new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin} />
          </>
        )}
        {/* Real Shiny quiz images (Supabase storage) and artwork / sprites (PokeAPI's CDN). */}
        <link rel="preconnect" href={SHINY_ORIGIN} />
        <link rel="preconnect" href="https://raw.githubusercontent.com" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT + SPLASH_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <div className="boot-splash" aria-hidden>
          <BootLoader idPrefix="splash" />
        </div>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(websiteJsonLd) }} />
        <header className="glass sticky top-0 z-50">
          <div className="grid h-14 w-full grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 sm:px-6 xl:px-10">
            <Link href="/" aria-label="PokéIQ home" className="tap shrink-0 justify-self-start">
              <Logo />
            </Link>
            <DesktopNav />
          </div>
        </header>
        <main className="container flex-1 pb-28 pt-8 max-md:pb-12 max-md:pt-6 lg:pb-12">
          <RouteSlot>{children}</RouteSlot>
        </main>
        <footer className="mb-[calc(4rem+env(safe-area-inset-bottom))] border-t border-foreground/[0.06] py-8 text-center text-xs text-muted-foreground lg:mb-0">
          <div className="container space-y-2">
            <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2 font-pixel text-[10px] uppercase tracking-wider max-md:grid max-md:grid-cols-2 max-md:gap-x-2 max-md:gap-y-0 max-md:text-[11px] max-md:[&>a:not([href='/privacy'])]:hidden max-md:[&>:is(a,button)]:flex max-md:[&>:is(a,button)]:min-h-11 max-md:[&>:is(a,button)]:items-center max-md:[&>:is(a,button)]:justify-center max-md:[&>button]:text-[11px]">
              <Link href="/play" prefetch={false} className="hover:text-foreground">Game modes</Link>
              <Link href="/pokedex" prefetch={false} className="hover:text-foreground">Pokédex</Link>
              <Link href="/pokedex/study" prefetch={false} className="hover:text-foreground">Study mode</Link>
              <Link href="/atlas" prefetch={false} className="hover:text-foreground">World atlas</Link>
              <Link href="/lab" prefetch={false} className="hover:text-foreground">3D Lab</Link>
              <Link href="/pokedex/timeline" prefetch={false} className="hover:text-foreground">Pokémon timeline</Link>
              <Link href="/pokedex/sizes" prefetch={false} className="hover:text-foreground">Pokémon sizes</Link>
              <Link href="/pokedex/race" prefetch={false} className="hover:text-foreground">Pokémon race</Link>
              <Link href="/leaderboard" prefetch={false} className="hover:text-foreground">Leaderboard</Link>
              <Link href="/battle/teams" prefetch={false} className="hover:text-foreground">Team builder</Link>
              <Link href="/battle/calc" prefetch={false} className="hover:text-foreground">Damage calc</Link>
              <Link href="/battle/lab" prefetch={false} className="hover:text-foreground">Battle Lab</Link>
              <Link href="/quiz/gen-1-pokemon-quiz" prefetch={false} className="hover:text-foreground">Gen 1 quiz</Link>
              <Link href="/quiz/pokemon-type-quiz" prefetch={false} className="hover:text-foreground">Type chart quiz</Link>
              <Link href="/trainer" prefetch={false} className="hover:text-foreground">Trainer card</Link>
              <Link href="/privacy" prefetch={false} className="hover:text-foreground">Privacy</Link>
              <ReportProblem />
            </nav>
            <p className="mx-auto max-w-3xl pt-2 text-[11px] leading-relaxed text-muted-foreground/70 max-md:hidden">{CREDITS}</p>
            <details className="group mx-auto max-w-3xl pt-2 text-[11px] leading-relaxed text-muted-foreground/70 md:hidden">
              <summary className="mx-auto flex h-10 w-fit cursor-pointer list-none items-center gap-1.5 px-3 font-pixel text-[10px] uppercase tracking-wider text-muted-foreground [&::-webkit-details-marker]:hidden">
                Credits &amp; legal <span aria-hidden className="transition-transform group-open:rotate-180">▾</span>
              </summary>
              <p className="pt-1">{CREDITS}</p>
            </details>
          </div>
        </footer>
        <MobileTabBar />
        <AccountSync />
        <CommunityLayer />
        <ErrorReporter />
        {/* The analytics endpoint only exists on Vercel deployments. */}
        {process.env.VERCEL && <Analytics />}
      </body>
    </html>
  );
}
