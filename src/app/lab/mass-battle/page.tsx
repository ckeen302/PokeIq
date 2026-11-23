import type { Metadata } from "next";
import { MassBattleView, massBattleMetadata } from "./view";

/**
 * The Mass Battle Lab. Its HTML is the same for everyone, so it's built once and served from the CDN; a link to a
 * battle, a question or a playback (?b=, ?ask=, ?v=) is rewritten to ./shared (next.config), which reads the query.
 */
export function generateMetadata(): Metadata {
  return massBattleMetadata({});
}

export default function Page() {
  return <MassBattleView sp={{}} />;
}
