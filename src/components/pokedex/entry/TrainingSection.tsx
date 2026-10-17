"use client";

import { motion } from "framer-motion";
import type { DexEntryData } from "@/lib/pokemon/dex-types";
import { STAT_LABELS, type StatKey } from "@/lib/pokemon/constants";
import { catchChance } from "@/lib/pokemon/stat-calc";

const LANGUAGES: Record<string, string> = { ja: "Japanese", ko: "Korean", de: "German", fr: "French", es: "Spanish", it: "Italian" };

export function TrainingSection({ data }: { data: DexEntryData }) {
  const ev = Object.entries(data.evYield) as [StatKey, number][];
  const femalePct = data.genderRate >= 0 ? (data.genderRate / 8) * 100 : null;
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Card title="Training">
        <Row label="EV yield" value={ev.length ? ev.map(([k, v]) => `${v} ${STAT_LABELS[k]}`).join(", ") : "—"} />
        <Row
          label="Catch rate"
          value={
            data.captureRate !== null
              ? `${data.captureRate} (${(catchChance(data.captureRate) * 100).toFixed(1)}% with a Poké Ball at full HP)`
              : "—"
          }
        />
        <Row label="Base friendship" value={data.baseHappiness ?? "—"} />
        <Row label="Base experience" value={data.baseExp ?? "—"} />
        <Row label="Growth rate" value={data.growthRate ?? "—"} />
      </Card>

      <Card title="Breeding">
        <Row label="Egg groups" value={data.eggGroups.join(", ") || "—"} />
        <Row label="Egg cycles" value={data.hatchCounter ?? "—"} />
        <div className="space-y-1.5 py-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Gender</span>
            <span className="font-medium">
              {femalePct === null ? "Genderless" : `${100 - femalePct}% ♂ · ${femalePct}% ♀`}
            </span>
          </div>
          {femalePct !== null && (
            <div className="flex h-2.5 overflow-hidden rounded-full bg-secondary">
              <motion.div className="h-full bg-sky-400" initial={{ width: 0 }} whileInView={{ width: `${100 - femalePct}%` }} viewport={{ once: true }} transition={{ duration: 0.8 }} />
              <motion.div className="h-full bg-pink-400" initial={{ width: 0 }} whileInView={{ width: `${femalePct}%` }} viewport={{ once: true }} transition={{ duration: 0.8, delay: 0.2 }} />
            </div>
          )}
        </div>
        <Row label="Gender differences" value={data.genderDifferences ? "Yes" : "No"} />
        <Row label="Habitat" value={data.core.habitat ? data.core.habitat.replace(/-/g, " ") : "—"} />
      </Card>

      <Card title="Other names">
        {Object.entries(LANGUAGES).map(([code, label]) =>
          data.core.names[code as keyof typeof data.core.names] ? (
            <Row key={code} label={label} value={data.core.names[code as keyof typeof data.core.names]!} />
          ) : null
        )}
      </Card>

      {data.dexNumbers.length > 0 && (
        <Card title="Regional Pokédex numbers" className="md:col-span-2 xl:col-span-3">
          <div className="flex flex-wrap gap-2 pt-1">
            {data.dexNumbers.map((d) => (
              <span key={d.dex} className="rounded-lg border border-white/10 bg-background/50 px-2.5 py-1 text-xs">
                <span className="text-muted-foreground">{d.dex}</span> <b className="font-mono">#{d.number}</b>
              </span>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border bg-card/60 p-4 ${className ?? ""}`}>
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className="divide-y divide-white/5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
