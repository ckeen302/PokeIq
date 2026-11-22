"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import runNs from "@/messages/quiz-run";

/** Animated answer grid — the visual twin of the shared emoji grid. */
export function ResultGrid({ grid, className }: { grid: string; className?: string }) {
  const t = useT(runNs);
  if (!grid) return null;
  return (
    <div
      className={cn("flex flex-wrap justify-center gap-1.5", className)}
      role="img"
      aria-label={t("grid.label", { n: [...grid].filter((c) => c === "1").length, total: grid.length, list: [...grid].map((c) => (c === "1" ? t("grid.right") : t("grid.wrong"))).join(t("grid.separator")) })}
    >
      {[...grid].map((c, i) => (
        <motion.span
          key={i}
          className={cn(
            // Narrow phones (360) get a size smaller, so a ten-question run stays one row.
            "h-6 w-6 rounded-[3px] shadow-[inset_0_-3px_0_rgb(0_0_0/0.3)] max-[389px]:h-5 max-[389px]:w-5",
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
