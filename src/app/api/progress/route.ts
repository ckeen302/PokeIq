import { NextRequest, NextResponse } from "next/server";
import { saveProgress } from "@/lib/server/accounts";
import { userFromRequest } from "@/lib/server/auth";
import { guardAuthRequest, serverError } from "@/lib/server/auth-route";
import { normalizeProgress } from "@/lib/progress-merge";

/** PUT /api/progress — { progress } -> saved to the signed-in trainer's account. */
export async function PUT(request: NextRequest) {
  const blocked = guardAuthRequest(request, "progress", 30);
  if (blocked) return blocked;

  const body = (await request.json().catch(() => null)) as { progress?: unknown } | null;
  const progress = normalizeProgress(body?.progress);
  if (!progress) return NextResponse.json({ error: "That doesn't look like trainer progress." }, { status: 400 });

  try {
    const user = await userFromRequest(request);
    if (!user) return NextResponse.json({ error: "Sign in to sync progress." }, { status: 401 });
    await saveProgress(user.id, progress);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err);
  }
}
