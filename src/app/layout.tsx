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
          <link rel="preconnect" href={new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin} crossOrigin="anonymous" />
        )}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT + SPLASH_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <div className="boot-splash" aria-hidden>
          <BootLoader idPrefix="splash" />
        </div>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(websiteJsonLd) }} />
        <header className="glass sticky top-0 z-50">
          <div className="container flex h-14 items-center justify-between">
            <Link href="/" aria-label="PokéIQ home" className="shrink-0">
              <Logo />
            </Link>
            <DesktopNav />
          </div>
        </header>
        <main className="container flex-1 pb-28 pt-8 lg:pb-12">{children}</main>
        <footer className="mb-[calc(4rem+env(safe-area-inset-bottom))] border-t border-foreground/[0.06] py-8 text-center text-xs text-muted-foreground lg:mb-0">
          <div className="container space-y-2">
            <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2 font-pixel text-[10px] uppercase tracking-wider">
              <Link href="/play" className="hover:text-foreground">Game modes</Link>
              <Link href="/pokedex" className="hover:text-foreground">Pokédex</Link>
              <Link href="/pokedex/study" className="hover:text-foreground">Study mode</Link>
              <Link href="/atlas" className="hover:text-foreground">World atlas</Link>
              <Link href="/leaderboard" className="hover:text-foreground">Leaderboard</Link>
              <Link href="/battle/teams" className="hover:text-foreground">Team builder</Link>
              <Link href="/battle/calc" className="hover:text-foreground">Damage calc</Link>
              <Link href="/battle/lab" className="hover:text-foreground">Battle Lab</Link>
              <Link href="/quiz/gen-1-pokemon-quiz" className="hover:text-foreground">Gen 1 quiz</Link>
              <Link href="/quiz/pokemon-type-quiz" className="hover:text-foreground">Type chart quiz</Link>
              <Link href="/trainer" className="hover:text-foreground">Trainer card</Link>
              <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
              <ReportProblem />
            </nav>
            <p className="mx-auto max-w-3xl pt-2 text-[11px] leading-relaxed text-muted-foreground/70">
              PokéIQ is a free, non-commercial fan project and is not affiliated with, endorsed or sponsored by
              Nintendo, Game Freak, Creatures or The Pokémon Company. Pokémon and all related names are trademarks
              of their respective owners. Data from PokéAPI. Battle music: original chiptune by Ted Kerr, Julie Damsgaard (Spring Spring) and
              congusbongus via OpenGameArt.org, under CC0 and CC BY 3.0 (
              <a href="/audio/battle/CREDITS.md" className="underline-offset-2 hover:underline">
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
