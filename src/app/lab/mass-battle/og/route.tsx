import type { NextRequest } from "next/server";
import { battleCardImage, presetCardImage, questionCardImage } from "@/lib/og/mass-battle-cards";
import { linkBattle, linkQuestion } from "@/lib/mass-battle/page-data";
import { DEFAULT_PRESET } from "@/lib/mass-battle/presets";

/** GET /lab/mass-battle/og?b=… or ?ask=…: a shared battle's or question's preview card. */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const q = linkQuestion(req.nextUrl.searchParams.get("ask") ?? undefined);
  if (q) return questionCardImage(q);
  const b = linkBattle(req.nextUrl.searchParams.get("b") ?? undefined);
  if (b) return battleCardImage(b);
  return presetCardImage(DEFAULT_PRESET.id);
}
