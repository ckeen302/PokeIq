"use client";

/**
 * The browser side of a signed Supabase Realtime channel (server/realtime.ts
 * publishes to it): subscribes with the public anon key, drops any broadcast
 * the server didn't sign (anyone holding the anon key can write to a public
 * channel), reports whether the channel is up, and when it isn't, reconnects
 * with backoff until it is. The page keeps polling meanwhile.
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

/** The `data` string of a broadcast payload, if the server signed it with `jwk`; null otherwise. */
export async function verifySigned(payload: unknown, jwk: JsonWebKey): Promise<string | null> {
  try {
    const { data, sig } = (payload ?? {}) as { data?: unknown; sig?: unknown };
    if (typeof data !== "string" || typeof sig !== "string" || data.length > 4000) return null;
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, await importKey(jwk), b64(sig), new TextEncoder().encode(data));
    return ok ? data : null;
  } catch {
    return null;
  }
}

/** A subscription that hasn't come up (or back up) in this long is torn down and made afresh. */
export const LIVE_WATCHDOG_MS = 12_000;
/** The wait before the n-th fresh attempt: 1 s, 2 s, 4 s… up to 30 s, with a little jitter. */
export const retryDelay = (attempt: number, random = Math.random()): number => Math.round(Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)) * (0.8 + 0.4 * random));

export interface LiveChannelOptions<T> {
  config: { url: string; anon: string; key: JsonWebKey };
  topic: string;
  event: string;
  /** The event in a verified `data` string, or null if it isn't one to act on. */
  parse: (data: string) => T | null;
  onEvent: (event: T) => void;
  /** Called when the channel comes up or goes down (once per change). */
  onStatus: (up: boolean) => void;
}

/** What `openLiveChannel` needs of a Supabase client: enough for a test to stand one in. */
export interface LiveClient {
  channel(topic: string): LiveChannelLike;
  removeAllChannels(): Promise<unknown>;
  realtime: { disconnect(): void };
}
export interface LiveChannelLike {
  on(type: "broadcast", filter: { event: string }, callback: (message: { payload: unknown }) => void): LiveChannelLike;
  subscribe(callback: (status: string) => void): LiveChannelLike;
}

/** Makes the Supabase client; a test passes its own. */
export type MakeClient = (url: string, anon: string) => Promise<LiveClient>;

const defaultMakeClient: MakeClient = async (url, anon) => {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as LiveClient;
};

/**
 * Subscribes to `topic` and keeps the subscription alive: a channel that
 * errors, times out or closes is reported down and, if it doesn't come back
 * on its own within the watchdog, remade with backoff (and at once when the
 * browser says it's back online). Returns a function that closes it.
 */
export function openLiveChannel<T>({ config, topic, event, parse, onEvent, onStatus }: LiveChannelOptions<T>, makeClient: MakeClient = defaultMakeClient): () => void {
  let closed = false;
  let up = false;
  let attempt = 0;
  let client: LiveClient | null = null;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const report = (next: boolean) => {
    if (up === next) return;
    up = next;
    onStatus(next);
  };

  function teardown() {
    clearTimeout(watchdog);
    watchdog = undefined;
    const c = client;
    client = null;
    if (!c) return;
    try {
      void c.removeAllChannels().catch(() => {});
      c.realtime.disconnect();
    } catch {
      // nothing to free
    }
  }

  /** Starts over after the backoff. */
  function remake() {
    if (closed || retry) return;
    teardown();
    report(false);
    retry = setTimeout(() => {
      retry = undefined;
      void open();
    }, retryDelay(attempt++));
  }

  function armWatchdog() {
    clearTimeout(watchdog);
    watchdog = setTimeout(remake, LIVE_WATCHDOG_MS);
  }

  async function open() {
    if (closed) return;
    let c: LiveClient;
    try {
      c = await makeClient(config.url, config.anon);
    } catch {
      remake();
      return;
    }
    if (closed) {
      try {
        c.realtime.disconnect();
      } catch {
        // already gone
      }
      return;
    }
    client = c;
    armWatchdog();
    c.channel(topic)
      .on("broadcast", { event }, ({ payload }) => {
        if (closed) return;
        void verifySigned(payload, config.key).then((data) => {
          const e = data === null ? null : parse(data);
          if (e !== null && !closed) onEvent(e);
        });
      })
      .subscribe((status) => {
        if (closed || c !== client) return;
        if (status === "SUBSCRIBED") {
          attempt = 0;
          clearTimeout(watchdog);
          watchdog = undefined;
          report(true);
        } else {
          // The library rejoins on its own after a dropped socket; the watchdog starts over if it can't.
          report(false);
          armWatchdog();
        }
      });
  }

  const onOnline = () => {
    if (!up && !closed) {
      clearTimeout(retry);
      retry = undefined;
      attempt = 0;
      remake();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("online", onOnline);

  void open();

  return () => {
    closed = true;
    clearTimeout(retry);
    retry = undefined;
    if (typeof window !== "undefined") window.removeEventListener("online", onOnline);
    teardown();
  };
}
