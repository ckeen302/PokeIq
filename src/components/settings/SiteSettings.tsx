"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Moon, Sun, Volume2, VolumeX, type LucideIcon } from "lucide-react";
import { getTheme, onThemeChange, setTheme, type Theme } from "@/lib/theme";
import { isMuted, onMuteChange, play, setMuted } from "@/lib/sound";
import { cn } from "@/lib/utils";

/**
 * The site's own settings: light / dark theme and sound on / off. They live in
 * the header's account menu and in the Settings section of /trainer (phones
 * have them in the tab bar's More sheet); every copy shows the same state.
 */

/** The current theme, kept in step with every other theme switch on the page. */
export function useThemeSetting(): [Theme, (next: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>("dark");
  useEffect(() => {
    setThemeState(getTheme());
    return onThemeChange(setThemeState);
  }, []);
  const choose = (next: Theme) => {
    if (next === getTheme()) return;
    setTheme(next);
    setThemeState(next);
    play("click");
  };
  return [theme, choose];
}

/** Whether the site's sound is muted, kept in step with every other sound switch (the 3D stages have their own). */
export function useSoundSetting(): [boolean, (muted: boolean) => void] {
  const [muted, setMutedState] = useState(true);
  useEffect(() => {
    setMutedState(isMuted());
    return onMuteChange(setMutedState);
  }, []);
  const choose = (next: boolean) => {
    if (next === isMuted()) return;
    setMuted(next);
    setMutedState(next);
    if (!next) play("click");
  };
  return [muted, choose];
}

/** Two-way segmented switch: a labelled group of two pressed / unpressed buttons. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
  size,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon: LucideIcon }[];
  onChange: (v: T) => void;
  testId: string;
  size: "sm" | "md";
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("inline-flex shrink-0 rounded-full border border-foreground/10 bg-foreground/[0.04] p-0.5", size === "md" && "p-1")}
      data-testid={testId}
    >
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            data-value={o.value}
            className={cn(
              "flex items-center gap-1.5 rounded-full font-display font-semibold uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              size === "sm" ? "h-7 px-2.5 text-[11px]" : "h-9 px-4 text-xs",
              on ? "bg-primary/15 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Row({ title, hint, children, size }: { title: string; hint?: ReactNode; children: ReactNode; size: "sm" | "md" }) {
  return (
    <div className={cn("flex items-center justify-between gap-4", size === "md" && "flex-wrap gap-y-2")}>
      <div className="min-w-0">
        <div className={cn("font-semibold", size === "sm" ? "text-sm" : "text-[15px]")}>{title}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/** The Theme and Sound rows, compact in the header menu ("sm") or roomier on the trainer page ("md"). */
export function SettingsControls({ size = "sm", testIdPrefix }: { size?: "sm" | "md"; testIdPrefix: string }) {
  const [theme, chooseTheme] = useThemeSetting();
  const [muted, chooseMuted] = useSoundSetting();
  const md = size === "md";
  return (
    <div className={cn("space-y-3", md && "space-y-4")}>
      <Row title="Theme" hint={md ? "Dark or light, kept on this device." : undefined} size={size}>
        <Segmented<Theme>
          label="Theme"
          value={theme}
          onChange={chooseTheme}
          testId={`${testIdPrefix}-theme`}
          size={size}
          options={[
            { value: "dark", label: "Dark", icon: Moon },
            { value: "light", label: "Light", icon: Sun },
          ]}
        />
      </Row>
      <Row title="Sound" hint={md ? <>Sound effects and music.<span className="max-md:hidden"> Press M anywhere to toggle it.</span></> : undefined} size={size}>
        <Segmented<"on" | "off">
          label="Sound"
          value={muted ? "off" : "on"}
          onChange={(v) => chooseMuted(v === "off")}
          testId={`${testIdPrefix}-sound`}
          size={size}
          options={[
            { value: "on", label: "On", icon: Volume2 },
            { value: "off", label: "Off", icon: VolumeX },
          ]}
        />
      </Row>
    </div>
  );
}

/** The trainer page's Settings section (also reachable as /trainer#settings). */
export function SettingsCard() {
  return (
    <section id="settings" aria-labelledby="settings-title" className="hud relative scroll-mt-20 rounded-lg border bg-card p-5 text-card-foreground shadow-[0_8px_30px_-12px_hsl(var(--shade)/0.6)]" data-testid="trainer-settings">
      <h2 id="settings-title" className="mb-4 font-display text-lg font-bold leading-none tracking-tight">
        Settings
      </h2>
      <SettingsControls size="md" testIdPrefix="trainer-settings" />
    </section>
  );
}
