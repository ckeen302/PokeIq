import type { Metadata } from "next";
import { ShinyCounterView, shinyCounterMetadata } from "./view";

/**
 * /tools/shiny-hunt-counter: the Shiny Hunt Counter. Built once and served from the CDN; a shared hunt (?d=…) is
 * rewritten to ./shared (next.config), which shows that hunt with its own preview card.
 */
export function generateMetadata(): Promise<Metadata> {
  return shinyCounterMetadata(undefined);
}

export default function Page() {
  return <ShinyCounterView raw={undefined} />;
}
