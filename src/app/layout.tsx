import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { BrainLogo } from "@/components/BrainLogo";
import { NavLinks } from "@/components/NavLinks";
import { PageTransition } from "@/components/PageTransition";
import { UserMenu } from "@/components/UserMenu";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: {
    default: "PokéIQ — The Ultimate Pokémon Knowledge Engine",
    template: "%s · PokéIQ",
  },
  description:
    "Four live-computed quiz modules testing visual recognition, type mastery, move expertise and competitive stat knowledge. No hardcoded questions.",
  applicationName: "PokéIQ",
  appleWebApp: {
    capable: true,
    title: "PokéIQ",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#050510",
  viewportFit: "cover",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="aurora" aria-hidden>
          <div className="blob" />
        </div>
        <header className="sticky top-0 z-40 border-b border-white/5 bg-background/50 backdrop-blur-xl">
          <nav className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
            <Link
              href="/"
              className="group flex items-center gap-2.5 text-xl font-black tracking-tight"
            >
              <BrainLogo
                size={30}
                className="transition-transform duration-500 group-hover:rotate-[360deg] drop-shadow-[0_0_10px_rgba(192,132,252,0.35)]"
              />
              Poké<span className="text-gradient">IQ</span>
            </Link>
            <div className="flex items-center gap-2 sm:gap-3">
              <NavLinks />
              <UserMenu />
            </div>
          </nav>
        </header>
        <main className="mx-auto min-h-[calc(100dvh-9rem)] w-full max-w-5xl px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <PageTransition>{children}</PageTransition>
        </main>
        <footer className="border-t border-white/5 py-5 text-center text-xs text-muted">
          Every question computed live from{" "}
          <a
            href="https://pokeapi.co"
            className="underline decoration-dotted hover:text-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            PokéAPI
          </a>
          . Pokémon © Nintendo/Game Freak — fan project, not affiliated.
        </footer>
      </body>
    </html>
  );
}
