"use client";

import { roomTopic, type RoomEvent } from "./rooms";

/**
 * The browser side of room delivery over Supabase Realtime. Every broadcast
 * is signed by the server; anything that isn't (someone else writing to the
 * public channel with the anon key) is dropped unread.
 */

const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));

const keys = new Map<string, Promise<CryptoKey>>();

function importKey(jwk: JsonWebKey): Promise<CryptoKey> {
  const id = `${jwk.x}.${jwk.y}`;
  let key = keys.get(id);
  if (!key) {
    key = crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    keys.set(id, key);
  }
  return key;
}

/** The event in a broadcast, if the server signed it for this room; null otherwise. */
export async function verifyRoomEvent(payload: unknown, jwk: JsonWebKey, room: string): Promise<RoomEvent | null> {
  try {
    const { data, sig } = payload as { data?: unknown; sig?: unknown };
    if (typeof data !== "string" || typeof sig !== "string" || data.length > 4000) return null;
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, await importKey(jwk), b64(sig), new TextEncoder().encode(data));
    if (!ok) return null;
    const event = JSON.parse(data) as RoomEvent;
    return event.room === room ? event : null;
  } catch {
    return null;
  }
}

/** Subscribes to a room's channel; `onEvent` gets verified events only. `onDown` if the channel can't be used (the page falls back to polling). */
export async function subscribeRoom(
  config: { url: string; anon: string; key: JsonWebKey },
  room: string,
  onEvent: (e: RoomEvent) => void,
  onDown: () => void
): Promise<() => void> {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(config.url, config.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const channel = client
    .channel(roomTopic(room))
    .on("broadcast", { event: "room" }, ({ payload }) => {
      void verifyRoomEvent(payload, config.key, room).then((e) => e && onEvent(e));
    })
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onDown();
    });
  return () => {
    void client.removeChannel(channel);
  };
}
