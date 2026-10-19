"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveSeat } from "@/lib/duel-seat";
import { setTrainerName, useProgress } from "@/lib/progress";
import { unlockAudio } from "@/lib/sound";

/**
 * "Find an opponent": searches (POST /api/duel/match) about once a second,
 * which keeps the search alive, until the server pairs this trainer with
 * someone searching for the same game and settings. Then the seat is saved,
 * as when joining by link, and it's off to the duel. Cancelling, leaving the
 * page or closing the tab ends the search.
 */

const POLL_MS = 1000;

interface Matched {
  status: "matched";
  code: string;
  token: string;
  href: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useMatchmaking(settings: Record<string, unknown> | undefined) {
  const router = useRouter();
  const progress = useProgress();
  /** When this search began (device time), while one is on. */
  const [since, setSince] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ticket = useRef<string | null>(null);
  /** Each search's number: a cancelled search's loop sees a newer one and stops. */
  const run = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const giveUp = useCallback(() => {
    const t = ticket.current;
    ticket.current = null;
    if (t) {
      // keepalive: still sent when the page is going away.
      void fetch("/api/duel/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", settings: settingsRef.current, ticket: t }),
        keepalive: true,
      }).catch(() => {});
    }
  }, []);

  async function search(name: string) {
    if (!settingsRef.current) return;
    unlockAudio();
    setError(null);
    const id = ++run.current;
    ticket.current = null;
    setSince(Date.now());
    if (!progress?.name) setTrainerName(name);
    while (run.current === id) {
      try {
        const res = await fetch("/api/duel/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "search", settings: settingsRef.current, name, ticket: ticket.current ?? undefined }),
        });
        const data = (await res.json().catch(() => ({}))) as Partial<Matched> & { status?: string; ticket?: string; error?: string };
        if (run.current !== id) return;
        if (res.ok && data.status === "matched" && data.code && data.token && data.href) {
          run.current++;
          ticket.current = null;
          saveSeat(data.code, data.token);
          router.push(`${data.href}?matched=1`);
          return;
        }
        if (res.ok && data.ticket) ticket.current = data.ticket;
        else if (res.status < 500 && res.status !== 429) {
          // A request the server won't take (a bad name): stop and say why. Busy or offline: keep trying.
          setError(data.error ?? `Request failed (${res.status})`);
          setSince(null);
          run.current++;
          return;
        }
      } catch {
        // Offline for a moment: the next poll tries again.
      }
      await sleep(POLL_MS);
    }
  }

  function cancel() {
    run.current++;
    setSince(null);
    giveUp();
  }

  // Leaving the page (or closing the tab) ends the search.
  const searching = since !== null;
  useEffect(() => {
    if (!searching) return;
    window.addEventListener("pagehide", giveUp);
    return () => {
      window.removeEventListener("pagehide", giveUp);
    };
  }, [searching, giveUp]);
  useEffect(() => {
    const runs = run;
    return () => {
      runs.current++;
      giveUp();
    };
  }, [giveUp]);

  return { searching, since, error, search, cancel };
}
