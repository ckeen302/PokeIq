"use client";

import { useCallback, useState } from "react";
import { Settings, X } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { GEO_ROUND_OPTIONS, type GeoRounds } from "@/lib/geo-types";
import { GEO_TIMERS, geoSettingsBadge, type GeoPlaySettings } from "@/lib/geo-settings";
import { cn } from "@/lib/utils";

/**
 * PokéGuessr's play settings (No move, Zoomed, a round timer), in a popover
 * from a Settings button, as on Pokédle. They only make a game harder.
 */
export function GeoSettingsButton({ value, onChange }: { value: GeoPlaySettings; onChange: (next: GeoPlaySettings) => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const badge = geoSettingsBadge(value);
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
          "flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors",
          open || badge ? "border-screen bg-screen/15 text-foreground" : "bg-card text-muted-foreground hover:border-screen/50 hover:text-foreground"
        )}
      >
        <Settings className="h-3.5 w-3.5" aria-hidden />
        Settings
      </button>
      {badge && (
        <span className="rounded-sm border border-foreground/15 px-1.5 py-0.5 font-pixel text-[9px] uppercase tracking-wider text-muted-foreground" data-testid="geo-settings-badge">
          {badge}
        </span>
      )}
      <Popover open={open} onClose={close} label="PokéGuessr settings" align="start" className="w-[min(24rem,calc(100vw-2rem))] space-y-3">
        <div className="flex items-start justify-between gap-3">
          <p className="hud-label">Play settings</p>
          <button type="button" onClick={close} aria-label="Close settings" className="rounded-md p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <SettingToggle
          label="Zoomed"
          description="A close-up crop of the screenshot instead of all of it."
          checked={value.zoomed}
          onChange={() => set({ zoomed: !value.zoomed })}
          testId="geo-zoomed"
        />
        <div className="space-y-1.5 border-t pt-3">
          <p className="text-sm font-semibold">Round timer</p>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Round timer">
            {GEO_TIMERS.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={value.timer === t}
                onClick={() => set({ timer: t })}
                data-testid={`geo-timer-${t}`}
                className={cn(
                  "flex-1 rounded-md border px-2 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors",
                  value.timer === t ? "border-screen bg-screen/15 text-foreground" : "bg-card text-muted-foreground hover:border-screen/50 hover:text-foreground"
                )}
              >
                {t ? `${t}s` : "Off"}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">When time runs out, your pin is guessed where it is. No pin scores 0 (and ends a streak).</p>
        </div>
        <p className="border-t pt-3 text-xs text-muted-foreground">These only make a game harder, so your scores still count on the leaderboards.</p>
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
  label = "Rounds",
}: {
  value: GeoRounds;
  onChange: (next: GeoRounds) => void;
  /** Lengths above this are off (the map has too few places). */
  max?: number;
  testId?: string;
  label?: string;
}) {
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
