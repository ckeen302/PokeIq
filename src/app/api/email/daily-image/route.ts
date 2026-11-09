import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { isValidDailyDate } from "@/lib/daily";
import { GEO_STORAGE_BASE } from "@/lib/geo-storage";
import { geoDailyFirstShot } from "@/lib/server/geo";
import { syncHiddenShots } from "@/lib/server/geo-reports";
import { syncShotScores } from "@/lib/server/geo-round-scores";
import { emailOff } from "@/lib/server/email/route";

/**
 * GET /api/email/daily-image?date=YYYY-MM-DD — the daily email's picture:
 * that day's first PokéGuessr screenshot (the one /api/geo/daily-shot gives
 * the home page), heavily blurred into a JPEG every email app can show. No
 * place, region or game in it or in its URL. Falls back to the screenshot's
 * tiny placeholder, blown up, if storage can't be reached.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WIDTH = 720;
const HEIGHT = 405;

async function blurred(input: Buffer, sigma: number): Promise<Buffer> {
  return sharp(input).resize(WIDTH, HEIGHT, { fit: "cover" }).blur(sigma).modulate({ brightness: 0.85 }).jpeg({ quality: 70, mozjpeg: true }).toBuffer();
}

export async function GET(request: NextRequest) {
  const off = emailOff();
  if (off) return off;
  const date = request.nextUrl.searchParams.get("date");
  if (!isValidDailyDate(date)) return NextResponse.json({ error: "That daily isn't available." }, { status: 400 });
  await Promise.all([syncHiddenShots(), syncShotScores()]);
  const first = geoDailyFirstShot(date);
  if (!first) return NextResponse.json({ error: "No daily on that date." }, { status: 404 });
  const id = first.shot.split("/").pop() ?? "";
  let jpeg: Buffer | null = null;
  try {
    const upstream = await fetch(`${GEO_STORAGE_BASE}/${id}.webp`, { signal: AbortSignal.timeout(8_000) });
    if (upstream.ok) jpeg = await blurred(Buffer.from(await upstream.arrayBuffer()), 16);
  } catch {
    // Storage unreachable: the placeholder below.
  }
  if (!jpeg && first.blur) {
    jpeg = await blurred(Buffer.from(first.blur.replace(/^data:image\/webp;base64,/, ""), "base64"), 6).catch(() => null);
  }
  if (!jpeg) return NextResponse.redirect(new URL("/icon-512.png", request.url), 302);
  return new NextResponse(new Uint8Array(jpeg), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600" },
  });
}
