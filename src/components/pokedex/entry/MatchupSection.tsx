"use client";

import { motion } from "framer-motion";
import { formatMultiplier } from "@/lib/pokemon/type-matrix";
import { TypeBadge } from "../TypeBadge";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import dexEntryNs from "@/messages/dex-entry";

const GROUPS = [
  { label: "x4", values: [4], tone: "text-red-400" },
  { label: "x2", values: [2], tone: "text-orange-400" },
  { label: "half", values: [0.5], tone: "text-emerald-400" },
  { label: "quarter", values: [0.25], tone: "text-teal-300" },
  { label: "immune", values: [0], tone: "text-sky-300" },
] as const;

function cellTone(m: number): string {
  if (m >= 4) return "bg-red-500/80 text-white";
  if (m >= 2) return "bg-orange-500/70 text-white";
  if (m === 0) return "bg-sky-500/60 text-white";
  if (m <= 0.25) return "bg-teal-500/70 text-white";
  if (m < 1) return "bg-emerald-600/60 text-white";
  return "bg-muted/50 text-muted-foreground";
}

export function MatchupSection({ defenses, stab, typeNames }: { defenses: { type: string; multiplier: number }[]; stab: string[]; typeNames?: Record<string, string> }) {
  const t = useT(dexEntryNs);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2">
        {GROUPS.map((g) => {
          const list = defenses.filter((d) => (g.values as readonly number[]).includes(d.multiplier));
          if (!list.length) return null;
          return (
            <div key={g.label} className="hud rounded-lg border bg-card p-4">
              <div className={cn("mb-2 text-sm font-semibold", g.tone)}>{t(`matchup.${g.label}`)}</div>
              <div className="flex flex-wrap gap-1.5">
                {list.map((d, i) => (
                  <motion.span key={d.type} initial={{ opacity: 0, scale: 0.6 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: i * 0.04 }}>
                    <TypeBadge type={d.type} label={typeNames?.[d.type]} />
                  </motion.span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="hud rounded-lg border bg-card p-4">
        <div className="mb-3 text-sm font-semibold">{t("matchup.every")}</div>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 lg:grid-cols-9">
          {defenses.map((d, i) => (
            <motion.div
              key={d.type}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.025 }}
              className="flex flex-col items-center gap-1 rounded-lg bg-background/40 p-1.5"
            >
              <TypeBadge type={d.type} size="sm" className="w-full" label={typeNames?.[d.type]} />
              <span className={cn("w-full rounded-md py-0.5 text-center text-xs font-bold", cellTone(d.multiplier))}>
                {d.multiplier === 1 ? "1×" : formatMultiplier(d.multiplier).replace(" (immune)", "")}
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      {stab.length > 0 && (
        <div className="hud rounded-lg border bg-card p-4">
          <div className="mb-2 text-sm font-semibold">{t("matchup.stab")}</div>
          <div className="flex flex-wrap gap-1.5">
            {stab.map((ty) => (
              <TypeBadge key={ty} type={ty} label={typeNames?.[ty]} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
