"use client";

import { useEffect, useState } from "react";

function format(msLeft: number): string {
  if (msLeft <= 0) return "00:00:00";
  const totalSeconds = Math.floor(msLeft / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/** Ticking HH:MM:SS until `endsAt`. Renders a stable placeholder until mounted. */
export function Countdown({
  endsAt,
  className,
}: {
  endsAt: string;
  className?: string;
}) {
  const [display, setDisplay] = useState("--:--:--");

  useEffect(() => {
    const target = Date.parse(endsAt);
    const tick = () => setDisplay(format(target - Date.now()));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [endsAt]);

  return (
    <time className={className} dateTime={endsAt} suppressHydrationWarning>
      {display}
    </time>
  );
}
