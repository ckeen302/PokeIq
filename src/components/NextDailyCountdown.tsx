"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

/** Counts down to the player's local midnight (when the next daily unlocks). */
export function NextDailyCountdown({ label = "Next puzzle in" }: { label?: string }) {
  const [left, setLeft] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const s = Math.max(0, Math.floor((midnight.getTime() - now.getTime()) / 1000));
      const hh = String(Math.floor(s / 3600)).padStart(2, "0");
      const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      setLeft(`${hh}:${mm}:${ss}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
      <Clock className="h-4 w-4" aria-hidden />
      {label} <span className="font-mono font-semibold tabular-nums text-foreground">{left ?? "--:--:--"}</span>
    </div>
  );
}
