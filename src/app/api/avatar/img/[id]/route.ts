import { NextRequest, NextResponse } from "next/server";
import { sessionTokenHash, userFromRequest } from "@/lib/server/auth";
import { isAdmin } from "@/lib/server/moderation";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { pictureImage, type PictureSize } from "@/lib/server/avatar-uploads";

/**
 * GET /api/avatar/img/:id?s=64|256: a trainer's uploaded picture. Approved
 * pictures are public (and cached); one waiting for review is shown only to
 * its uploader and moderators, never cached; anything else is "not found".
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!rateLimit(`avatar-img:${clientIp(request)}`, 300, 20)) return new NextResponse("Slow down", { status: 429 });
  const { id } = await context.params;
  const size: PictureSize = request.nextUrl.searchParams.get("s") === "256" ? 256 : 64;
  // Only look the viewer up when they're signed in (approved pictures don't need it).
  const user = sessionTokenHash(request) ? await userFromRequest(request).catch(() => null) : null;
  const image = await pictureImage(id, size, { user, admin: isAdmin(user) });
  if (!image) return notFound();
  return new NextResponse(new Uint8Array(image.body), {
    headers: {
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": image.public ? "public, max-age=3600, s-maxage=86400" : "private, no-store",
    },
  });
}
