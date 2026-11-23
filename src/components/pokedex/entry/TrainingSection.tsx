"use client";

import { m } from "framer-motion";
import type { DexEntryData } from "@/lib/pokemon/dex-types";
import type { StatKey } from "@/lib/pokemon/constants";
import { catchChance } from "@/lib/pokemon/stat-calc";
import { useT } from "@/i18n/client";
import dexEntryNs from "@/messages/dex-entry";

const LANGUAGES = ["ja", "ko", "de", "fr", "es", "it"] as const;

export function TrainingSection({ data }: { data: DexEntryData }) {
  const t = useT(dexEntryNs);
  // Another language lists English in its own place.
  const languages = t.locale === "en" ? LANGUAGES : (["en", ...LANGUAGES.filter((l) => l !== t.locale)] as const);
  const ev = Object.entries(data.evYield) as [StatKey, number][];
  const femalePct = data.genderRate >= 0 ? (data.genderRate / 8) * 100 : null;
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Card title={t("train.training")}>
        <Row label={t("train.ev")} value={ev.length ? ev.map(([k, v]) => t("train.evValue", { v, stat: t(`stat.${k}`) })).join(t.locale === "ja" ? "、" : ", ") : "—"} />
        <Row
          label={t("train.catch")}
          value={
            data.captureRate !== null
              ? t("train.catchValue", { rate: data.captureRate, pct: decimal((catchChance(data.captureRate) * 100).toFixed(1), t.locale) })
              : "—"
          }
        />
        <Row label={t("train.friendship")} value={data.baseHappiness ?? "—"} />
        <Row label={t("train.exp")} value={data.baseExp ?? "—"} />
        <Row label={t("train.growth")} value={data.growthRate ?? "—"} />
      </Card>

      <Card title={t("train.breeding")}>
        <Row label={t("train.eggGroups")} value={data.eggGroups.join(t.locale === "ja" ? "、" : ", ") || "—"} />
        <Row label={t("train.eggCycles")} value={data.hatchCounter ?? "—"} />
        <div className="space-y-1.5 py-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("train.gender")}</span>
            <span className="font-medium">
              {femalePct === null ? t("train.genderless") : t("train.split", { m: decimal(String(100 - femalePct), t.locale), f: decimal(String(femalePct), t.locale) })}
            </span>
          </div>
          {femalePct !== null && (
            <div className="flex meter">
              <m.div className="h-full bg-sky-400" initial={{ width: 0 }} whileInView={{ width: `${100 - femalePct}%` }} viewport={{ once: true }} transition={{ duration: 0.8 }} />
              <m.div className="h-full bg-pink-400" initial={{ width: 0 }} whileInView={{ width: `${femalePct}%` }} viewport={{ once: true }} transition={{ duration: 0.8, delay: 0.2 }} />
            </div>
          )}
        </div>
        <Row label={t("train.differences")} value={data.genderDifferences ? t("train.yes") : t("train.no")} />
        <Row label={t("train.habitat")} value={data.core.habitat ? data.core.habitat.replace(/-/g, " ") : "—"} />
      </Card>

      <Card title={t("train.otherNames")}>
        {languages.map((code) =>
          data.core.names[code] ? <Row key={code} label={t(`lang.${code}`)} value={data.core.names[code]!} /> : null
        )}
      </Card>

      {data.dexNumbers.length > 0 && (
        <Card title={t("train.regional")} className="md:col-span-2 xl:col-span-3">
          <div className="flex flex-wrap gap-2 pt-1">
            {data.dexNumbers.map((d) => (
              <span key={d.dex} className="rounded-lg border border-foreground/10 bg-background/50 px-2.5 py-1 text-xs">
                <span className="text-muted-foreground">{d.dex}</span> <b className="font-mono">#{d.number}</b>
              </span>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/** "12.5" with the language's decimal mark ("12,5"); English as it is. */
const decimal = (s: string, locale: string) => (locale === "en" ? s : Number(s).toLocaleString(locale, { maximumFractionDigits: 1 }));

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`hud rounded-lg border bg-card p-4 ${className ?? ""}`}>
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className="divide-y divide-foreground/5">{children}</div>
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
