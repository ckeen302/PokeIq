import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import { PRODUCTION_URL, SITE_NAME } from "@/lib/site";
import { SITE_DESCRIPTION, SITE_TAGLINE } from "@/lib/seo";
import { SPLASH_INIT_SCRIPT, THEME_INIT_SCRIPT } from "@/lib/theme";
import { BootLoader } from "@/components/layout/BootLoader";
import { ErrorReporter } from "@/components/layout/ReportProblem";
import { ChromeGate, HtmlRoot } from "@/components/layout/RootChrome";
import { ChromeAfter, ChromeBefore } from "@/components/layout/SiteChrome";
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
 * Site-wide defaults. `metadataBase` is always the production site, so every Open Graph image URL is absolute and
 * a canonical or hreflang link can never point at localhost or a preview. Pages set their own title, description,
 * canonical and preview through `pageMetadata` (no canonical here: a page without one simply has none).
 */
export const metadata: Metadata = {
  metadataBase: new URL(PRODUCTION_URL),
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <HtmlRoot className={`${display.variable} ${body.variable} ${pixel.variable}`}>
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
        {/* English pages get the header and footer here; a page in another language gets them from app/[locale]/layout. */}
        <ChromeGate before={<ChromeBefore locale="en" />} after={<ChromeAfter locale="en" />}>
          {children}
        </ChromeGate>
        <ErrorReporter />
        {/* The analytics endpoint only exists on Vercel deployments. */}
        {process.env.VERCEL && <Analytics />}
      </body>
    </HtmlRoot>
  );
}
