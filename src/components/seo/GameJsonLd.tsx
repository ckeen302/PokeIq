import { jsonLd } from "@/lib/seo";
import { webGame } from "@/lib/structured-data";

/** Structured data only (nothing visible) for a game page without a GameInfo block. */
export function GameJsonLd(props: { name: string; path: string; description: string }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(webGame(props)) }} />;
}
