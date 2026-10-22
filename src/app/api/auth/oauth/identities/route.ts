import { NextRequest, NextResponse } from "next/server";
import { findUserRecordById, identitiesOf } from "@/lib/server/accounts";
import { hasPassword, userFromRequest } from "@/lib/server/auth";
import { guardAuthRequest, serverError } from "@/lib/server/auth-route";
import { ownIdentities, unlinkIdentity } from "@/lib/server/oauth";
import { isOAuthProvider } from "@/lib/oauth";

/**
 * The signed-in trainer's own connected accounts.
 * GET -> { identities: [{ provider, email, linkedAt }], hasPassword }
 *   (the only response that carries an email, and only the owner's own).
 * DELETE ?provider=discord|google -> unlinks, unless it's the last way in.
 */

const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  try {
    const user = await userFromRequest(request);
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers });
    const [list, record] = await Promise.all([identitiesOf(user.id), findUserRecordById(user.id)]);
    return NextResponse.json({ identities: ownIdentities(list), hasPassword: record ? hasPassword(record.passwordHash) : false }, { headers });
  } catch (err) {
    return serverError(err);
  }
}

export async function DELETE(request: NextRequest) {
  const blocked = guardAuthRequest(request, "oauth-unlink", 10);
  if (blocked) return blocked;
  const provider = request.nextUrl.searchParams.get("provider");
  if (!isOAuthProvider(provider)) return NextResponse.json({ error: "Unknown provider." }, { status: 400, headers });
  try {
    const user = await userFromRequest(request);
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers });
    const result = await unlinkIdentity(user.id, provider);
    if (result === "last_method") {
      return NextResponse.json({ error: "That's your only way to sign in, so it can't be unlinked." }, { status: 409, headers });
    }
    if (result === "not_linked") return NextResponse.json({ error: "That account isn't linked." }, { status: 404, headers });
    return NextResponse.json({ ok: true }, { headers });
  } catch (err) {
    return serverError(err);
  }
}
