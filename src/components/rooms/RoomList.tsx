"use client";

import { useState } from "react";
import Link from "next/link";
import { MessagesSquare, Users } from "lucide-react";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { ROOMS } from "@/lib/rooms";

/** The official rooms, with how many trainers are in each. */
export function RoomList() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  useVisiblePoll(async () => {
    try {
      const res = await fetch("/api/rooms");
      if (res.ok) setCounts(((await res.json()) as { counts: Record<string, number> }).counts);
    } catch {
      // next time
    }
  }, 60_000);
  return (
    <ul className="grid gap-3 sm:grid-cols-2" data-testid="room-list">
      {ROOMS.map((r) => (
        <li key={r.id}>
          <Link href={`/rooms/${r.id}`} className="hud flex h-full gap-3 rounded-lg border bg-card p-4 hover:border-primary/60">
            <MessagesSquare className="h-5 w-5 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="font-display text-lg font-bold uppercase">{r.name}</span>
                <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                  <Users className="h-3 w-3" aria-hidden /> {counts[r.id] ?? 0}
                </span>
              </span>
              <span className="block text-sm text-muted-foreground">{r.description}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
