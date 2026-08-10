"use client";

/** SVG countdown ring. Turns red in the final 4 seconds. */

const SIZE = 64;
const STROKE = 5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function CircularTimer({
  secondsLeft,
  totalSeconds,
}: {
  secondsLeft: number;
  totalSeconds: number;
}) {
  const fraction = Math.max(0, Math.min(1, secondsLeft / totalSeconds));
  const urgent = secondsLeft <= 4;
  return (
    <div
      className="relative h-16 w-16 shrink-0"
      role="timer"
      aria-live="off"
      aria-label={`${Math.ceil(secondsLeft)} seconds remaining`}
    >
      <svg width={SIZE} height={SIZE} className="-rotate-90">
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={urgent ? "var(--danger)" : "var(--accent-2)"}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          style={{ transition: "stroke-dashoffset 0.2s linear, stroke 0.3s" }}
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center font-mono text-lg font-bold tabular-nums ${
          urgent ? "text-red-400" : "text-foreground"
        }`}
      >
        {Math.max(0, Math.ceil(secondsLeft))}
      </span>
    </div>
  );
}
