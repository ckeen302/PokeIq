import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gate } from "@/lib/server/moderation";
import { sameOrigin, sessionTokenHash, userFromRequest } from "@/lib/server/auth";
import { chatRateLimit, clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { CHAT_BODY_MAX } from "@/lib/server/chat";
import { RoomsUnavailable, postToRoom, publicMessage, reportRoomMessage, roomStore } from "@/lib/server/rooms";
import { realtimeClientConfig } from "@/lib/server/realtime";
import { roomById, type RoomState } from "@/lib/rooms";

/**
 * GET  /api/rooms/:id: the room's last 100 messages, its slow mode, and
 *      where to subscribe for new ones (Realtime, when it's set up). The same
 *      for everyone, so the CDN answers most polls (kept 4 s).
 * POST /api/rooms/:id (signed in):
 *   { action: "post", text }     a message (see server/rooms.ts)
 *   { action: "report", id }     report a message to the moderators
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("post"), text: z.string().max(CHAT_BODY_MAX, "Keep it under 200 characters.") }),
  z.object({ action: z.literal("report"), id: z.number().int().positive() }),
]);

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  if (!rateLimit(`room-read:${clientIp(request)}`, 60, 2)) return tooManyRequests();
  const { id } = await context.params;
  const room = roomById(id);
  if (!room) return NextResponse.json({ error: "There's no such room." }, { status: 404, headers: NO_STORE });
  const store = roomStore();
  const off: RoomState = { available: false, room: room.id, messages: [], slow: 0, realtime: null };
  if (!store) return NextResponse.json(off, { headers: NO_STORE });
  try {
    const [messages, slow] = await Promise.all([store.messages(room.id), store.slow(room.id)]);
    const body: RoomState = { available: true, room: room.id, messages: messages.map(publicMessage), slow, realtime: realtimeClientConfig() };
    return NextResponse.json(body, { headers: { "Cache-Control": "public, s-maxage=4, stale-while-revalidate=4" } });
  } catch (err) {
    if (!(err instanceof RoomsUnavailable)) console.error("[rooms]", err);
    return NextResponse.json(off, { headers: NO_STORE });
  }
}

export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403, headers: NO_STORE });
  const { id } = await context.params;
  const room = roomById(id);
  if (!room) return NextResponse.json({ error: "There's no such room." }, { status: 404, headers: NO_STORE });
  const user = sessionTokenHash(request) ? await userFromRequest(request).catch(() => null) : null;
  if (!user) return NextResponse.json({ error: "Sign in to chat in rooms." }, { status: 401, headers: NO_STORE });
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const body = parsed.data;
  if (body.action === "post") {
    const blocked = await gate(request, "chat");
    if (blocked) return blocked;
  }
  const store = roomStore();
  if (!store) return NextResponse.json({ error: "Chat rooms open soon." }, { status: 503, headers: NO_STORE });
  try {
    if (body.action === "report") {
      if (!rateLimit(`room-report:${user.id}`, 10, 10 / 3600)) return tooManyRequests("You've sent a lot of reports. Try again later.", 300);
      const out = await reportRoomMessage(store, user, room.id, body.id, request.headers.get("user-agent")?.slice(0, 400) ?? null);
      return out.ok ? NextResponse.json({ ok: true }, { headers: NO_STORE }) : NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
    }
    const limited = chatRateLimit(clientIp(request), user.id);
    if (limited) return limited;
    const out = await postToRoom(store, user, room.id, body.text);
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
    return NextResponse.json({ ok: true, message: out.message }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof RoomsUnavailable) return NextResponse.json({ error: "Chat rooms open soon." }, { status: 503, headers: NO_STORE });
    console.error("[rooms]", err);
    return NextResponse.json({ error: "Something went wrong on our side. Try again." }, { status: 500, headers: NO_STORE });
  }
}
