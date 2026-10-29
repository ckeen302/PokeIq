import "server-only";
import { createECDH, createPrivateKey, sign, type KeyObject } from "node:crypto";
import { hmac } from "./crypto";
import { roomTopic, type RoomEvent } from "@/lib/rooms";

/**
 * Pushes over Supabase Realtime, when it's configured (the project URL, the
 * service key, and NEXT_PUBLIC_SUPABASE_ANON_KEY for browsers): after a
 * write, the server sends an event to a channel through Realtime's REST
 * broadcast endpoint with the service key (no socket to keep open, so it
 * works from a serverless function), and every page subscribed to that
 * channel gets it without asking. Room messages go this way, and so does a
 * PokéGuessr duel's "something changed" (the duel's new revision: the page
 * then fetches the state it may see, so nothing hidden ever rides the
 * channel).
 *
 * A public channel can be written to by anyone holding the anon key, so
 * each broadcast is signed (ECDSA P-256, a key derived from POKEIQ_SECRET)
 * and browsers drop anything whose signature doesn't check out: only
 * messages that went through the server are ever acted on.
 */

const base64url = (b: Buffer) => b.toString("base64url");

let keys: { priv: KeyObject; pub: JsonWebKey } | null = null;

function signingKeys() {
  if (keys) return keys;
  const d = hmac("room-broadcast-key", "v1");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(d);
  const point = ecdh.getPublicKey();
  const pub: JsonWebKey = { kty: "EC", crv: "P-256", x: base64url(point.subarray(1, 33)), y: base64url(point.subarray(33, 65)) };
  keys = { priv: createPrivateKey({ key: { ...pub, d: base64url(d) }, format: "jwk" }), pub };
  return keys;
}

/** The public key browsers check broadcasts with. */
export const broadcastKey = (): JsonWebKey => signingKeys().pub;

/** A signed payload as the channel carries it: `data` (a JSON string) and its signature. */
export interface SignedPayload {
  data: string;
  sig: string;
}

/** Any event, signed. */
export function signPayload(event: unknown): SignedPayload {
  const data = JSON.stringify(event);
  return { data, sig: base64url(sign("sha256", Buffer.from(data), { key: signingKeys().priv, dsaEncoding: "ieee-p1363" })) };
}

/** `data` (a JSON string) and its signature, as the channel carries them. */
export const signEvent = (event: RoomEvent): SignedPayload => signPayload(event);

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && anon && service ? { url: url.replace(/\/+$/, ""), anon, service } : null;
}

/** Where browsers subscribe (null: Realtime isn't set up, so pages poll). */
export function realtimeClientConfig(): { url: string; anon: string; key: JsonWebKey } | null {
  const c = config();
  return c ? { url: c.url, anon: c.anon, key: broadcastKey() } : null;
}

/** True when broadcasts go out (Realtime is configured). */
export const realtimeEnabled = (): boolean => config() !== null;

/**
 * Sends one signed event to a channel. Never throws, and never takes longer
 * than a moment: a failed broadcast is caught up by the next poll or page
 * load. `label` names the caller in the log.
 */
export async function broadcast(topic: string, event: string, payload: unknown, label: string): Promise<void> {
  const c = config();
  if (!c) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const res = await fetch(`${c.url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: c.service, Authorization: `Bearer ${c.service}` },
      body: JSON.stringify({ messages: [{ topic, event, payload: signPayload(payload) }] }),
      signal: controller.signal,
    });
    if (!res.ok) console.error(`[${label}] broadcast failed: ${res.status}`);
  } catch (err) {
    console.error(`[${label}] broadcast failed:`, err instanceof Error ? err.message : err);
  } finally {
    clearTimeout(timer);
  }
}

/** Sends a room event to its channel. */
export const broadcastRoom = (event: RoomEvent): Promise<void> => broadcast(roomTopic(event.room), "room", event, "rooms");
