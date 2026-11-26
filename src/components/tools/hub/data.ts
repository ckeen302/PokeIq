import "server-only";
import { getT, serverT } from "@/i18n/server";
import tools from "@/messages/tools";
import tierList from "@/messages/tier-list";
import ballPage from "@/messages/pokeball-maker-page";
import pickerPage from "@/messages/favorite-picker-page";
import home from "@/messages/home";

/** The Tools hub's cards: each tool's name and line (existing strings only), its accent and its picture, a screenshot of the tool in use. */

export interface HubTool {
  href: string;
  title: string;
  subtitle: string;
  /** A screenshot of the tool itself (public/tools/hub). */
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
  const fp = serverT(pickerPage);
  const h = serverT(home);
  return {
    title: t("hub.title"),
    free: h("free"),
    open: t("hub.open"),
    tools: [
      { href: "/tools/shiny-maker", title: t("maker.title"), subtitle: t("maker.subtitle"), image: "/tools/hub/shiny.webp", accent: "190 90% 56%", testId: "tool-card-shiny-maker" },
      { href: "/tools/pokeball-maker", title: pb("cardTitle"), subtitle: pb("cardSubtitle"), image: "/tools/hub/ball.webp", accent: "356 86% 60%", testId: "tool-card-pokeball-maker" },
      { href: "/tools/tier-list", title: tl("card.title"), subtitle: tl("card.subtitle"), image: "/tools/hub/tier.webp", accent: "258 94% 74%", testId: "tool-card-tier-list" },
      { href: "/tools/favorite-pokemon-picker", title: fp("cardTitle"), subtitle: fp("cardSubtitle"), image: "/tools/hub/picker.webp", accent: "44 96% 62%", testId: "tool-card-favorite-picker" },
    ],
  };
}
