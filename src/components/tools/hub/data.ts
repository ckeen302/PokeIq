import "server-only";
import { getT, serverT } from "@/i18n/server";
import tools from "@/messages/tools";
import tierList from "@/messages/tier-list";
import ballPage from "@/messages/pokeball-maker-page";
import ballMaker from "@/messages/pokeball-maker";
import pickerPage from "@/messages/favorite-picker-page";
import home from "@/messages/home";
import { hex } from "@/lib/shiny-maker/color";
import { DEFAULT_ID, firstDesign } from "@/lib/shiny-maker/presets";
import { partSwatch } from "@/lib/shiny-maker/recolor";
import { readSpecies } from "@/lib/shiny-maker/server";
import { ballPreset, type BallId } from "@/lib/pokeball-maker/presets";
import { ballCss } from "@/lib/pokeball-maker/css";
import type { ShinyStep } from "./ShinyCycle";

/** Everything the hub's directions show, worked out on the server: the tools' names and lines (existing strings only), their accents, and the previews' data. */

export type ToolId = "shiny" | "ball" | "tier" | "picker";
export interface HubTool {
  id: ToolId;
  href: string;
  title: string;
  subtitle: string;
  /** A few of the tool's own feature names (its tabs, modes or styles). */
  tags: string[];
  /** An HSL triplet. */
  accent: string;
  testId: string;
}
export interface HubData {
  title: string;
  free: string;
  open: string;
  tools: HubTool[];
  shiny: { w: number; h: number; firstDots: string[]; labels: Record<ShinyStep, string> };
  balls: string[];
}

/** ballCss's own highlight, left off the rolling balls (they carry a still one, so the shine doesn't spin with them). */
const HIGHLIGHT = "radial-gradient(circle at 34% 28%, rgb(255 255 255 / 0.85) 0 7%, rgb(255 255 255 / 0) 22%), ";
const RACK: BallId[] = ["poke", "great", "ultra", "master", "premier", "luxury", "dusk", "love", "quick", "timer", "dream", "beast"];

export async function hubData(): Promise<HubData> {
  const t = await getT(tools);
  const tl = serverT(tierList);
  const pb = serverT(ballPage);
  const bm = serverT(ballMaker);
  const fp = serverT(pickerPage);
  const h = serverT(home);
  const sp = await readSpecies(DEFAULT_ID).catch(() => null);
  const d = sp ? firstDesign(sp) : null;
  const firstDots = sp && d ? sp.parts.map((p, i) => (p.o ? null : hex(partSwatch(sp, d, i)))).filter((c): c is string => !!c) : [];
  return {
    title: t("hub.title"),
    free: h("free"),
    open: t("hub.open"),
    tools: [
      {
        id: "shiny",
        href: "/tools/shiny-maker",
        title: t("maker.title"),
        subtitle: t("maker.subtitle"),
        tags: [t("styles.px"), t("styles.sd"), t("styles.hd"), t("styles.art")],
        accent: "190 90% 56%",
        testId: "tool-card-shiny-maker",
      },
      {
        id: "ball",
        href: "/tools/pokeball-maker",
        title: pb("cardTitle"),
        subtitle: pb("cardSubtitle"),
        tags: [bm("tabs.patterns"), bm("tabs.finish"), bm("tabs.stickers"), bm("export.stl")],
        accent: "356 86% 60%",
        testId: "tool-card-pokeball-maker",
      },
      {
        id: "tier",
        href: "/tools/tier-list",
        title: tl("card.title"),
        subtitle: tl("card.subtitle"),
        tags: [tl("modes.tier"), tl("modes.bracket"), tl("modes.top", { n: 10 }), tl("modes.blindShort")],
        accent: "258 94% 74%",
        testId: "tool-card-tier-list",
      },
      {
        id: "picker",
        href: "/tools/favorite-pokemon-picker",
        title: fp("cardTitle"),
        subtitle: fp("cardSubtitle"),
        tags: [fp("ogChips.duel"), fp("ogChips.top"), fp("ogChips.types"), fp("ogChips.shiny")],
        accent: "44 96% 62%",
        testId: "tool-card-favorite-picker",
      },
    ],
    shiny: {
      w: sp?.w ?? 74,
      h: sp?.h ?? 80,
      firstDots,
      labels: {
        first: t("view.yours"),
        official: t("view.official"),
        gold: t("extras.gold"),
        neon: t("extras.neon"),
        pastel: t("extras.pastel"),
        silver: t("extras.silver"),
        water: t("types.water"),
        ghost: t("types.ghost"),
        electric: t("types.electric"),
        psychic: t("types.psychic"),
      },
    },
    balls: RACK.map((id) => {
      const css = ballCss(ballPreset(id));
      return css.startsWith(HIGHLIGHT) ? css.slice(HIGHLIGHT.length) : css;
    }),
  };
}
