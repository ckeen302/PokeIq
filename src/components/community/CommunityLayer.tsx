"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, Loader2, Swords, Trophy, X } from "lucide-react";
import { useAccount } from "@/lib/account";
import { answerChallenge, beat, dismissNote, openTournamentMatch, useCommunity } from "@/lib/friends-client";
import { PRESENCE_BEAT_MS, PRESENCE_MIN_GAP_MS, activityFromPath } from "@/lib/community";
import { Button } from "@/components/ui/button";
import { FriendsPanel } from "./FriendsPanel";

/**
 * Site-wide friends: the presence heartbeat (signed-in trainers only; once
 * a minute while the tab is visible, paused while it's hidden, plus one on
 * coming back or changing page at most every 20 s), the friends panel, and
 * toasts for challenges and their answers.
 */
export function CommunityLayer() {
  const account = useAccount();
  const pathname = usePathname();
  const community = useCommunity();
  const userId = account.user?.id ?? null;
  const path = useRef(pathname);
  path.current = pathname;
  const kick = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!userId) return;
    let timer: number | undefined;
    let last = 0;
    let stopped = false;
    const visible = () => document.visibilityState === "visible";
    const schedule = () => {
      window.clearTimeout(timer);
      if (!stopped && visible()) timer = window.setTimeout(run, PRESENCE_BEAT_MS);
    };
    async function run() {
      if (stopped || !visible()) return;
      last = Date.now();
      const keepGoing = await beat(activityFromPath(path.current));
      if (!keepGoing) stopped = true;
      schedule();
    }
    const soon = () => {
      if (!visible()) return window.clearTimeout(timer);
      if (Date.now() - last >= PRESENCE_MIN_GAP_MS) void run();
      else schedule();
    };
    kick.current = soon;
    void run();
    document.addEventListener("visibilitychange", soon);
    window.addEventListener("focus", soon);
    return () => {
      stopped = true;
      kick.current = () => undefined;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", soon);
      window.removeEventListener("focus", soon);
    };
  }, [userId]);

  // A new page is a new activity: tell friends (throttled like a refocus).
  useEffect(() => kick.current(), [pathname]);

  return (
    <>
      {community.open && <FriendsPanel />}
      {userId && <Toasts />}
    </>
  );
}

function Toasts() {
  const router = useRouter();
  const pathname = usePathname();
  const community = useCommunity();
  const { challenges, answers } = community;
  // Not on the match's own page.
  const matches = community.matches.filter((m) => pathname !== `/battle/live/${m.code}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!challenges.length && !answers.length && !matches.length && !error) return null;

  async function answer(id: string, accept: boolean) {
    setBusy(id);
    setError(null);
    try {
      const href = await answerChallenge(id, accept);
      if (href) router.push(href);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't answer the challenge.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed bottom-20 right-4 z-[60] flex w-80 flex-col gap-2 lg:bottom-6" aria-live="polite">
      {matches.slice(0, 2).map((m) => (
        <div key={m.code} role="alert" className="hud rounded-lg border border-warning/60 bg-card p-3 shadow-xl" data-testid="match-toast">
          <p className="hud-label flex items-center gap-1.5 text-warning">
            <Trophy className="h-3.5 w-3.5" aria-hidden /> Your match is ready
          </p>
          <p className="mt-1 text-sm">
            {m.title}: you vs <span className="font-semibold">{m.against}</span>.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="success" onClick={() => router.push(openTournamentMatch(m))}>
              <Swords className="h-3.5 w-3.5" aria-hidden /> Play now
            </Button>
            <Button size="sm" variant="ghost" onClick={() => dismissNote(m.code)}>
              Later
            </Button>
          </div>
        </div>
      ))}
      {challenges.slice(0, 3).map((c) => (
        <div key={c.id} role="alert" className="hud rounded-lg border border-primary/60 bg-card p-3 shadow-xl" data-testid="challenge-toast">
          <p className="hud-label flex items-center gap-1.5 text-primary">
            <Swords className="h-3.5 w-3.5" aria-hidden /> Challenge
          </p>
          <p className="mt-1 text-sm">
            <span className="font-semibold">{c.from}</span> challenges you to a <span className="font-semibold">{c.label}</span>.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="success" disabled={busy === c.id} onClick={() => void answer(c.id, true)}>
              {busy === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />} Accept
            </Button>
            <Button size="sm" variant="ghost" disabled={busy === c.id} onClick={() => void answer(c.id, false)}>
              Decline
            </Button>
          </div>
        </div>
      ))}
      {answers.map((a) => (
        <div key={a.id} role="status" className="flex items-start gap-2 rounded-lg border bg-card p-3 text-sm shadow-xl">
          <p className="flex-1">
            <span className="font-semibold">{a.to}</span> {a.status === "accepted" ? "accepted" : "declined"} your {a.label} challenge.
          </p>
          <button type="button" aria-label="Close" className="text-muted-foreground hover:text-foreground" onClick={() => dismissNote(a.id)}>
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ))}
      {error && (
        <p role="alert" className="rounded-lg border border-destructive/50 bg-card p-3 text-sm text-destructive shadow-xl">
          {error}
        </p>
      )}
    </div>
  );
}
