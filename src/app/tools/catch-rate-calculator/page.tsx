import type { Metadata } from "next";
import { CatchRateView, catchRateMetadata } from "./view";

/**
 * /tools/catch-rate-calculator: the Catch Rate Calculator. Built once and served from the CDN; a link with an
 * encounter (?p=…) is rewritten to ./shared (next.config), which opens it with its own title and preview card.
 */
export function generateMetadata(): Promise<Metadata> {
  return catchRateMetadata(null);
}

export default function Page() {
  return <CatchRateView query={null} />;
}
