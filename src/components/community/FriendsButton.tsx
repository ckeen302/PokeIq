"use client";

import { Users } from "lucide-react";
import { openFriends, useCommunity } from "@/lib/friends-client";

/** The header's friends icon: a badge counts friend requests and challenges waiting. */
export function FriendsButton() {
  const c = useCommunity();
  const waiting = c.requests + c.challenges.length;
  return (
    <button
      type="button"
      onClick={() => openFriends(c.requests > 0 && c.challenges.length === 0 ? "requests" : "friends")}
      aria-label={waiting ? `Friends (${waiting} waiting)` : "Friends"}
      className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      data-testid="friends-button"
    >
      <Users className="h-4 w-4" aria-hidden />
      {waiting > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-pixel text-[9px] text-primary-foreground" data-testid="friends-badge">
          {waiting > 9 ? "9+" : waiting}
        </span>
      )}
    </button>
  );
}
