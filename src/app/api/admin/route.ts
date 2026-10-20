import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "@/lib/server/auth";
import { findUserByName } from "@/lib/server/accounts";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { ModerationUnavailable, adminFromRequest, audit, modStore, setSanction } from "@/lib/server/moderation";
import { listReports, resolveReport } from "@/lib/server/reports";
import { RoomsUnavailable, clearRoom, deleteRoomMessage, publicMessage, roomStore, setSlowMode } from "@/lib/server/rooms";
import { adminCancel, adminDisqualify, listTournaments, NoTournaments } from "@/lib/server/tournaments/service";
import { TournamentsUnavailable } from "@/lib/server/tournaments/store";
import { FEEDBACK_CATEGORIES, MUTE_DURATIONS, PERMANENT, type MuteDuration, type Sanction } from "@/lib/moderation";
import { ROOM_IDS, SLOW_MODES } from "@/lib/rooms";
import { USERNAME_RE } from "@/lib/server/auth";

/**
 * The moderators' API, for accounts named in POKEIQ_ADMINS only (anyone
 * else gets a 404, as if it weren't here). Every action is checked here on
 * the server and written to the audit log.
 *
 * GET ?tab=reports&kind=&category=&mode=&status=   reports, newest first
 * GET ?tab=user&name=                             an account and its sanction
 * GET ?tab=rooms&room=                            a room's messages and slow mode
 * GET ?tab=tournaments                            open and running tournaments
 * GET ?tab=audit                                  the latest moderator actions
 * POST { action, ... }                            see bodySchema
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };
const name = z.string().regex(USERNAME_RE, "No trainer by that name.");
const room = z.enum(ROOM_IDS);
const tourId = z.string().regex(/^[a-z0-9-]{8,24}$/);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("resolve"), id: z.number().int().positive(), resolved: z.boolean().default(true) }),
  z.object({ action: z.literal("mute"), name, duration: z.enum(Object.keys(MUTE_DURATIONS) as [MuteDuration, ...MuteDuration[]]) }),
  z.object({ action: z.literal("unmute"), name }),
  z.object({ action: z.literal("ban"), name, reason: z.string().trim().min(1, "Give a reason.").max(200) }),
  z.object({ action: z.literal("unban"), name }),
  z.object({ action: z.literal("deleteMessage"), room, id: z.number().int().positive() }),
  z.object({ action: z.literal("slow"), room, seconds: z.number().int().refine((s) => (SLOW_MODES as readonly number[]).includes(s)) }),
  z.object({ action: z.literal("clearRoom"), room }),
  z.object({ action: z.literal("cancelTournament"), id: tourId, reason: z.string().trim().max(200).default("") }),
  z.object({ action: z.literal("dq"), id: tourId, name }),
]);

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: NO_STORE });

function missingTables(err: unknown) {
  return err instanceof ModerationUnavailable || err instanceof RoomsUnavailable || err instanceof TournamentsUnavailable || err instanceof NoTournaments;
}

export async function GET(request: NextRequest) {
  if (!rateLimit(`admin:${clientIp(request)}`, 60, 1)) return tooManyRequests();
  const admin = await adminFromRequest(request);
  if (!admin) return notFound();
  const q = request.nextUrl.searchParams;
  try {
    switch (q.get("tab")) {
      case "reports": {
        const kind = q.get("kind");
        const category = q.get("category");
        const status = q.get("status");
        const reports = await listReports({
          kind: kind === "chat" || kind === "error" || kind === "feedback" ? kind : undefined,
          category: category && (FEEDBACK_CATEGORIES as readonly string[]).includes(category) ? category : undefined,
          mode: q.get("mode")?.slice(0, 20) || undefined,
          status: status === "resolved" || status === "all" ? status : "open",
        });
        return NextResponse.json({ reports: reports ?? [], stored: reports !== null }, { headers: NO_STORE });
      }
      case "user": {
        const parsed = name.safeParse(q.get("name"));
        if (!parsed.success) return bad("No trainer by that name.", 404);
        const user = await findUserByName(parsed.data);
        if (!user) return bad("No trainer by that name.", 404);
        const sanction = (await modStore()?.sanction(user.id)) ?? null;
        return NextResponse.json({ user: { username: user.username, createdAt: user.createdAt }, sanction }, { headers: NO_STORE });
      }
      case "rooms": {
        const id = room.safeParse(q.get("room"));
        if (!id.success) return bad("There's no such room.", 404);
        const store = roomStore();
        if (!store) return bad("Chat rooms aren't available here.", 503);
        const [messages, slow] = await Promise.all([store.messages(id.data), store.slow(id.data)]);
        return NextResponse.json({ room: id.data, slow, messages: messages.map(publicMessage) }, { headers: NO_STORE });
      }
      case "tournaments":
        return NextResponse.json(await listTournaments(), { headers: NO_STORE });
      case "audit":
        return NextResponse.json({ entries: (await modStore()?.audit(200)) ?? [] }, { headers: NO_STORE });
      default:
        return bad("Unknown tab.");
    }
  } catch (err) {
    if (missingTables(err)) return bad("That needs migration 0020: run it in Supabase first.", 503);
    console.error("[admin]", err);
    return bad("Something went wrong on our side.", 500);
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return bad("Cross-site request blocked.", 403);
  if (!rateLimit(`admin-act:${clientIp(request)}`, 60, 1)) return tooManyRequests();
  const admin = await adminFromRequest(request);
  if (!admin) return notFound();
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return bad(parsed.error.issues[0].message);
  const body = parsed.data;
  const ok = (extra: Record<string, unknown> = {}) => NextResponse.json({ ok: true, ...extra }, { headers: NO_STORE });

  try {
    switch (body.action) {
      case "resolve": {
        if (!(await resolveReport(body.id, admin.username, body.resolved))) return bad("Couldn't mark that report (does it exist, and is migration 0020 applied?).", 409);
        await audit(admin, body.resolved ? "resolve report" : "reopen report", `#${body.id}`);
        return ok();
      }
      case "mute":
      case "unmute":
      case "ban":
      case "unban": {
        const user = await findUserByName(body.name);
        if (!user) return bad("No trainer by that name.", 404);
        if (user.id === admin.id) return bad("You can't do that to yourself.", 409);
        const now = Date.now();
        const was: Sanction = (await modStore()?.sanction(user.id)) ?? { userId: user.id, username: user.username, mutedUntil: null, banned: false, banReason: null, updatedAt: now, updatedBy: admin.username };
        const next: Sanction = { ...was, username: user.username, updatedAt: now, updatedBy: admin.username };
        let detail: string | null = null;
        if (body.action === "mute") {
          const ms = MUTE_DURATIONS[body.duration];
          next.mutedUntil = Number.isFinite(ms) ? now + ms : PERMANENT;
          detail = body.duration;
        } else if (body.action === "unmute") next.mutedUntil = null;
        else if (body.action === "ban") {
          next.banned = true;
          next.banReason = body.reason;
          detail = body.reason;
        } else {
          next.banned = false;
          next.banReason = null;
        }
        await setSanction(next);
        await audit(admin, body.action, user.username, detail);
        return ok({ sanction: next });
      }
      case "deleteMessage":
      case "slow":
      case "clearRoom": {
        const store = roomStore();
        if (!store) return bad("Chat rooms aren't available here.", 503);
        const out =
          body.action === "deleteMessage" ? await deleteRoomMessage(store, body.room, body.id) : body.action === "slow" ? await setSlowMode(store, body.room, body.seconds) : await clearRoom(store, body.room);
        if (!out.ok) return bad(out.error, out.status);
        await audit(admin, body.action === "deleteMessage" ? "delete message" : body.action === "slow" ? "slow mode" : "clear room", body.room, body.action === "deleteMessage" ? `#${body.id}` : body.action === "slow" ? `${body.seconds}s` : null);
        return ok();
      }
      case "cancelTournament":
      case "dq": {
        const out = body.action === "dq" ? await adminDisqualify(body.id, body.name) : await adminCancel(body.id, body.reason ? `Cancelled by a moderator: ${body.reason}` : "Cancelled by a moderator.");
        if (!out.ok) return bad(out.error, out.status);
        await audit(admin, body.action === "dq" ? "disqualify" : "cancel tournament", body.id, body.action === "dq" ? body.name : body.reason || null);
        return ok();
      }
    }
  } catch (err) {
    if (missingTables(err)) return bad("That needs migration 0020: run it in Supabase first.", 503);
    console.error("[admin]", err);
    return bad("Something went wrong on our side.", 500);
  }
}
