/** POST /api/auth/login — verify credentials, mint a fresh session. */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  SESSION_TTL_MS,
  newSessionToken,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { createSession, findUserByUsername } from "@/lib/auth-store";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const schema = z.object({
  username: z.string().min(1).max(20),
  password: z.string().min(1).max(100),
});

export async function POST(request: NextRequest) {
  if (!rateLimit(`login:${clientIp(request)}`, 10, 60_000)) {
    return NextResponse.json(
      { error: "Too many attempts — slow down" },
      { status: 429 },
    );
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const user = await findUserByUsername(parsed.data.username);
  // Same error for unknown user vs wrong password — no username probing.
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return NextResponse.json(
      { error: "Wrong trainer name or password" },
      { status: 401 },
    );
  }
  const { token, tokenHash } = newSessionToken();
  await createSession({
    tokenHash,
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  });
  const response = NextResponse.json({
    user: { id: user.id, username: user.username },
  });
  setSessionCookie(response, token);
  return response;
}
