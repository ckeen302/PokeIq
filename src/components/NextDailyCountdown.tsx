"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useT } from "@/i18n/client";
import { useLocale } from "@/i18n/locale-context";
import { INTL_LOCALE } from "@/i18n/format";
import type { Locale } from "@/i18n/config";
import countdown from "@/messages/countdown";

/** Counts down to the player's local midnight (when the next daily unlocks). */
export function NextDailyCountdown({ label }: { label?: string }) {
  const t = useT(countdown);
  const [left, setLeft] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const s = Math.max(0, Math.floor((midnight.getTime() - now.getTime()) / 1000));
      const hh = String(Math.floor(s / 3600)).padStart(2, "0");
      const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      setLeft(`${hh}:${mm}:${ss}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
      <Clock className="h-4 w-4" aria-hidden />
      {label ?? t("next")} <span className="font-mono font-semibold tabular-nums text-foreground">{left ?? "--:--:--"}</span>
    </div>
  );
}

/**
 * Minutes as hours and minutes: "7h 12m" (just "12m" under an hour). Other languages write the units their way
 * (Intl: "7 h 12 min", "7 Std. 12 Min.", "7時間12分").
 */
export function hoursMinutes(m: number, locale: Locale): string {
  if (locale === "en") return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  const unit = (n: number, u: "hour" | "minute") => new Intl.NumberFormat(INTL_LOCALE[locale], { style: "unit", unit: u, unitDisplay: "short" }).format(n);
  const parts = m >= 60 ? [unit(Math.floor(m / 60), "hour"), unit(m % 60, "minute")] : [unit(m, "minute")];
  // Japanese writes them together, without spaces: 7時間12分.
  return locale === "ja" ? parts.join("").replace(/\s+/g, "") : parts.join(" ");
}

/** The same countdown in words, to sit in a sentence: "7h 12m" (just "12m" in the last hour). */
export function TimeToNextDaily({ className }: { className?: string }) {
  const locale = useLocale();
  const [left, setLeft] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const m = Math.max(1, Math.ceil((midnight.getTime() - now.getTime()) / 60_000));
      setLeft(hoursMinutes(m, locale));
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [locale]);
  return <span className={className}>{left ?? "…"}</span>;
}
