import { gameIds, gameView } from "@/lib/nuzlocke/games.server";

/** GET /tools/nuzlocke-tracker/<game>/data.json: the game as the run screen uses it (lib/nuzlocke/view), built with the site. */
export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  return (await gameIds()).map((game) => ({ game }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ game: string }> }) {
  const view = await gameView((await params).game);
  if (!view) return new Response("Not found", { status: 404 });
  // The page lists the sources; the run screen doesn't need them.
  return Response.json({ ...view, sources: [] }, { headers: { "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" } });
}
