/** POST /api/auth/logout — destroy the server session, clear the cookie. */
import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  hashSessionToken,
} from "@/lib/auth";
import { deleteSession } from "@/lib/auth-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(hashSessionToken(token));
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
