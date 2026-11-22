import { serverT } from "@/i18n/server";
import tierList from "@/messages/tier-list";
import { templateCard } from "@/lib/og/tier-list";

/** GET /tools/tier-list/og: the Tier List Maker's own preview card. */
export const runtime = "nodejs";
export const dynamic = "force-static";

export function GET() {
  const t = serverT(tierList);
  return templateCard(t("ogName"), t("ogMaker"), t("title"), [t("modes.tier"), t("modes.bracket"), t("modes.top", { n: 10 }), t("modes.blind")], [4, 25, 150, 448, 658, 1000]);
}
