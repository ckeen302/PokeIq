"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/** Animated answer grid — the visual twin of the shared emoji grid. */
export function ResultGrid({ grid, className }: { grid: string; className?: string }) {
  if (!grid) return null;
  return (
    <div className={cn("flex flex-wrap justify-center gap-1.5", className)} aria-label={`Answers: ${grid.replace(/1/g, "✓").replace(/0/g, "✗")}`}>
      {[...grid].map((c, i) => (
        <motion.span
          key={i}
          className={cn(
            "h-6 w-6 rounded-[3px] shadow-[inset_0_-3px_0_rgb(0_0_0/0.3)]",
            c === "1" ? "bg-success shadow-[0_0_8px_-2px_hsl(var(--success)),inset_0_-3px_0_rgb(0_0_0/0.3)]" : "bg-destructive/80"
          )}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2 + Math.min(i, 30) * 0.04, type: "spring", stiffness: 400, damping: 20 }}
        />
      ))}
    </div>
  );
}
