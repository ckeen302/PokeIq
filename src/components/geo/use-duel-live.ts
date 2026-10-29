"use client";

import { useEffect, useRef, useState } from "react";
import { DUEL_LIVE_EVENT, duelTopic, parseDuelLiveEvent, type DuelLiveConfig } from "@/lib/geo-duel-live";
import { openLiveChannel } from "@/lib/realtime-client";

/**
 * The duel's live channel in the page: subscribed while the server says
 * where (`view.live`), it calls `onBump` with each revision the server
 * publishes, and says how the channel is doing so the HUD can show
 * "Reconnecting…" and polling can slow down while it's up.
 *
 *   off         not set up on this server: the page polls every second
 *   connecting  first connection under way
 *   up          pushes arrive; polling is a slow safety net
 *   down        lost; reconnecting with backoff, polling every second meanwhile
 */
export type DuelLiveStatus = "off" | "connecting" | "up" | "down";

export function useDuelLive(config: DuelLiveConfig | null | undefined, code: string, onBump: (rev: number) => void): DuelLiveStatus {
  const [status, setStatus] = useState<DuelLiveStatus>(config ? "connecting" : "off");
  const bump = useRef(onBump);
  bump.current = onBump;
  const url = config?.url;
  const anon = config?.anon;
  const x = config?.key.x;
  const y = config?.key.y;
  useEffect(() => {
    if (!url || !anon || !x || !y) {
      setStatus("off");
      return;
    }
    setStatus("connecting");
    const close = openLiveChannel({
      config: { url, anon, key: { kty: "EC", crv: "P-256", x, y } },
      topic: duelTopic(code),
      event: DUEL_LIVE_EVENT,
      parse: (data) => parseDuelLiveEvent(data, code),
      onEvent: (e) => bump.current(e.rev),
      onStatus: (up) => setStatus(up ? "up" : "down"),
    });
    return close;
  }, [url, anon, x, y, code]);
  return status;
}
