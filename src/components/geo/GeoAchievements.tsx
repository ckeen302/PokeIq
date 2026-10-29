"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Award, CalendarCheck, Crosshair, Flame, Medal, Trophy, X } from "lucide-react";
import {
  GEO_ACHIEVEMENTS,
  GEO_MASTERY_SCORE,
  geoAchievement,
  masteryPercent,
  type GeoAchievementGroup,
  type GeoAchievementState,
  type GeoMasteryRow,
  type GeoProgress,
} from "@/lib/geo-achievements";
import { cn } from "@/lib/utils";

const fmt = (n: number) => n.toLocaleString("en-US");

const GROUP_ICON: Record<GeoAchievementGroup, typeof Award> = {
  precision: Crosshair,
  regions: Medal,
  streaks: Flame,
  dailies: CalendarCheck,
  ranked: Trophy,
  weekly: Award,
};

/** One badge: its icon (lit once earned), name, what it takes, and how far along. */
function AchievementItem({ state }: { state: GeoAchievementState }) {
  const def = geoAchievement(state.id);
  if (!def) return null;
  const Icon = GROUP_ICON[def.group];
  const pct = state.need ? Math.round((state.have / state.need) * 100) : 0;
  return (
    <li
      className={cn("flex min-w-0 items-start gap-3 rounded-md border p-2.5", state.earned ? "border-warning/50 bg-warning/[0.07]" : "bg-shade/15")}
      data-testid={`geo-achievement-${state.id}`}
      data-earned={state.earned ? "true" : undefined}
      title={def.blurb}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2",
          state.earned ? "border-warning bg-warning/20 text-warning" : "border-border bg-card text-muted-foreground/70"
        )}
        aria-hidden
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn("truncate text-sm font-semibold", !state.earned && "text-foreground/80")}>{def.name}</span>
          <span className="shrink-0 font-pixel text-[9px] tabular-nums text-muted-foreground">{state.earned ? "Earned" : state.need > 1 ? `${fmt(state.have)}/${fmt(state.need)}` : ""}</span>
        </span>
        <span className="block text-xs leading-snug text-muted-foreground">{def.blurb}</span>
        {!state.earned && state.need > 1 && (
          <span className="meter block h-1.5" aria-hidden>
            <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
          </span>
        )}
        {state.note && <span className="block text-[11px] text-muted-foreground">{state.note}</span>}
      </span>
    </li>
  );
}

/**
 * The achievements: earned first, then the closest to earning. `limit`
 * shows that many with a button for the rest.
 */
export function AchievementGrid({ achievements, limit, className }: { achievements: GeoAchievementState[]; limit?: number; className?: string }) {
  const [all, setAll] = useState(false);
  const order = (a: GeoAchievementState) => (a.earned ? 2 : a.need ? a.have / a.need : 0);
  const sorted = [...achievements].sort((a, b) => order(b) - order(a));
  const shown = limit && !all ? sorted.slice(0, limit) : sorted;
  return (
    <div className={cn("space-y-3", className)}>
      <ul className="grid gap-2 sm:grid-cols-2" data-testid="geo-achievements">
        {shown.map((a) => (
          <AchievementItem key={a.id} state={a} />
        ))}
      </ul>
      {limit && sorted.length > limit && (
        <button type="button" onClick={() => setAll((x) => !x)} className="hud-label hover:text-foreground" data-testid="geo-achievements-more" aria-expanded={all}>
          {all ? "Show fewer" : `Show all ${sorted.length}`}
        </button>
      )}
    </div>
  );
}

/** Mastery per region: the share of its places scored 4,000+ at least once. */
export function MasteryList({ mastery, className }: { mastery: GeoMasteryRow[]; className?: string }) {
  return (
    <ul className={cn("space-y-2", className)} data-testid="geo-mastery">
      {mastery.map((r) => {
        const pct = masteryPercent(r);
        return (
          <li key={r.id} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 text-sm sm:grid-cols-[5.5rem_1fr_auto]" data-testid={`geo-mastery-${r.id}`}>
            <span className="truncate font-semibold">{r.name}</span>
            <span className="meter h-2" title={`${fmt(r.mastered)} of ${fmt(r.places)} places scored ${fmt(GEO_MASTERY_SCORE)}+`}>
              <span className={cn("block h-full", pct >= 75 ? "bg-success" : pct >= 25 ? "bg-warning" : "bg-primary")} style={{ width: `${pct}%` }} />
            </span>
            <span className="w-[5.5rem] text-right font-pixel text-[10px] tabular-nums text-muted-foreground">
              {r.mastered}/{r.places} · {pct}%
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export const MASTERY_BLURB = `Places you've scored ${fmt(GEO_MASTERY_SCORE)}+ on at least once, of each region's places.`;

// ---------------------------------------------------------------------------
// The player's own progress, and the toast when something new is earned
// ---------------------------------------------------------------------------

export type MyGeoProgress = GeoProgress & { signedIn: boolean; username?: string };
const SEEN_KEY = "pokeiq:geo-achievements-seen";

function readSeen(): string[] | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (raw === null) return null;
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return null;
  }
}
function writeSeen(ids: string[]) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
  } catch {
    // Private mode: no toasts, the badges still show.
  }
}

/**
 * The player's achievements and mastery from /api/geo/progress, read on
 * mount and again on `refresh` (after a game: the rounds are logged a moment
 * after the last guess). Badges earned since the last read on this device
 * come back in `fresh` (the first read on a device only remembers them).
 */
export function useGeoProgress() {
  const [progress, setProgress] = useState<MyGeoProgress | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  const live = useRef(true);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/geo/progress", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as MyGeoProgress;
      if (!live.current || !Array.isArray(data.achievements)) return;
      setProgress(data);
      const earned = data.achievements.filter((a) => a.earned).map((a) => a.id);
      const seen = readSeen();
      if (seen) {
        const added = earned.filter((id) => !seen.includes(id));
        if (added.length) setFresh((f) => [...f, ...added.filter((id) => !f.includes(id))]);
      }
      writeSeen([...new Set([...(seen ?? []), ...earned])]);
    } catch {
      // Offline: the hub shows no record.
    }
  }, []);
  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, [load]);
  const dismiss = useCallback((id: string) => setFresh((f) => f.filter((x) => x !== id)), []);
  return { progress, fresh, refresh: load, dismiss };
}

/** A small toast for each newly earned badge, bottom-centre, over the game frame too; it goes by itself. */
export function AchievementToasts({ ids, onDismiss }: { ids: string[]; onDismiss: (id: string) => void }) {
  const id = ids[0];
  useEffect(() => {
    if (!id) return;
    const t = window.setTimeout(() => onDismiss(id), 5000);
    return () => window.clearTimeout(t);
  }, [id, onDismiss]);
  const def = id ? geoAchievement(id) : null;
  const Icon = def ? GROUP_ICON[def.group] : Award;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex justify-center px-4" aria-live="polite">
      <AnimatePresence>
        {def && (
          <motion.div
            key={def.id}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.25 }}
            className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-lg border border-warning/60 bg-card/95 p-3 text-foreground shadow-2xl backdrop-blur"
            role="status"
            data-testid="geo-achievement-toast"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-warning bg-warning/20 text-warning" aria-hidden>
              <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="hud-label block text-warning">Achievement unlocked</span>
              <span className="block truncate font-display text-base font-bold uppercase">{def.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{def.blurb}</span>
            </span>
            <button type="button" onClick={() => onDismiss(def.id)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const GEO_ACHIEVEMENT_TOTAL = GEO_ACHIEVEMENTS.length;
