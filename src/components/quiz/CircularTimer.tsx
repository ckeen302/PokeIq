"use client";

import { cn } from "@/lib/utils";

/**
 * SVG countdown ring. Driven purely by props (no internal timer) so the
 * controller stays the single source of truth for time.
 */
interface CircularTimerProps {
  /** 0..1 fraction of time remaining. */
  progress: number;
  secondsLeft: number;
  size?: number;
}

export function CircularTimer({ progress, secondsLeft, size = 52 }: CircularTimerProps) {
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const urgent = progress < 0.25;

  return (
    <div
      className="relative"
      style={{ width: size, height: size }}
      role="timer"
      aria-label={`${secondsLeft} seconds remaining`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-secondary"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          className={cn(
            "transition-[stroke-dashoffset,stroke] duration-150 ease-linear",
            urgent ? "stroke-destructive" : "stroke-primary"
          )}
        />
      </svg>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums",
          urgent && "animate-pulse text-destructive"
        )}
      >
        {secondsLeft}
      </span>
    </div>
  );
}
