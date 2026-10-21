import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { guardAuthRequest, serverError } from "@/lib/server/auth-route";
import { deletePicture, uploadPicture } from "@/lib/server/avatar-uploads";
import { ownAvatar } from "@/lib/server/avatars";
import { PICTURE_MAX_BYTES } from "@/lib/avatar";

/**
 * POST   /api/avatar/upload (multipart, field "file"): a new profile picture,
 *        held for a moderator's review (see server/avatar-uploads.ts).
 * DELETE /api/avatar/upload?which=pending|approved: deletes the picture
 *        waiting for review, or the approved one.
 * Signed-in accounts only.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: NO_STORE });

export async function POST(request: NextRequest) {
  const blocked = guardAuthRequest(request, "avatar-upload", 10);
  if (blocked) return blocked;
  // Refuse a big body before reading it (the multipart wrapping adds a little).
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > PICTURE_MAX_BYTES + 64 * 1024) return fail("That image is too big: the limit is 2 MB.", 413);
  try {
    const user = await userFromRequest(request);
    if (!user) return fail("Sign in to upload a picture.", 401);
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") return fail("Choose an image to upload.", 400);
    if (file.size > PICTURE_MAX_BYTES) return fail("That image is too big: the limit is 2 MB.", 413);
    const out = await uploadPicture(user, Buffer.from(await file.arrayBuffer()), file.type);
    if (!out.ok) return fail(out.error, out.status);
    return NextResponse.json({ ok: true, id: out.id, avatar: await ownAvatar(user) }, { headers: NO_STORE });
  } catch (err) {
    return serverError(err);
  }
}

export async function DELETE(request: NextRequest) {
  const blocked = guardAuthRequest(request, "avatar-upload", 10);
  if (blocked) return blocked;
  const which = request.nextUrl.searchParams.get("which");
  if (which !== "pending" && which !== "approved") return fail("Say which picture to delete.", 400);
  try {
    const user = await userFromRequest(request);
    if (!user) return fail("Sign in first.", 401);
    const out = await deletePicture(user, which);
    if (!out.ok) return fail(out.error, out.status);
    return NextResponse.json({ ok: true, avatar: await ownAvatar(user) }, { headers: NO_STORE });
  } catch (err) {
    return serverError(err);
  }
}
