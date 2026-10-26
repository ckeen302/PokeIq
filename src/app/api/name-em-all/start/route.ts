import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { sessionTokenHash, userFromRequest } from "@/lib/server/auth";
import { neaPlayerKey, neaStartToken } from "@/lib/server/name-em-all-board";
import { parseScope } from "@/lib/server/name-em-all";

/**
 * POST /api/name-em-all/start { scope, player } — the server's clock for a
 * ranked run: a signed start time the result is checked against.
 */

const NO_STORE = { "Cache-Control": "no-store" };
const bodySchema = z.object({
  scope: z.string().max(40),
  player: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "Bad player id."),
});

export async function POST(request: NextRequest) {
  if (!rateLimit(`nea-start:${clientIp(request)}`, 30, 0.5)) return tooManyRequests();
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const scope = parseScope(parsed.data.scope);
  if (!scope) return NextResponse.json({ error: "No such quiz." }, { status: 400, headers: NO_STORE });
  const user = sessionTokenHash(request) ? await userFromRequest(request).catch(() => null) : null;
  const key = neaPlayerKey(user ? `u:${user.id}` : `d:${parsed.data.player}`);
  return NextResponse.json({ token: neaStartToken(scope.scope, key) }, { headers: NO_STORE });
}
