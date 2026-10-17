"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Target, TrendingUp } from "lucide-react";
import { coachInsights, type Insight } from "@/lib/coach";
import type { Progress } from "@/lib/progress";

export function CoachPanel({ progress }: { progress: Progress }) {
  const { weak, strong, overall } = coachInsights(progress.skills ?? {});
  const answered = Object.entries(progress.skills ?? {})
    .filter(([t]) => t.startsWith("mod:"))
    .reduce((sum, [, [, n]]) => sum + n, 0);

  if (weak.length === 0 && strong.length === 0) {
    return (
      <div className="hud rounded-lg border bg-card p-5 text-sm text-muted-foreground">
        <div className="mb-1 flex items-center gap-2 font-semibold text-foreground">
          <Target className="h-4 w-4 text-primary" /> Your coach
        </div>
        Answer {Math.max(5, 30 - answered)} more questions and your coach will spot your strongest and weakest areas —
        generations, types and modes — and point you at what to study.
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <InsightList title="Focus areas" icon={<Target className="h-4 w-4 text-destructive" />} items={weak} overall={overall} tone="weak" />
      <InsightList title="Strengths" icon={<TrendingUp className="h-4 w-4 text-success" />} items={strong} overall={overall} tone="strong" />
    </div>
  );
}

function InsightList({ title, icon, items, overall, tone }: { title: string; icon: React.ReactNode; items: Insight[]; overall: number; tone: "weak" | "strong" }) {
  return (
    <div className="space-y-3 hud rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-semibold">
          {icon} {title}
        </h3>
        <span className="text-xs text-muted-foreground">overall {Math.round(overall * 100)}%</span>
      </div>
      {items.length === 0 && <p className="text-sm text-muted-foreground">Nothing stands out yet — keep playing.</p>}
      {items.map((it, i) => (
        <motion.div key={it.tag} className="space-y-1.5" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">{it.label}</span>
            <span className="tabular-nums text-muted-foreground">
              ~{Math.round(it.accuracy * 100)}% <span className="text-[10px]">({it.answered} answered)</span>
            </span>
          </div>
          <div className="meter">
            <motion.div
              className={tone === "weak" ? "h-full bg-destructive/80" : "h-full bg-success"}
              initial={{ width: 0 }}
              animate={{ width: `${it.accuracy * 100}%` }}
              transition={{ duration: 0.7, delay: 0.1 + i * 0.08 }}
            />
            <span className="absolute inset-y-0 w-0.5 bg-foreground/60" style={{ left: `${overall * 100}%` }} aria-hidden />
          </div>
          {tone === "weak" && (
            <Link href={it.href} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
              {it.cta} <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </motion.div>
      ))}
    </div>
  );
}
