import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin, sessionTokenHash, userFromRequest } from "@/lib/server/auth";
import { hmac, randomId } from "@/lib/server/crypto";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { maskChat } from "@/lib/server/chat";
import { isKnownShot } from "@/lib/server/geo";
import { reportShot } from "@/lib/server/geo-reports";
import { GEO_REPORT_MODES, GEO_REPORT_NOTE_MAX, GEO_REPORT_REASON_IDS, GEO_SHOT_ID_RE } from "@/lib/geo-reports";

/**
 * POST /api/geo/report — { shot, reason, mode, note? }: a player flags a
 * PokéGuessr screenshot (wrong place, wrong game, gives the answer away, too
 * generic, bad image…). One report per player (signed in) or device per
 * shot; enough distinct reporters take the shot out of rotation until a
 * moderator reviews it on /admin. Reports never break the game: before the
 * table exists, they're logged and thanked.
 */

const NO_STORE = { "Cache-Control": "no-store" };
/** A random id per browser, so a player who isn't signed in reports each shot once. */
const DEVICE_COOKIE = "piq_geo_device";
const DEVICE_RE = /^[A-Za-z0-9_-]{12,32}$/;

const bodySchema = z.object({
  shot: z.string().regex(GEO_SHOT_ID_RE, "Unknown screenshot."),
  reason: z.enum(GEO_REPORT_REASON_IDS),
  mode: z.enum(GEO_REPORT_MODES),
  note: z.string().trim().max(GEO_REPORT_NOTE_MAX, `Keep it under ${GEO_REPORT_NOTE_MAX} characters.`).optional(),
});

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
  const ip = clientIp(request);
  // A player reports a few shots a game at most.
  if (!rateLimit(`geo-report:${ip}`, 8, 1 / 45)) return tooManyRequests("You've sent a lot of reports. Try again in a few minutes.", 120);
  if (!rateLimit("geo-report-all", 300, 3)) return tooManyRequests("Lots of reports right now. Try again in a few minutes.", 120);

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { shot, reason, mode } = parsed.data;
  if (!isKnownShot(shot)) return NextResponse.json({ error: "Unknown screenshot." }, { status: 404 });
  const note = parsed.data.note ? maskChat(parsed.data.note.replace(/[\p{Cc}\p{Cf}]/gu, " ")).text.slice(0, GEO_REPORT_NOTE_MAX) || null : null;

  const user = sessionTokenHash(request) ? await userFromRequest(request).catch(() => null) : null;
  const known = request.cookies.get(DEVICE_COOKIE)?.value;
  const device = known && DEVICE_RE.test(known) ? known : randomId(12);
  const reporter = user ? `u:${user.id}` : `d:${device}`;
  if (!rateLimit(`geo-report-who:${reporter}`, 8, 1 / 45)) return tooManyRequests("You've sent a lot of reports. Try again in a few minutes.", 120);

  const out = await reportShot({ shot, reason, mode, note, reporter, ipHash: hmac("geo-report-ip", ip).toString("hex").slice(0, 32) });
  const response = out.ok
    ? NextResponse.json({ ok: true }, { headers: NO_STORE })
    : NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
  if (!user && device !== known) {
    response.cookies.set(DEVICE_COOKIE, device, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/geo/report",
      maxAge: 365 * 24 * 60 * 60,
    });
  }
  return response;
}
