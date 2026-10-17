import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import { Brain } from "lucide-react";
import { DesktopNav, MobileTabBar } from "@/components/layout/SiteNav";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";

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
  themeColor: "#0a0f1e",
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
    <html lang="en" className="dark">
      <body className="flex min-h-screen flex-col">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }} />
        <header className="glass sticky top-0 z-50">
          <div className="container flex h-14 items-center justify-between">
            <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight" aria-label="PokéIQ home">
              <Brain className="h-5 w-5 text-primary" aria-hidden />
              <span>
                Poké<span className="text-primary">IQ</span>
              </span>
            </Link>
            <DesktopNav />
          </div>
        </header>
        <main className="container flex-1 pb-28 pt-8 md:pb-12">{children}</main>
        <footer className="mb-[calc(4rem+env(safe-area-inset-bottom))] border-t border-white/5 py-6 text-center text-xs text-muted-foreground md:mb-0">
          <div className="container space-y-2">
            <nav className="flex flex-wrap justify-center gap-x-4 gap-y-1">
              <Link href="/play" className="hover:text-foreground">Game modes</Link>
              <Link href="/pokedex" className="hover:text-foreground">Pokédex</Link>
              <Link href="/pokedex/study" className="hover:text-foreground">Study mode</Link>
              <Link href="/leaderboard" className="hover:text-foreground">Leaderboard</Link>
              <Link href="/quiz/gen-1-pokemon-quiz" className="hover:text-foreground">Gen 1 quiz</Link>
              <Link href="/quiz/pokemon-type-quiz" className="hover:text-foreground">Type chart quiz</Link>
              <Link href="/trainer" className="hover:text-foreground">Trainer card</Link>
            </nav>
            <p>
              PokéIQ is a free, non-commercial fan project and is not affiliated with, endorsed or sponsored by
              Nintendo, Game Freak, Creatures or The Pokémon Company. Pokémon and all related names are trademarks
              of their respective owners. Data from PokéAPI.
            </p>
          </div>
        </footer>
        <MobileTabBar />
        {/* The analytics endpoint only exists on Vercel deployments. */}
        {process.env.VERCEL && <Analytics />}
      </body>
    </html>
  );
}
