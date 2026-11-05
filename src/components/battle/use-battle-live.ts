"use client";

import { useEffect, useRef, useState } from "react";
import { BATTLE_LIVE_EVENT, battleTopic, parseBattleLiveEvent, type BattleLiveConfig } from "@/lib/battle/live";
import { openLiveChannel } from "@/lib/realtime-client";

/**
 * A live battle's push channel in the page (lib/battle/live.ts): subscribed
 * while the server says where (`view.live`), it calls `onBump` with each
 * revision the server publishes (the page then fetches as usual), and
 * reports whether the channel is up so polling can slow down while it is.
 * Off (false, never subscribing) when the server has no Realtime set up.
 */
export function useBattleLive(config: BattleLiveConfig | null | undefined, code: string, onBump: (rev: number) => void): boolean {
  const [up, setUp] = useState(false);
  const bump = useRef(onBump);
  bump.current = onBump;
  const url = config?.url;
  const anon = config?.anon;
  const x = config?.key.x;
  const y = config?.key.y;
  useEffect(() => {
    setUp(false);
    if (!url || !anon || !x || !y) return;
    const close = openLiveChannel({
      config: { url, anon, key: { kty: "EC", crv: "P-256", x, y } },
      topic: battleTopic(code),
      event: BATTLE_LIVE_EVENT,
      parse: (data) => parseBattleLiveEvent(data, code),
      onEvent: (e) => bump.current(e.rev),
      onStatus: setUp,
    });
    return () => {
      close();
      setUp(false);
    };
  }, [url, anon, x, y, code]);
  return up;
}
