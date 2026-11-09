import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { userFromRequest } from "@/lib/server/auth";
import { guardAuthRequest, serverError } from "@/lib/server/auth-route";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { NO_STORE, emailOff, providerEmail } from "@/lib/server/email/route";
import { saveSettings, viewOf } from "@/lib/server/email/service";
import { EmailUnavailable, emailStore } from "@/lib/server/email/store";

/**
 * The signed-in trainer's daily reminder emails (404 while email is off).
 * GET -> EmailSettingsView
 * PUT { email?, dailyEmail?, streakNudge?, resend? } -> EmailSettingsView + { confirm }
 *   A new address (or `resend`) sends "Confirm your email".
 */

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().max(320).nullish(),
  dailyEmail: z.boolean().optional(),
  streakNudge: z.boolean().optional(),
  resend: z.boolean().optional(),
});

const UNAVAILABLE = "Emails aren't available yet — try again later.";

export async function GET(request: NextRequest) {
  const off = emailOff();
  if (off) return off;
  try {
    const user = await userFromRequest(request);
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: NO_STORE });
    const [sub, suggestion] = await Promise.all([emailStore().get(user.id), providerEmail(user.id)]);
    return NextResponse.json(viewOf(sub, suggestion), { headers: NO_STORE });
  } catch (err) {
    return serverError(err);
  }
}

export async function PUT(request: NextRequest) {
  const off = emailOff();
  if (off) return off;
  const blocked = guardAuthRequest(request, "email-settings", 10, 6);
  if (blocked) return blocked;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "That request didn't look right." }, { status: 400, headers: NO_STORE });
  try {
    const user = await userFromRequest(request);
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: NO_STORE });
    // A new address (or "send it again") mails a confirmation: a few an hour per trainer, so an account can't mail strangers on repeat.
    if ((parsed.data.email || parsed.data.resend) && !rateLimit(`email-confirm-send:${user.id}`, 5, 5 / 3600)) {
      return tooManyRequests("You've changed your email a lot. Try again in a while.", 600);
    }
    const out = await saveSettings(user, parsed.data);
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
    return NextResponse.json({ ...viewOf(out.sub, null), confirm: out.confirm }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof EmailUnavailable) return NextResponse.json({ error: UNAVAILABLE }, { status: 503, headers: NO_STORE });
    return serverError(err);
  }
}
