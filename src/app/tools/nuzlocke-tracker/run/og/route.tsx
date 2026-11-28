import type { NextRequest } from "next/server";
import { gameView } from "@/lib/nuzlocke/games.server";
import { decodeRun } from "@/lib/nuzlocke/share";
import { nuzRunCard, nuzToolCard } from "@/lib/og/nuzlocke";

/** GET /tools/nuzlocke-tracker/run/og?s=…: a shared run's preview card (the tracker's own card without a run). */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const run = decodeRun(req.nextUrl.searchParams.get("s"));
  const view = run ? await gameView(run.game) : null;
  if (!run || !view) return nuzToolCard();
  return nuzRunCard(run, view);
}
