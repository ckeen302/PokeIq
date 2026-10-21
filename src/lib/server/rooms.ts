import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { ROOM_KEPT, roomById, type RoomMessage } from "@/lib/rooms";
import type { ChatLine } from "@/lib/chat";
import type { PublicUser } from "./accounts";
import { chatBlocked, checkChat } from "./chat";
import { saveReport } from "./reports";
import { broadcastRoom } from "./realtime";
import { avatarsByIds } from "./avatars";

/**
 * Chat rooms (migration 0020): each room keeps its last 100 messages and a
 * slow mode. Posting is for signed-in trainers only, with battle chat's
 * safety (no links, swears masked, mostly-masked messages refused, a
 * message a second and five in ten seconds) plus the room's slow mode.
 * Memory with POKEIQ_LOCAL_ACCOUNTS=1 and in development without
 * Supabase; before the migration every call throws RoomsUnavailable.
 */

export class RoomsUnavailable extends Error {}

export interface StoredMessage extends RoomMessage {
  room: string;
  /** The sender's account (server-only). */
  userId: string;
}

export interface RoomStore {
  /** The newest `limit`, oldest first. */
  messages(room: string, limit?: number): Promise<StoredMessage[]>;
  /** One trainer's latest in a room, oldest first. */
  recentBy(room: string, userId: string, limit: number): Promise<StoredMessage[]>;
  message(room: string, id: number): Promise<StoredMessage | null>;
  insert(msg: Omit<StoredMessage, "id">): Promise<StoredMessage>;
  /** Drops all but the newest `keep`. */
  trim(room: string, keep: number): Promise<void>;
  remove(room: string, id: number): Promise<boolean>;
  clear(room: string): Promise<void>;
  /** Slow mode, in seconds. */
  slow(room: string): Promise<number>;
  setSlow(room: string, seconds: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

type MemDb = { seq: number; messages: StoredMessage[]; slow: Map<string, number> };
const globalStore = globalThis as unknown as { __pokeiqRooms?: MemDb };
const mem = (): MemDb => (globalStore.__pokeiqRooms ??= { seq: 0, messages: [], slow: new Map() });

export function clearMemoryRooms() {
  globalStore.__pokeiqRooms = { seq: 0, messages: [], slow: new Map() };
}

export function memoryRoomStore(): RoomStore {
  const inRoom = (room: string) => mem().messages.filter((m) => m.room === room);
  return {
    async messages(room, limit = ROOM_KEPT) {
      return inRoom(room).slice(-limit).map((m) => ({ ...m }));
    },
    async recentBy(room, userId, limit) {
      return inRoom(room)
        .filter((m) => m.userId === userId)
        .slice(-limit)
        .map((m) => ({ ...m }));
    },
    async message(room, id) {
      const m = mem().messages.find((x) => x.room === room && x.id === id);
      return m ? { ...m } : null;
    },
    async insert(msg) {
      const db = mem();
      const stored = { ...msg, id: ++db.seq };
      db.messages.push(stored);
      return { ...stored };
    },
    async trim(room, keep) {
      const ids = new Set(inRoom(room).slice(-keep).map((m) => m.id));
      mem().messages = mem().messages.filter((m) => m.room !== room || ids.has(m.id));
    },
    async remove(room, id) {
      const before = mem().messages.length;
      mem().messages = mem().messages.filter((m) => !(m.room === room && m.id === id));
      return mem().messages.length < before;
    },
    async clear(room) {
      mem().messages = mem().messages.filter((m) => m.room !== room);
    },
    async slow(room) {
      return mem().slow.get(room) ?? 0;
    },
    async setSlow(room, seconds) {
      mem().slow.set(room, seconds);
    },
  };
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

type Sb = NonNullable<ReturnType<typeof getServiceSupabase>>;

function check(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "")) throw new RoomsUnavailable(error.message);
  throw new Error(error.message);
}

type Row = { id: number; room: string; user_id: string; name: string; text: string; created_at: string };
const COLS = "id, room, user_id, name, text, created_at";
const fromRow = (r: Row): StoredMessage => ({ id: Number(r.id), room: r.room, userId: r.user_id, name: r.name, text: r.text, at: Date.parse(r.created_at) });

export function supabaseRoomStore(sb: Sb): RoomStore {
  return {
    async messages(room, limit = ROOM_KEPT) {
      const { data, error } = await sb.from("room_messages").select(COLS).eq("room", room).order("id", { ascending: false }).limit(limit);
      check(error);
      return ((data ?? []) as Row[]).map(fromRow).reverse();
    },
    async recentBy(room, userId, limit) {
      const { data, error } = await sb.from("room_messages").select(COLS).eq("room", room).eq("user_id", userId).order("id", { ascending: false }).limit(limit);
      check(error);
      return ((data ?? []) as Row[]).map(fromRow).reverse();
    },
    async message(room, id) {
      const { data, error } = await sb.from("room_messages").select(COLS).eq("room", room).eq("id", id).maybeSingle<Row>();
      check(error);
      return data ? fromRow(data) : null;
    },
    async insert(msg) {
      const { data, error } = await sb
        .from("room_messages")
        .insert({ room: msg.room, user_id: msg.userId, name: msg.name, text: msg.text, created_at: new Date(msg.at).toISOString() })
        .select(COLS)
        .single<Row>();
      check(error);
      return fromRow(data!);
    },
    async trim(room, keep) {
      const { data, error } = await sb.from("room_messages").select("id").eq("room", room).order("id", { ascending: false }).range(keep, keep);
      check(error);
      const cut = (data as { id: number }[] | null)?.[0]?.id;
      if (cut === undefined) return;
      const del = await sb.from("room_messages").delete().eq("room", room).lte("id", cut);
      check(del.error);
    },
    async remove(room, id) {
      const { data, error } = await sb.from("room_messages").delete().eq("room", room).eq("id", id).select("id");
      check(error);
      return (data ?? []).length > 0;
    },
    async clear(room) {
      const { error } = await sb.from("room_messages").delete().eq("room", room);
      check(error);
    },
    async slow(room) {
      const { data, error } = await sb.from("room_settings").select("slow_seconds").eq("room", room).maybeSingle<{ slow_seconds: number }>();
      check(error);
      return data?.slow_seconds ?? 0;
    },
    async setSlow(room, seconds) {
      const { error } = await sb.from("room_settings").upsert({ room, slow_seconds: seconds, updated_at: new Date().toISOString() });
      check(error);
    },
  };
}

export function roomStore(): RoomStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryRoomStore();
  const sb = getServiceSupabase();
  if (sb) return supabaseRoomStore(sb);
  return process.env.NODE_ENV !== "production" ? memoryRoomStore() : null;
}

// ---------------------------------------------------------------------------
// Posting, reporting, moderating
// ---------------------------------------------------------------------------

export type Fail = { ok: false; status: number; error: string };
export type Result<T = object> = ({ ok: true } & T) | Fail;
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export const publicMessage = (m: StoredMessage): RoomMessage => ({ id: m.id, at: m.at, name: m.name, text: m.text });

/** Messages as anyone may see them, each with its sender's avatar (one lookup for all). */
export async function publicMessages(messages: StoredMessage[]): Promise<RoomMessage[]> {
  const avatars = await avatarsByIds(messages.map((m) => m.userId));
  return messages.map((m) => {
    const avatar = avatars.get(m.userId);
    return avatar ? { ...publicMessage(m), avatar } : publicMessage(m);
  });
}

/** A signed-in trainer's message (muted or banned trainers are turned away before this): checked, rate-limited, slowed, stored and delivered. */
export async function postToRoom(store: RoomStore, user: PublicUser, room: string, raw: unknown, now = Date.now()): Promise<Result<{ message: RoomMessage }>> {
  if (!roomById(room)) return fail(404, "There's no such room.");
  const [recent, slow] = await Promise.all([store.recentBy(room, user.id, 5), store.slow(room)]);
  const last = recent[recent.length - 1];
  if (slow > 0 && last && now - last.at < slow * 1000) {
    const wait = Math.ceil((slow * 1000 - (now - last.at)) / 1000);
    return fail(429, `Slow mode is on: one message every ${slow} seconds. Wait ${wait}s.`);
  }
  const lines: ChatLine[] = recent.map((m, n) => ({ n, at: m.at, seat: 0, text: m.text }));
  const blocked = chatBlocked(lines, 0, now);
  if (blocked) return fail(429, blocked);
  const checked = checkChat(raw);
  if (!checked.ok) return fail(400, checked.error);
  const stored = await store.insert({ room, userId: user.id, name: user.username, text: checked.text, at: now });
  await store.trim(room, ROOM_KEPT);
  const avatar = (await avatarsByIds([user.id])).get(user.id);
  const message = { ...publicMessage(stored), ...(avatar ? { avatar } : {}) };
  await broadcastRoom({ type: "msg", room, msg: message });
  return { ok: true, message };
}

/** Reports a message: the server attaches it and the few before it, from its own records, so a report can't be made up. */
export async function reportRoomMessage(store: RoomStore, reporter: PublicUser, room: string, id: number, userAgent: string | null): Promise<Result> {
  const message = await store.message(room, id);
  if (!message) return fail(404, "That message is gone.");
  const all = await store.messages(room);
  const at = all.findIndex((m) => m.id === id);
  const context = all.slice(Math.max(0, at - 8), at + 3).map((m) => ({ id: m.id, at: m.at, name: m.name, text: m.text }));
  await saveReport({
    kind: "chat",
    category: null,
    mode: "rooms",
    message: `Chat report (room ${room}): ${message.name} said "${message.text}"`,
    page: `/rooms/${room}`,
    userAgent,
    contact: null,
    reporter: reporter.username,
    extra: { chat: { game: "room", code: room, id, at: message.at, name: message.name, userId: message.userId, text: message.text }, context },
  });
  return { ok: true };
}

export async function deleteRoomMessage(store: RoomStore, room: string, id: number): Promise<Result> {
  if (!(await store.remove(room, id))) return fail(404, "That message is gone.");
  await broadcastRoom({ type: "del", room, id });
  return { ok: true };
}

export async function clearRoom(store: RoomStore, room: string): Promise<Result> {
  await store.clear(room);
  await broadcastRoom({ type: "clear", room });
  return { ok: true };
}

export async function setSlowMode(store: RoomStore, room: string, seconds: number): Promise<Result> {
  await store.setSlow(room, seconds);
  await broadcastRoom({ type: "slow", room, slow: seconds });
  return { ok: true };
}
