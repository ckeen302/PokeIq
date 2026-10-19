import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Chakra_Petch, Inter, Silkscreen } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { DesktopNav, MobileTabBar } from "@/components/layout/SiteNav";
import { Logo } from "@/components/layout/Logo";
import { AccountSync } from "@/components/account/AccountSync";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { SPLASH_INIT_SCRIPT, THEME_INIT_SCRIPT } from "@/lib/theme";
import { BootLoader } from "@/components/layout/BootLoader";
import "./globals.css";

const display = Chakra_Petch({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });
const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const pixel = Silkscreen({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-pixel", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "PokéIQ — The Ultimate Pokémon Quiz",
    template: "%s · PokéIQ",
  },
  description:
    "Test your Pokémon knowledge: daily challenges, Who's That Pokémon silhouettes, cry quizzes, Pokédex entries, type matchups and Pokédle. Get your PokéIQ.",
  applicationName: SITE_NAME,
  manifest: "/manifest.webmanifest",
  openGraph: { siteName: SITE_NAME, type: "website" },
  twitter: { card: "summary_large_image" },
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
  description: "Daily Pokémon quizzes and puzzles that measure your PokéIQ.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${pixel.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT + SPLASH_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <div className="boot-splash" aria-hidden>
          <BootLoader idPrefix="splash" />
        </div>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }} />
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
            </nav>
            <p className="mx-auto max-w-3xl pt-2 text-[11px] leading-relaxed text-muted-foreground/70">
              PokéIQ is a free, non-commercial fan project and is not affiliated with, endorsed or sponsored by
              Nintendo, Game Freak, Creatures or The Pokémon Company. Pokémon and all related names are trademarks
              of their respective owners. Data from PokéAPI.
            </p>
          </div>
        </footer>
        <MobileTabBar />
        <AccountSync />
        {/* The analytics endpoint only exists on Vercel deployments. */}
        {process.env.VERCEL && <Analytics />}
      </body>
    </html>
  );
}
