import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Chakra_Petch, Inter, Silkscreen } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { DesktopNav, MobileTabBar } from "@/components/layout/SiteNav";
import { Logo } from "@/components/layout/Logo";
import { AccountSync } from "@/components/account/AccountSync";
import { CommunityLayer } from "@/components/community/CommunityLayer";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { SITE_DESCRIPTION, SITE_TAGLINE, jsonLd } from "@/lib/seo";
import { SPLASH_INIT_SCRIPT, THEME_INIT_SCRIPT } from "@/lib/theme";
import { BootLoader } from "@/components/layout/BootLoader";
import { ErrorReporter, ReportProblem } from "@/components/layout/ReportProblem";
import { SHINY_ORIGIN } from "@/lib/shiny";
import "./globals.css";

const display = Chakra_Petch({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });
const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const pixel = Silkscreen({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-pixel", display: "swap" });

/**
 * Site-wide defaults. `metadataBase` is SITE_URL (NEXT_PUBLIC_SITE_URL, else
 * pokeiq.vercel.app), so every Open Graph image URL is absolute. Pages set
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
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: SITE_NAME },
};

export const viewport: Viewport = {
  themeColor: "#08071a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
};

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
            <Link href="/" aria-label="PokéIQ home" className="shrink-0 justify-self-start">
              <Logo />
            </Link>
            <DesktopNav />
          </div>
        </header>
        <main className="container flex-1 pb-28 pt-8 lg:pb-12">{children}</main>
        <footer className="mb-[calc(4rem+env(safe-area-inset-bottom))] border-t border-foreground/[0.06] py-8 text-center text-xs text-muted-foreground lg:mb-0">
          <div className="container space-y-2">
            <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2 font-pixel text-[10px] uppercase tracking-wider">
              <Link href="/play" prefetch={false} className="hover:text-foreground">Game modes</Link>
              <Link href="/pokedex" prefetch={false} className="hover:text-foreground">Pokédex</Link>
              <Link href="/pokedex/study" prefetch={false} className="hover:text-foreground">Study mode</Link>
              <Link href="/atlas" prefetch={false} className="hover:text-foreground">World atlas</Link>
              <Link href="/pokedex/timeline" prefetch={false} className="hover:text-foreground">Pokémon timeline</Link>
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
            <p className="mx-auto max-w-3xl pt-2 text-[11px] leading-relaxed text-muted-foreground/70">
              PokéIQ is a free, non-commercial fan project and is not affiliated with, endorsed or sponsored by
              Nintendo, Game Freak, Creatures or The Pokémon Company. Pokémon and all related names are trademarks
              of their respective owners. Data from PokéAPI. Battles run on Pokémon Showdown&apos;s simulator, and its battle timer and replay format are adapted from Pokémon Showdown (MIT licence, © Guangcong Luo and contributors). Battle music: original chiptune by Ted Kerr, celestialghost8 and
              congusbongus via OpenGameArt.org, under CC0 (
              <a href="/audio/battle/CREDITS.md" className="underline-offset-2 hover:underline">
                credits
              </a>
              ). PokéGuessr countdown sounds by bart, yd and pyranostudios via OpenGameArt.org, under CC0 (
              <a href="/audio/guessr/CREDITS.md" className="underline-offset-2 hover:underline">
                credits
              </a>
              ).
            </p>
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
