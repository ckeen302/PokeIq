"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Loader2, UserPlus } from "lucide-react";
import { useAccount } from "@/lib/account";
import { friendAction, openFriends, refreshFriends, useCommunity } from "@/lib/friends-client";
import { loadBattleSeat } from "@/lib/battle/seat";
import { loadSeat } from "@/lib/duel-seat";
import type { ChallengeKind, MetRelation, MetResponse } from "@/lib/community";
import { Button } from "@/components/ui/button";

/** "Add friend" on a trainer's profile. Guests are asked to sign in. */
export function AddFriendButton({ username }: { username: string }) {
  const account = useAccount();
  const { list, off } = useCommunity();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const me = account.user?.username;

  useEffect(() => {
    if (me && !list) void refreshFriends();
  }, [me, list]);

  if (account.status !== "ready" || off) return null;
  if (!me) {
    return (
      <Link href="/login" className="inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 font-display text-xs font-semibold uppercase tracking-wider hover:border-screen/60">
        <UserPlus className="h-4 w-4" aria-hidden /> Sign in to add friend
      </Link>
    );
  }
  if (me.toLowerCase() === username.toLowerCase()) return null;
  const lower = username.toLowerCase();
  const has = (names: { username: string }[] | undefined) => !!names?.some((n) => n.username.toLowerCase() === lower);
  const relation: MetRelation = !list
    ? "none"
    : list.blocked.some((n) => n.toLowerCase() === lower)
      ? "blocked"
      : has(list.friends)
        ? "friends"
        : has(list.outgoing)
          ? "sent"
          : has(list.incoming)
            ? "received"
            : "none";

  async function add() {
    setBusy(true);
    setError(null);
    await friendAction({ action: relation === "received" ? "accept" : "request", username }).catch((err: Error) => setError(err.message));
    setBusy(false);
  }
  return <RelationButton relation={relation} busy={busy || !list} error={error} onAdd={() => void add()} />;
}

function RelationButton({ relation, busy, error, onAdd }: { relation: MetRelation; busy: boolean; error: string | null; onAdd: () => void }) {
  if (relation === "friends")
    return (
      <span className="inline-flex items-center gap-1.5 font-display text-xs font-semibold uppercase tracking-wider text-success" data-testid="friend-status-badge">
        <Check className="h-4 w-4" aria-hidden /> Friends
      </span>
    );
  if (relation === "sent") return <span className="hud-label">Friend request sent</span>;
  if (relation === "blocked") return <span className="hud-label">Blocked</span>;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button size="sm" variant="outline" disabled={busy} onClick={onAdd} data-testid="add-friend">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserPlus className="h-4 w-4" aria-hidden />} {relation === "received" ? "Accept friend request" : "Add friend"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

/**
 * "Add friend" after a battle or duel with a signed-in opponent. Each side
 * registers its own seat; the button shows once both have, and the request
 * goes through the game, so neither account name is revealed first.
 */
export function AddFriendAfterGame({ kind, code }: { kind: ChallengeKind; code: string }) {
  const account = useAccount();
  const [met, setMet] = useState<MetResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedIn = !!account.user;

  useEffect(() => {
    if (!signedIn) return;
    const token = kind === "battle" ? loadBattleSeat(code) : loadSeat(code);
    if (!token) return;
    let gone = false;
    let tries = 0;
    let timer: number | undefined;
    const check = async () => {
      tries++;
      try {
        const res = await fetch("/api/friends/met", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, code, token }) });
        const out = (await res.json().catch(() => null)) as MetResponse | null;
        if (gone || !res.ok || !out?.available) return;
        setMet(out);
        // The opponent may not have got here yet: look once or twice more.
        if (!out.account && tries < 3) timer = window.setTimeout(() => void check(), 8_000);
      } catch {
        // No button, then.
      }
    };
    void check();
    return () => {
      gone = true;
      window.clearTimeout(timer);
    };
  }, [signedIn, kind, code]);

  if (!met?.account) return null;
  async function add() {
    const token = kind === "battle" ? loadBattleSeat(code) : loadSeat(code);
    setBusy(true);
    setError(null);
    try {
      const out = await friendAction({ action: "request", via: { kind, code, token } });
      setMet({ ...met!, relation: out.status === "friends" ? "friends" : "sent" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the request.");
    }
    setBusy(false);
  }
  return (
    <div className="flex justify-center" data-testid="add-friend-after">
      {met.relation === "received" ? (
        <Button size="sm" variant="outline" onClick={() => openFriends("requests")}>
          <UserPlus className="h-4 w-4" aria-hidden /> They sent you a friend request
        </Button>
      ) : (
        <RelationButton relation={met.relation ?? "none"} busy={busy} error={error} onAdd={() => void add()} />
      )}
    </div>
  );
}
