"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CATEGORY_META, QUIZ_CATEGORIES } from "@/engines/types";
import { AlakazamMascot } from "@/components/AlakazamMascot";
import { BrainLogo } from "@/components/BrainLogo";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { BADGES, loadEarnedBadges } from "@/lib/achievements";
import { cn } from "@/lib/utils";

interface ProfileData {
  user: { id: string; username: string; createdAt: string } | null;
  stats?: {
    gamesPlayed: number;
    totalCorrect: number;
    totalAnswered: number;
    bestStreak: number;
    survivalBest: number;
    totalScore: number;
    bestScores: Partial<Record<string, number>>;
  };
  rank?: { rank: number; of: number } | null;
}

function joinDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function TrainerProfile() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [earned, setEarned] = useState<Set<string>>(new Set());
  const [freshCode, setFreshCode] = useState<string | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : { user: null }))
      .then((data: ProfileData) => {
        if (cancelled) return;
        setProfile(data);
        setEarned(loadEarnedBadges());
      })
      .catch(() => {
        if (!cancelled) setProfile({ user: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function generateCode() {
    setCodeBusy(true);
    try {
      const res = await fetch("/api/auth/recovery-code", { method: "POST" });
      const data = (await res.json().catch(() => null)) as {
        recoveryCode?: string;
      } | null;
      if (res.ok && data?.recoveryCode) setFreshCode(data.recoveryCode);
    } finally {
      setCodeBusy(false);
    }
  }

  async function copyCode() {
    if (!freshCode) return;
    try {
      await navigator.clipboard.writeText(freshCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // code stays visible for manual copy
    }
  }

  if (!profile) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
        <AlakazamMascot size={96} />
        <p className="text-sm text-muted">Reading your trainer file…</p>
      </div>
    );
  }

  if (!profile.user) {
    return (
      <Card className="mx-auto max-w-sm text-center">
        <div className="text-4xl" aria-hidden>
          🎖️
        </div>
        <h2 className="mt-2 text-xl font-black">No Trainer ID yet</h2>
        <p className="mt-2 text-sm text-muted">
          Sign in to sync your stats across devices, earn a global rank and
          climb the Top Trainers board.
        </p>
        <Link href="/login" className="mt-5 block">
          <Button size="lg" className="w-full">
            Sign in / Create account
          </Button>
        </Link>
      </Card>
    );
  }

  const stats = profile.stats ?? {
    gamesPlayed: 0,
    totalCorrect: 0,
    totalAnswered: 0,
    bestStreak: 0,
    survivalBest: 0,
    totalScore: 0,
    bestScores: {},
  };
  const accuracy =
    stats.totalAnswered > 0
      ? Math.round((100 * stats.totalCorrect) / stats.totalAnswered)
      : 0;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* Identity + rank hero */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card className="relative overflow-hidden text-center sm:p-8">
          <div
            aria-hidden
            className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 opacity-15 blur-3xl"
          />
          <BrainLogo
            size={64}
            className="mx-auto drop-shadow-[0_0_18px_rgba(192,132,252,0.4)]"
          />
          <h1 className="mt-3 text-3xl font-black tracking-tight">
            {profile.user.username}
          </h1>
          <p className="mt-1 text-xs text-muted">
            Trainer since {joinDate(profile.user.createdAt)}
          </p>
          <div className="mt-5 flex items-center justify-center gap-6">
            <div>
              <div className="font-mono text-3xl font-bold text-indigo-200">
                {stats.totalScore.toLocaleString()}
              </div>
              <div className="text-[11px] uppercase tracking-wider text-muted">
                Lifetime XP
              </div>
            </div>
            {profile.rank && (
              <div>
                <div className="font-mono text-3xl font-bold text-amber-300">
                  #{profile.rank.rank}
                </div>
                <div className="text-[11px] uppercase tracking-wider text-muted">
                  of {profile.rank.of} trainer{profile.rank.of === 1 ? "" : "s"}
                </div>
              </div>
            )}
          </div>
        </Card>
      </motion.div>

      {/* Core stats */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
      >
        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Battle record
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { value: stats.gamesPlayed, label: "Runs" },
              { value: `${accuracy}%`, label: "Accuracy" },
              { value: `${stats.bestStreak}🔥`, label: "Best streak" },
              { value: stats.survivalBest, label: "Survival best" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl bg-white/5 p-3 text-center"
              >
                <div className="font-mono text-xl font-bold">{stat.value}</div>
                <div className="text-[11px] uppercase tracking-wider text-muted">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {QUIZ_CATEGORIES.map((category) => {
              const meta = CATEGORY_META[category];
              const best = stats.bestScores[category];
              return (
                <div
                  key={category}
                  className="relative overflow-hidden rounded-xl bg-white/5 p-3 text-center"
                  title={meta.name}
                >
                  <div
                    aria-hidden
                    className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${meta.accent}`}
                  />
                  <div className="text-lg" aria-hidden>
                    {meta.emoji}
                  </div>
                  <div className="font-mono text-sm font-bold">
                    {best ?? "—"}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-muted">
                    best
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </motion.div>

      {/* Badge collection */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16 }}
      >
        <Card>
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Gym Badges
            </h2>
            <span className="font-mono text-xs text-muted">
              {earned.size}/{BADGES.length}
            </span>
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BADGES.map((badge) => {
              const unlocked = earned.has(badge.id);
              return (
                <li
                  key={badge.id}
                  className={cn(
                    "rounded-xl p-3 text-center",
                    unlocked
                      ? "bg-gradient-to-br from-amber-400/20 to-orange-500/10"
                      : "bg-white/5 opacity-40 grayscale",
                  )}
                >
                  <div className="text-2xl" aria-hidden>
                    {badge.emoji}
                  </div>
                  <div className="mt-1 text-xs font-bold">{badge.name}</div>
                  <div className="mt-0.5 text-[10px] leading-tight text-muted">
                    {badge.description}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-center text-[11px] text-muted">
            Badges are earned on this device as you play.
          </p>
        </Card>
      </motion.div>

      {/* Account security */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.24 }}
      >
        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Account security
          </h2>
          <p className="mt-2 text-sm text-muted">
            Your recovery code is the only way back in if you forget your
            trainer name or password. Generating a new one invalidates the old
            code.
          </p>
          {freshCode ? (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => void copyCode()}
                title="Copy recovery code"
                className="w-full rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 font-mono text-lg font-bold tracking-wider text-amber-200 transition-colors hover:bg-amber-400/15"
              >
                {freshCode}
              </button>
              <div className="mt-2 flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => void copyCode()}
                >
                  {copied ? "Copied! ✓" : "Copy code"}
                </Button>
              </div>
              <p className="mt-2 text-center text-[11px] text-amber-300/80">
                Shown once — save it now. Your previous code no longer works.
              </p>
            </div>
          ) : (
            <Button
              variant="outline"
              className="mt-4"
              disabled={codeBusy}
              onClick={() => void generateCode()}
            >
              {codeBusy ? "Generating…" : "🔑 Generate new recovery code"}
            </Button>
          )}
        </Card>
      </motion.div>
    </div>
  );
}
