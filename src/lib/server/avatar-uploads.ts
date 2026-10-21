import "server-only";
import sharp from "sharp";
import { getServiceSupabase } from "@/lib/supabase";
import {
  PICTURE_ID_RE,
  PICTURE_MAX_BYTES,
  PICTURE_STRIKE_LIMIT,
  PICTURE_TYPES,
  PICTURES_PER_DAY,
  type AvatarSettings,
  type PendingPicture,
  type PictureStatus,
} from "@/lib/avatar";
import { randomId } from "./crypto";
import { blockedReason, sanctionOf } from "./moderation";
import { AvatarsUnavailable, avatarStore, forget, ownStoredAvatar, updateStoredAvatar } from "./avatars";
import type { PublicUser } from "./accounts";

/**
 * Trainers' own profile pictures, pre-moderated (migration 0021 and the
 * private Storage bucket `avatars`):
 *
 * - Signed-in accounts only; not while banned or muted, nor after
 *   PICTURE_STRIKE_LIMIT rejections with a strike; PICTURES_PER_DAY a day.
 * - PNG, JPEG, WebP or GIF (its first frame), up to 2 MB. Decoded with
 *   sharp, metadata (EXIF, GPS...) dropped, centre-cropped square and
 *   re-encoded as 256 and 64 px WebP. Anything that doesn't decode is refused.
 * - A new picture is pending: only its uploader (and moderators) can see it,
 *   through /api/avatar/img, until a moderator approves it. Everyone else
 *   keeps seeing the trainer's Pokémon. The bucket is private: every image
 *   is served by that route, which checks the picture's status.
 *
 * Until the table and the bucket exist, uploading says it opens soon. With
 * POKEIQ_LOCAL_ACCOUNTS=1 (tests, local E2E) and in development without
 * Supabase, pictures live in memory.
 */

export const PICTURE_SIZES = [64, 256] as const;
export type PictureSize = (typeof PICTURE_SIZES)[number];
const DAY_MS = 86_400_000;

export interface UploadRow {
  id: string;
  userId: string;
  username: string;
  status: PictureStatus;
  strike: boolean;
  at: number;
  reviewedAt: number | null;
  reviewedBy: string | null;
}

export class UploadsUnavailable extends Error {}

export interface UploadStore {
  /** The table and the bucket are there. */
  ready(): Promise<boolean>;
  insert(row: UploadRow): Promise<void>;
  get(id: string): Promise<UploadRow | null>;
  update(id: string, change: Partial<Pick<UploadRow, "status" | "strike" | "reviewedAt" | "reviewedBy">>): Promise<void>;
  /** The trainer's uploads, newest first (enough for today's count, strikes and the current ones). */
  mine(userId: string): Promise<UploadRow[]>;
  pending(limit: number): Promise<UploadRow[]>;
  pendingCount(): Promise<number>;
  putImage(path: string, body: Buffer): Promise<void>;
  getImage(path: string): Promise<Buffer | null>;
  removeImages(paths: string[]): Promise<void>;
}

const imagePaths = (id: string) => PICTURE_SIZES.map((s) => `${id}/${s}.webp`);

// ---- memory ------------------------------------------------------------------------

type MemDb = { rows: Map<string, UploadRow>; images: Map<string, Buffer> };
const globalStore = globalThis as unknown as { __pokeiqPictures?: MemDb };
const mem = (): MemDb => (globalStore.__pokeiqPictures ??= { rows: new Map(), images: new Map() });

export function clearMemoryPictures() {
  globalStore.__pokeiqPictures = { rows: new Map(), images: new Map() };
}

export function memoryUploadStore(): UploadStore {
  const newest = (rows: Iterable<UploadRow>) => [...rows].sort((a, b) => b.at - a.at).map((r) => ({ ...r }));
  return {
    ready: async () => true,
    async insert(row) {
      mem().rows.set(row.id, { ...row });
    },
    async get(id) {
      const r = mem().rows.get(id);
      return r ? { ...r } : null;
    },
    async update(id, change) {
      const r = mem().rows.get(id);
      if (r) Object.assign(r, change);
    },
    async mine(userId) {
      return newest([...mem().rows.values()].filter((r) => r.userId === userId)).slice(0, 100);
    },
    async pending(limit) {
      return newest([...mem().rows.values()].filter((r) => r.status === "pending"))
        .reverse()
        .slice(0, limit);
    },
    async pendingCount() {
      return [...mem().rows.values()].filter((r) => r.status === "pending").length;
    },
    async putImage(path, body) {
      mem().images.set(path, body);
    },
    async getImage(path) {
      return mem().images.get(path) ?? null;
    },
    async removeImages(paths) {
      for (const p of paths) mem().images.delete(p);
    },
  };
}

// ---- Supabase ------------------------------------------------------------------------

type Sb = NonNullable<ReturnType<typeof getServiceSupabase>>;
const BUCKET = "avatars";
const MISSING = new Set(["42P01", "PGRST205"]);
const RECHECK_MS = 60_000;
let readyUntil = 0;
let missingUntil = 0;

function check(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (MISSING.has(error.code ?? "") || /does not exist|schema cache/i.test(error.message ?? "")) {
    if (Date.now() >= missingUntil) console.warn("[pictures] uploads are off until migration 0021_avatars.sql is applied:", error.message);
    missingUntil = Date.now() + RECHECK_MS;
    throw new UploadsUnavailable(error.message);
  }
  throw new Error(error.message);
}

interface DbRow {
  id: string;
  user_id: string;
  username: string;
  status: PictureStatus;
  strike: boolean;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}
const COLS = "id, user_id, username, status, strike, created_at, reviewed_at, reviewed_by";
const fromDb = (r: DbRow): UploadRow => ({
  id: r.id,
  userId: r.user_id,
  username: r.username,
  status: r.status,
  strike: r.strike,
  at: Date.parse(r.created_at),
  reviewedAt: r.reviewed_at ? Date.parse(r.reviewed_at) : null,
  reviewedBy: r.reviewed_by,
});

export function supabaseUploadStore(sb: Sb): UploadStore {
  const table = () => sb.from("avatar_uploads");
  return {
    async ready() {
      const now = Date.now();
      if (now < readyUntil) return true;
      if (now < missingUntil) return false;
      try {
        const { error } = await table().select("id").limit(1);
        check(error);
        // The bucket: private, made on first use (creating one that exists is a harmless error).
        const { data } = await sb.storage.getBucket(BUCKET);
        if (!data) {
          const made = await sb.storage.createBucket(BUCKET, { public: false, fileSizeLimit: PICTURE_MAX_BYTES, allowedMimeTypes: ["image/webp"] });
          if (made.error && !/exist/i.test(made.error.message)) throw new Error(made.error.message);
        }
        readyUntil = now + 10 * RECHECK_MS;
        return true;
      } catch (err) {
        if (!(err instanceof UploadsUnavailable)) console.error("[pictures] not ready:", err);
        missingUntil = now + RECHECK_MS;
        return false;
      }
    },
    async insert(row) {
      const { error } = await table().insert({ id: row.id, user_id: row.userId, username: row.username, status: row.status, strike: row.strike, created_at: new Date(row.at).toISOString() });
      check(error);
    },
    async get(id) {
      const { data, error } = await table().select(COLS).eq("id", id).maybeSingle<DbRow>();
      check(error);
      return data ? fromDb(data) : null;
    },
    async update(id, change) {
      const { error } = await table()
        .update({
          ...(change.status && { status: change.status }),
          ...(change.strike !== undefined && { strike: change.strike }),
          ...(change.reviewedAt !== undefined && { reviewed_at: change.reviewedAt === null ? null : new Date(change.reviewedAt).toISOString() }),
          ...(change.reviewedBy !== undefined && { reviewed_by: change.reviewedBy }),
        })
        .eq("id", id);
      check(error);
    },
    async mine(userId) {
      const { data, error } = await table().select(COLS).eq("user_id", userId).order("created_at", { ascending: false }).limit(100);
      check(error);
      return ((data ?? []) as DbRow[]).map(fromDb);
    },
    async pending(limit) {
      const { data, error } = await table().select(COLS).eq("status", "pending").order("created_at", { ascending: true }).limit(limit);
      check(error);
      return ((data ?? []) as DbRow[]).map(fromDb);
    },
    async pendingCount() {
      const { count, error } = await table().select("id", { count: "exact", head: true }).eq("status", "pending");
      check(error);
      return count ?? 0;
    },
    async putImage(path, body) {
      const { error } = await sb.storage.from(BUCKET).upload(path, body, { contentType: "image/webp", upsert: true });
      if (error) throw new Error(error.message);
    },
    async getImage(path) {
      const { data, error } = await sb.storage.from(BUCKET).download(path);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    },
    async removeImages(paths) {
      if (paths.length) await sb.storage.from(BUCKET).remove(paths);
    },
  };
}

export function uploadStore(): UploadStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryUploadStore();
  const sb = getServiceSupabase();
  if (sb) return supabaseUploadStore(sb);
  return process.env.NODE_ENV !== "production" ? memoryUploadStore() : null;
}

/** The store, when uploads are open here (the migration and the bucket are in place). */
async function readyStore(): Promise<UploadStore | null> {
  const store = uploadStore();
  if (!store || !avatarStore()?.saves()) return null;
  return (await store.ready()) ? store : null;
}

// ---------------------------------------------------------------------------
// Checking and processing an image
// ---------------------------------------------------------------------------

export type Processed = { ok: true; images: Record<PictureSize, Buffer> } | { ok: false; status: number; error: string };

const SHARP_FORMATS: Record<string, (typeof PICTURE_TYPES)[number]> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

/**
 * Checks an upload (its declared type, its size, and that its content
 * really is one of the allowed formats and decodes) and makes the square
 * WebPs. Nothing of the original is kept: no metadata survives re-encoding.
 */
export async function processPicture(body: Buffer, declaredType: string): Promise<Processed> {
  if (!(PICTURE_TYPES as readonly string[]).includes(declaredType)) return { ok: false, status: 415, error: "Use a PNG, JPEG, WebP or GIF image." };
  if (body.length === 0) return { ok: false, status: 400, error: "That file is empty." };
  if (body.length > PICTURE_MAX_BYTES) return { ok: false, status: 413, error: "That image is too big: the limit is 2 MB." };
  try {
    // First frame only (pages: 1), and a cap on pixels against decompression bombs.
    const input = () => sharp(body, { pages: 1, failOn: "error", limitInputPixels: 40_000_000 });
    const meta = await input().metadata();
    if (!meta.format || !SHARP_FORMATS[meta.format]) return { ok: false, status: 415, error: "Use a PNG, JPEG, WebP or GIF image." };
    const images = {} as Record<PictureSize, Buffer>;
    for (const size of PICTURE_SIZES) {
      // rotate(): honour the camera's orientation before the EXIF is dropped.
      images[size] = await input().rotate().resize(size, size, { fit: "cover", position: "centre" }).webp({ quality: 82 }).toBuffer();
    }
    return { ok: true, images };
  } catch {
    return { ok: false, status: 400, error: "That image couldn't be read. Try another one." };
  }
}

// ---------------------------------------------------------------------------
// The trainer's side
// ---------------------------------------------------------------------------

function summary(rows: UploadRow[], now: number) {
  return {
    today: rows.filter((r) => now - r.at < DAY_MS).length,
    strikes: rows.filter((r) => r.strike).length,
    pending: rows.find((r) => r.status === "pending") ?? null,
  };
}

/** Why `user` can't upload right now (sanctions or strikes), or null. */
async function uploadBlocked(user: PublicUser, strikes: number): Promise<string | null> {
  const sanction = blockedReason(await sanctionOf(user.id), "chat");
  if (sanction) return sanction;
  if (strikes >= PICTURE_STRIKE_LIMIT) return "Uploading pictures is closed for your account after earlier pictures broke the rules.";
  return null;
}

/** The pictures part of the trainer's avatar settings. */
export async function pictureSettings(user: PublicUser, now = Date.now()): Promise<AvatarSettings["pictures"]> {
  const closed = { open: false, approved: null, pending: null, left: 0, blocked: null };
  const store = await readyStore().catch(() => null);
  if (!store) return closed;
  try {
    const [rows, stored] = await Promise.all([store.mine(user.id), ownStoredAvatar(user)]);
    const s = summary(rows, now);
    return {
      open: true,
      approved: stored.picture ?? null,
      pending: s.pending ? { id: s.pending.id, at: s.pending.at } : null,
      left: Math.max(0, PICTURES_PER_DAY - s.today),
      blocked: await uploadBlocked(user, s.strikes),
    };
  } catch (err) {
    if (!(err instanceof UploadsUnavailable)) console.error("[pictures]", err);
    return closed;
  }
}

export type PictureResult = { ok: true; id?: string } | { ok: false; status: number; error: string };
const SOON: PictureResult = { ok: false, status: 503, error: "Uploading your own picture opens soon." };

/** A new picture from `user`: checked, processed and stored as pending (replacing any picture still waiting). */
export async function uploadPicture(user: PublicUser, body: Buffer, type: string, now = Date.now()): Promise<PictureResult> {
  const store = await readyStore();
  if (!store) return SOON;
  try {
    const rows = await store.mine(user.id);
    const s = summary(rows, now);
    const blocked = await uploadBlocked(user, s.strikes);
    if (blocked) return { ok: false, status: 403, error: blocked };
    if (s.today >= PICTURES_PER_DAY) return { ok: false, status: 429, error: `That's ${PICTURES_PER_DAY} pictures today. Try again tomorrow.` };
    const processed = await processPicture(body, type);
    if (!processed.ok) return processed;
    const id = randomId(18);
    for (const size of PICTURE_SIZES) await store.putImage(`${id}/${size}.webp`, processed.images[size]);
    await store.insert({ id, userId: user.id, username: user.username, status: "pending", strike: false, at: now, reviewedAt: null, reviewedBy: null });
    // They want to show it: it shows once approved (the Pokémon until then).
    await updateStoredAvatar(user, (a) => ({ ...a, usePicture: true }));
    for (const old of rows.filter((r) => r.status === "pending")) {
      await store.update(old.id, { status: "deleted" });
      await store.removeImages(imagePaths(old.id));
    }
    return { ok: true, id };
  } catch (err) {
    if (err instanceof UploadsUnavailable || err instanceof AvatarsUnavailable) return SOON;
    throw err;
  }
}

/** The trainer deletes their picture waiting for review, or their approved one. */
export async function deletePicture(user: PublicUser, which: "pending" | "approved"): Promise<PictureResult> {
  const store = await readyStore();
  if (!store) return SOON;
  try {
    const rows = await store.mine(user.id);
    const stored = await ownStoredAvatar(user);
    const target = which === "pending" ? rows.find((r) => r.status === "pending") : rows.find((r) => r.status === "approved" && r.id === stored.picture);
    if (!target) return { ok: false, status: 404, error: which === "pending" ? "No picture is waiting for review." : "You have no picture to delete." };
    await store.update(target.id, { status: "deleted" });
    await store.removeImages(imagePaths(target.id));
    if (which === "approved") await updateStoredAvatar(user, (s) => ({ ...s, picture: null, usePicture: false }));
    return { ok: true };
  } catch (err) {
    if (err instanceof UploadsUnavailable || err instanceof AvatarsUnavailable) return SOON;
    throw err;
  }
}

/**
 * A picture's image for whoever asks: approved ones for anyone; pending ones
 * for their uploader and moderators only; nothing else. Null: not found.
 */
export async function pictureImage(id: string, size: PictureSize, viewer: { user: PublicUser | null; admin: boolean }): Promise<{ body: Buffer; public: boolean } | null> {
  if (!PICTURE_ID_RE.test(id)) return null;
  const store = uploadStore();
  if (!store) return null;
  try {
    const row = await store.get(id);
    if (!row) return null;
    const isPublic = row.status === "approved";
    const mayView = isPublic || (row.status === "pending" && (viewer.admin || viewer.user?.id === row.userId));
    if (!mayView) return null;
    const body = await store.getImage(`${id}/${size}.webp`);
    return body ? { body, public: isPublic } : null;
  } catch (err) {
    if (!(err instanceof UploadsUnavailable)) console.error("[pictures] image:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Moderators
// ---------------------------------------------------------------------------

export async function pendingPictures(limit = 60): Promise<{ pending: PendingPicture[]; count: number } | null> {
  const store = await readyStore();
  if (!store) return null;
  const [rows, count] = await Promise.all([store.pending(limit), store.pendingCount()]);
  return { pending: rows.map((r) => ({ id: r.id, username: r.username, at: r.at })), count };
}

/** Approves a pending picture: it becomes the trainer's picture (their previous one goes). Returns the uploader's name. */
export async function approvePicture(id: string, admin: string, now = Date.now()): Promise<{ ok: true; username: string } | { ok: false; status: number; error: string }> {
  const store = await readyStore();
  if (!store) return { ok: false, status: 503, error: "Picture uploads need migration 0021 and the avatars bucket." };
  const row = await store.get(id);
  if (!row || row.status !== "pending") return { ok: false, status: 409, error: "That picture isn't waiting for review any more." };
  const user = { id: row.userId, username: row.username };
  const was = await ownStoredAvatar(user);
  await store.update(id, { status: "approved", reviewedAt: now, reviewedBy: admin });
  await updateStoredAvatar(user, (s) => ({ ...s, picture: id }));
  if (was.picture && was.picture !== id) {
    await store.update(was.picture, { status: "deleted" });
    await store.removeImages(imagePaths(was.picture));
  }
  forget(row.userId, row.username);
  return { ok: true, username: row.username };
}

/** Rejects a pending picture (and deletes it), with a strike if it broke the rules. Returns the uploader's name and their strikes. */
export async function rejectPicture(
  id: string,
  admin: string,
  strike: boolean,
  now = Date.now()
): Promise<{ ok: true; username: string; strikes: number } | { ok: false; status: number; error: string }> {
  const store = await readyStore();
  if (!store) return { ok: false, status: 503, error: "Picture uploads need migration 0021 and the avatars bucket." };
  const row = await store.get(id);
  if (!row || row.status !== "pending") return { ok: false, status: 409, error: "That picture isn't waiting for review any more." };
  await store.update(id, { status: "rejected", strike, reviewedAt: now, reviewedBy: admin });
  await store.removeImages(imagePaths(id));
  const strikes = (await store.mine(row.userId)).filter((r) => r.strike).length;
  return { ok: true, username: row.username, strikes };
}
