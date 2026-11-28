import { GAME_IDS, gameView } from "@/lib/nuzlocke/games.server";
import { nuzGameCard } from "@/lib/og/nuzlocke";

/** GET /tools/nuzlocke-tracker/<game>/og: a game's preview card. */
export const runtime = "nodejs";
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return GAME_IDS().map((game) => ({ game }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ game: string }> }) {
  const view = await gameView((await params).game);
  if (!view) return new Response("Not found", { status: 404 });
  return nuzGameCard(view);
}
