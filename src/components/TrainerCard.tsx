"use client";

/**
 * Compact trainer profile sourced from localStorage. Renders nothing until
 * mounted (avoids hydration mismatch) or when the visitor hasn't played yet.
 */
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { CATEGORY_META, QUIZ_CATEGORIES } from "@/engines/types";
import { BADGES, loadEarnedBadges } from "@/lib/achievements";
import { accuracyOf, loadStats, type TrainerStats } from "@/lib/stats";
import { cn } from "@/lib/utils";

export function TrainerCard() {
  const [stats, setStats] = useState<TrainerStats | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [earned, setEarned] = useState<Set<string>>(new Set());

  useEffect(() => {
    const loaded = loadStats();
    if (loaded.gamesPlayed > 0) {
      setStats(loaded);
      setEarned(loadEarnedBadges());
    }
    // Signed in? Prefer the account's cross-device stats over this device's.
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            user: { username: string } | null;
            stats?: TrainerStats & { totalScore: number };
          } | null,
        ) => {
          if (cancelled || !data?.user || !data.stats) return;
          setAccount(data.user.username);
          if (data.stats.gamesPlayed > 0) {
            setStats({
              gamesPlayed: data.stats.gamesPlayed,
              totalCorrect: data.stats.totalCorrect,
              totalAnswered: data.stats.totalAnswered,
              bestStreak: data.stats.bestStreak,
              bestScores: data.stats.bestScores ?? {},
              survivalBest: data.stats.survivalBest,
            });
            setEarned(loadEarnedBadges());
          }
        },
      )
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!stats) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass mx-auto mt-10 max-w-2xl rounded-3xl p-6"
      aria-label="Your trainer card"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-bold">
          <span aria-hidden>🎖️</span>{" "}
          {account ? `${account}'s Trainer Card` : "Your Trainer Card"}
        </h2>
        <span className="text-xs text-muted">
          {account ? "synced to your account" : "stored on this device"}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { value: stats.gamesPlayed, label: "Runs" },
          { value: `${accuracyOf(stats)}%`, label: "Accuracy" },
          { value: `${stats.bestStreak}🔥`, label: "Best streak" },
          { value: stats.survivalBest, label: "Survival best" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl bg-white/5 p-3 text-center">
            <div className="font-mono text-xl font-bold">{stat.value}</div>
            <div className="text-[11px] uppercase tracking-wider text-muted">
              {stat.label}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            Gym Badges
          </span>
          <span className="font-mono text-xs text-muted">
            {earned.size}/{BADGES.length}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {BADGES.map((badge) => {
            const unlocked = earned.has(badge.id);
            return (
              <span
                key={badge.id}
                title={`${badge.name} — ${badge.description}${unlocked ? "" : " (locked)"}`}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-xl text-xl transition-all",
                  unlocked
                    ? "bg-gradient-to-br from-amber-400/25 to-orange-500/15 shadow-[0_0_12px_rgba(251,191,36,0.15)]"
                    : "bg-white/5 opacity-30 grayscale",
                )}
              >
                {badge.emoji}
              </span>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {QUIZ_CATEGORIES.map((category) => {
          const best = stats.bestScores[category];
          if (!best) return null;
          return (
            <span
              key={category}
              className="rounded-full bg-white/5 px-3 py-1 text-xs text-muted"
            >
              {CATEGORY_META[category].emoji} {CATEGORY_META[category].name}:{" "}
              <span className="font-mono font-bold text-foreground">{best}</span>
            </span>
          );
        })}
      </div>
    </motion.section>
  );
}
