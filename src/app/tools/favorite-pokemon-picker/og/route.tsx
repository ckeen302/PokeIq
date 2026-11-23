import type { NextRequest } from "next/server";
import { serverT } from "@/i18n/server";
import page from "@/messages/favorite-picker-page";
import picker from "@/messages/favorite-picker";
import { sharedCard, toolCard } from "@/lib/og/favorite-picker";
import { decodeResult } from "@/lib/favorite-picker/link";
import { resolveShared } from "@/lib/favorite-picker/server";

/** GET /tools/favorite-pokemon-picker/og?d=…: a shared result's preview card (the picker's own card without a valid link). */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const t = serverT(page);
  const p = serverT(picker);
  const shared = decodeResult(req.nextUrl.searchParams.get("d"));
  const resolved = shared ? resolveShared(shared) : null;
  if (!resolved || (!resolved.top.length && !resolved.chart.length)) {
    return toolCard({
      eyebrow: t("ogFavorite"),
      title: [t("ogTitle.a"), t("ogTitle.b")],
      chips: [t("ogChips.duel"), t("ogChips.top"), t("ogChips.types"), t("ogChips.shiny")],
    });
  }
  return sharedCard(resolved, { favorite: t("ogFavorite"), chart: t("ogChart"), tool: t("title"), typeName: (type) => p(`typeNames.${type}`) });
}
