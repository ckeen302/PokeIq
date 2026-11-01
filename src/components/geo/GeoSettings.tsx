"use client";

import { useCallback, useState } from "react";
import { Settings, X } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { GEO_ROUND_OPTIONS, type GeoRounds } from "@/lib/geo-types";
import { GEO_TIMERS, geoSettingsBadge, type GeoPlaySettings } from "@/lib/geo-settings";
import { GEO_DIFFICULTIES, GEO_DIFFICULTY_BLURBS, GEO_DIFFICULTY_NAMES, type GeoDifficulty } from "@/lib/geo-difficulty";
import { cn } from "@/lib/utils";
import { guessrMusic } from "@/lib/guessr-music";
import { useGuessrAudioPrefs } from "@/lib/use-guessr-music";
import { setDuelSfx, useDuelSfx } from "@/lib/duel-sfx";
import { play, unlockAudio } from "@/lib/sound";

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
        <GuessrSoundSettings />
      </Popover>
    </div>
  );
}

/** Music and sound effects: each on or off, with its own volume. The site's mute (the speaker up top) silences both. */
export function GuessrSoundSettings() {
  const prefs = useGuessrAudioPrefs();
  const sfxOn = useDuelSfx();
  return (
    <div className="space-y-3 border-t pt-3" data-testid="geo-sound-settings">
      <p className="hud-label">Sound</p>
      <SettingToggle
        label="Music"
        description="Chiptune for the menus, the rounds and duels."
        checked={prefs.music.on}
        onChange={() => {
          unlockAudio();
          guessrMusic.setPrefs({ music: { on: !prefs.music.on } });
        }}
        testId="geo-music"
      />
      <VolumeSlider label="Music volume" value={prefs.music.volume} disabled={!prefs.music.on} onChange={(volume) => guessrMusic.setPrefs({ music: { volume } })} testId="geo-music-volume" />
      <SettingToggle label="Sound effects" description="Pins, guesses, scores and the countdown." checked={sfxOn} onChange={() => setDuelSfx(!sfxOn)} testId="geo-sfx" />
      <VolumeSlider
        label="Sound effects volume"
        value={prefs.sfxVolume}
        disabled={!sfxOn}
        onChange={(sfxVolume) => guessrMusic.setPrefs({ sfxVolume })}
        onCommit={() => play("pin")}
        testId="geo-sfx-volume"
      />
    </div>
  );
}

function VolumeSlider({ label, value, disabled, onChange, onCommit, testId }: { label: string; value: number; disabled: boolean; onChange: (v: number) => void; onCommit?: () => void; testId: string }) {
  return (
    <input
      type="range"
      min={0}
      max={100}
      step={5}
      value={Math.round(value * 100)}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value) / 100)}
      onPointerUp={onCommit}
      onKeyUp={onCommit}
      data-testid={testId}
      className="h-2 w-full cursor-pointer accent-[hsl(var(--primary))] disabled:cursor-not-allowed disabled:opacity-40"
    />
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

/**
 * Easy / Normal / Hard: which screenshots a free-play game leans to (the
 * audit's ratings, moved by players' scores). Easy and Hard are practice.
 */
export function DifficultyPicker({ value, onChange }: { value: GeoDifficulty; onChange: (next: GeoDifficulty) => void }) {
  return (
    <div className="space-y-1.5">
      <p className="hud-label">Difficulty</p>
      <div className="flex gap-1.5" role="radiogroup" aria-label="Difficulty">
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
            {GEO_DIFFICULTY_NAMES[d]}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground" data-testid="geo-difficulty-blurb">
        {GEO_DIFFICULTY_BLURBS[value]}
        {value !== "normal" ? " Practice: Normal keeps the leaderboards." : ""}
      </p>
    </div>
  );
}
