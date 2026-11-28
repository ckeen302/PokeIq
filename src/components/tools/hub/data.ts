import "server-only";
import { getT, serverT } from "@/i18n/server";
import tools from "@/messages/tools";
import tierList from "@/messages/tier-list";
import ballPage from "@/messages/pokeball-maker-page";
import shinyCounterPage from "@/messages/shiny-counter-page";
import catchRatePage from "@/messages/catch-rate-page";
import nuzlockePage from "@/messages/nuzlocke-page";
import home from "@/messages/home";

/** The Tools hub's cards: each tool's name and line (existing strings only), its accent and its card art. The Favorite Pokémon Picker is a list in the Tier List Maker now, not a card of its own. */

export interface HubTool {
  href: string;
  title: string;
  subtitle: string;
  /** The tool's card art (public/tools/hub), by night; `<name>-light.webp` beside it is the same scene by day. */
  image: string;
  /** An HSL triplet: the card's border and glow on hover. */
  accent: string;
  testId: string;
}
export interface HubData {
  title: string;
  free: string;
  open: string;
  tools: HubTool[];
}

export async function hubData(): Promise<HubData> {
  const t = await getT(tools);
  const tl = serverT(tierList);
  const pb = serverT(ballPage);
  const sc = serverT(shinyCounterPage);
  const cr = serverT(catchRatePage);
  const nz = serverT(nuzlockePage);
  const h = serverT(home);
  return {
    title: t("hub.title"),
    free: h("free"),
    open: t("hub.open"),
    tools: [
      { href: "/tools/shiny-maker", title: t("maker.title"), subtitle: t("maker.subtitle"), image: "/tools/hub/shiny.webp", accent: "190 90% 56%", testId: "tool-card-shiny-maker" },
      { href: "/tools/shiny-hunt-counter", title: sc("title"), subtitle: sc("cardSubtitle"), image: "/tools/hub/hunt.webp", accent: "30 96% 58%", testId: "tool-card-shiny-hunt-counter" },
      { href: "/tools/catch-rate-calculator", title: cr("title"), subtitle: cr("cardSubtitle"), image: "/tools/hub/catch.webp", accent: "150 72% 52%", testId: "tool-card-catch-rate" },
      { href: "/tools/pokeball-maker", title: pb("cardTitle"), subtitle: pb("cardSubtitle"), image: "/tools/hub/ball.webp", accent: "356 86% 60%", testId: "tool-card-pokeball-maker" },
      { href: "/tools/tier-list", title: tl("card.title"), subtitle: tl("card.subtitle"), image: "/tools/hub/tier.webp", accent: "258 94% 74%", testId: "tool-card-tier-list" },
      { href: "/tools/nuzlocke-tracker", title: nz("title"), subtitle: nz("cardSubtitle"), image: "/tools/hub/nuzlocke.webp", accent: "318 82% 66%", testId: "tool-card-nuzlocke" },
    ],
  };
}
