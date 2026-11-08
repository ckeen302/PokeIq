import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { figureArtUrl } from "@/lib/figure-art";
import { FIGURE_ART_SIZES, type FigureArtSize } from "./figure-art";

const SIZES = new Set<number>(FIGURE_ART_SIZES);

/**
 * The old figure-picture routes (/api/race/home, /api/world-history/art):
 * a permanent redirect to the static file (public/race/art), so links and
 * pages from before still work without a function sending the picture.
 */
export async function figureArtRedirect(request: NextRequest, context: { params: Promise<{ id: string }> }, known: ReadonlySet<number>) {
  const id = Number((await context.params).id);
  const size = Number(request.nextUrl.searchParams.get("s") ?? 512);
  if (!Number.isInteger(id) || !known.has(id) || !SIZES.has(size)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const res = NextResponse.redirect(new URL(figureArtUrl(id, size as FigureArtSize), request.url), 308);
  res.headers.set("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
  return res;
}
