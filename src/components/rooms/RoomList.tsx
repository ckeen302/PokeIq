"use client";

import { useState } from "react";
import Link from "next/link";
import { MessagesSquare, Users } from "lucide-react";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { ROOMS } from "@/lib/rooms";
import { cn } from "@/lib/utils";

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
      {ROOMS.map((r, i) => {
        // The first room is the main one: a full-width, bigger card.
        const main = i === 0;
        return (
          <li key={r.id} className={cn(main && "sm:col-span-2")}>
            <Link
              href={`/rooms/${r.id}`}
              className={cn(
                "hud flex h-full gap-3 rounded-lg border bg-card hover:border-primary/60",
                main ? "items-center border-primary/40 p-5 sm:p-7" : "p-4",
              )}
            >
              <MessagesSquare className={cn("shrink-0 text-primary", main ? "h-8 w-8 sm:h-10 sm:w-10" : "h-5 w-5")} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className={cn("font-display font-bold uppercase", main ? "text-2xl sm:text-3xl" : "text-lg")}>{r.name}</span>
                  <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                    <Users className="h-3 w-3" aria-hidden /> {counts[r.id] ?? 0}
                  </span>
                </span>
                <span className={cn("block text-muted-foreground", main ? "mt-1 text-base" : "text-sm")}>{r.description}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
