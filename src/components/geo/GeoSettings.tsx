"use client";

import { useCallback, useState } from "react";
import { Settings, X } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { GEO_ROUND_OPTIONS, type GeoRounds } from "@/lib/geo-types";
import { GEO_TIMERS, timerLabel, type GeoPlaySettings, type GeoTimer } from "@/lib/geo-settings";
import { GEO_DIFFICULTIES, type GeoDifficulty } from "@/lib/geo-difficulty";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import geoSolo from "@/messages/geo-solo";
import geoNamesNs from "@/messages/geo-names";

/**
 * PokéGuessr's play settings (No move, Zoomed; the round timer has its own picker), in a popover
 * from a Settings button, as on Pokédle. They only make a game harder.
 */
export function GeoSettingsButton({ value, onChange }: { value: GeoPlaySettings; onChange: (next: GeoPlaySettings) => void }) {
  const t = useT(geoSolo);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // As geoSettingsBadge writes it ("Zoomed"), in the page's language. The timer has its own picker in the setup.
  const badge = value.zoomed ? t("settings.zoomed") : null;
  const set = (patch: Partial<GeoPlaySettings>) => onChange({ ...value, ...patch });
  return (
    <div className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="geo-settings"
        className={cn(
          "tap flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors",
          open || badge ? "border-screen bg-screen/15 text-foreground" : "bg-card text-muted-foreground hover:border-screen/50 hover:text-foreground"
        )}
      >
        <Settings className="h-3.5 w-3.5" aria-hidden />
        {t("settings.button")}
      </button>
      {badge && (
        <span className="rounded-sm border border-foreground/15 px-1.5 py-0.5 font-pixel text-[9px] uppercase tracking-wider text-muted-foreground" data-testid="geo-settings-badge">
          {badge}
        </span>
      )}
      <Popover open={open} onClose={close} label={t("settings.popover")} align="start" className="w-[min(24rem,calc(100vw-4.75rem))] space-y-3">
        <div className="flex items-start justify-between gap-3">
          <p className="hud-label">{t("settings.title")}</p>
          <button type="button" onClick={close} aria-label={t("settings.close")} className="rounded-md p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <SettingToggle
          label={t("settings.zoomed")}
          description={t("settings.zoomedBlurb")}
          checked={value.zoomed}
          onChange={() => set({ zoomed: !value.zoomed })}
          testId="geo-zoomed"
        />
        <p className="border-t pt-3 text-xs text-muted-foreground">{t("settings.harder")}</p>
      </Popover>
    </div>
  );
}

function SettingToggle({ label, description, checked, onChange, testId }: { label: string; description: string; checked: boolean; onChange: () => void; testId: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        data-testid={testId}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          checked ? "border-primary bg-primary" : "border-foreground/20 bg-shade/30"
        )}
      >
        <span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-foreground transition-[left]", checked ? "left-[1.1rem] bg-primary-foreground" : "left-0.5")} />
      </button>
    </label>
  );
}

/** Game length: a small segmented control (3 / 5 / 10 rounds), in the style of the round-timer row. */
export function RoundsPicker({
  value,
  onChange,
  max = Infinity,
  testId = "geo-rounds",
  label: given,
}: {
  value: GeoRounds;
  onChange: (next: GeoRounds) => void;
  /** Lengths above this are off (the map has too few places). */
  max?: number;
  testId?: string;
  label?: string;
}) {
  const t = useT(geoSolo);
  const label = given ?? t("settings.rounds");
  return (
    <div className="space-y-1.5">
      <p className="hud-label">{label}</p>
      <div className="flex gap-1.5" role="radiogroup" aria-label={label}>
        {GEO_ROUND_OPTIONS.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            disabled={n > max}
            onClick={() => onChange(n)}
            data-testid={`${testId}-${n}`}
            className={cn(
              "min-w-12 rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors disabled:opacity-40",
              value === n ? "border-screen bg-screen/15 text-foreground" : "bg-card text-muted-foreground hover:border-screen/50 hover:text-foreground"
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The round timer for a practice game: Off, 1:00, 1:30 (GeoGuessr's, the
 * default) or 3:00. The Daily and the Weekly always play 1:30.
 */
export function TimerPicker({ value, onChange }: { value: GeoTimer; onChange: (next: GeoTimer) => void }) {
  const t = useT(geoSolo);
  return (
    <div className="space-y-1.5">
      <p className="hud-label">{t("settings.timer")}</p>
      <div className="flex gap-1.5" role="radiogroup" aria-label={t("settings.timer")}>
        {GEO_TIMERS.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={value === s}
            onClick={() => onChange(s)}
            data-testid={`geo-timer-${s}`}
            className={cn(
              "min-w-12 rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider tabular-nums transition-colors",
              value === s ? "border-screen bg-screen/15 text-foreground" : "bg-card text-muted-foreground hover:border-screen/50 hover:text-foreground"
            )}
          >
            {s ? timerLabel(s) : t("settings.off")}
          </button>
        ))}
      </div>
      <p className="max-w-xs text-xs text-muted-foreground" data-testid="geo-timer-blurb">{t("settings.timerBlurb")}</p>
    </div>
  );
}

/**
 * Easy / Normal / Hard: which screenshots a free-play game leans to (the
 * audit's ratings, moved by players' scores). Easy and Hard are practice.
 */
export function DifficultyPicker({ value, onChange }: { value: GeoDifficulty; onChange: (next: GeoDifficulty) => void }) {
  const t = useT(geoSolo);
  const n = useT(geoNamesNs);
  return (
    <div className="space-y-1.5">
      <p className="hud-label">{t("settings.difficulty")}</p>
      <div className="flex gap-1.5" role="radiogroup" aria-label={t("settings.difficulty")}>
        {GEO_DIFFICULTIES.map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={value === d}
            onClick={() => onChange(d)}
            data-testid={`geo-difficulty-${d}`}
            className={cn(
              "min-w-16 rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors",
              value === d ? "border-screen bg-screen/15 text-foreground" : "bg-card text-muted-foreground hover:border-screen/50 hover:text-foreground"
            )}
          >
            {n(`difficulty.${d}.name`)}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground" data-testid="geo-difficulty-blurb">
        {n(`difficulty.${value}.blurb`)}
        {value !== "normal" ? ` ${t("settings.practice")}` : ""}
      </p>
    </div>
  );
}
