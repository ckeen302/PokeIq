"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { BadgeDef } from "@/lib/achievements";

/** Bottom-stacked unlock toasts for freshly earned gym badges. */
export function BadgeToasts({ badges }: { badges: BadgeDef[] }) {
  const [visible, setVisible] = useState<BadgeDef[]>([]);

  useEffect(() => {
    setVisible(badges);
    if (badges.length === 0) return;
    const timer = setTimeout(() => setVisible([]), 6000);
    return () => clearTimeout(timer);
  }, [badges]);

  return (
    <div
      className="pointer-events-none fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4"
      aria-live="polite"
    >
      <AnimatePresence>
        {visible.map((badge, i) => (
          <motion.div
            key={badge.id}
            initial={{ opacity: 0, y: 30, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ delay: i * 0.25, type: "spring", stiffness: 300, damping: 22 }}
            className="glass flex items-center gap-3 rounded-2xl border-amber-400/30 p-3 shadow-xl"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400/30 to-orange-500/20 text-2xl">
              {badge.emoji}
            </span>
            <div className="min-w-0 text-left">
              <p className="text-sm font-bold text-amber-300">
                Badge unlocked — {badge.name}!
              </p>
              <p className="truncate text-xs text-muted">{badge.description}</p>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
