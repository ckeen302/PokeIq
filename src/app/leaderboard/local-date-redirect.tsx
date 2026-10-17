"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isValidDailyDate, localDateString } from "@/lib/daily";

/**
 * Daily puzzles follow the player's local date, but the server only knows
 * UTC. When the board was opened without a date, switch to the viewer's
 * local day if it differs (no-JS visitors keep the UTC board).
 */
export function LocalDateRedirect({ serverDate }: { serverDate: string }) {
  const router = useRouter();
  useEffect(() => {
    const local = localDateString();
    if (local !== serverDate && isValidDailyDate(local)) {
      router.replace(`/leaderboard?board=daily&date=${local}`, { scroll: false });
    }
  }, [router, serverDate]);
  return null;
}
