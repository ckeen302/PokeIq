"use client";

import { Sheet } from "@/components/pokedle/sheets";
import type { DleStats } from "@/lib/dle-stats";
import type { ConnRecord } from "@/lib/progress";
import { ConnArchiveCalendar, ConnStatsBody } from "./stats";

/** PokéConnections' pop-up sheets: stats and the archive (Pokédle's sheet style). How to play is in howto-sheet.tsx. */

export function ConnStatsSheet({ stats, todayMistakes, onClose }: { stats: DleStats; todayMistakes: number | null; onClose: () => void }) {
  return (
    <Sheet title="Statistics" onClose={onClose}>
      <div className="space-y-5 text-sm">
        <ConnStatsBody stats={stats} todayMistakes={todayMistakes} />
        <p className="text-xs text-muted-foreground">Only dailies count. Practice and archive games never change your stats or streaks.</p>
      </div>
    </Sheet>
  );
}

/** Every daily since launch on a calendar, coloured by how it went. */
export function ConnArchiveSheet({
  today,
  daily,
  archive,
  onPlay,
  onToday,
  onClose,
}: {
  today: string;
  daily: Readonly<Record<string, ConnRecord>>;
  archive: Readonly<Record<string, ConnRecord>>;
  onPlay: (date: string) => void;
  onToday: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Archive" onClose={onClose}>
      <p className="mb-3 text-sm text-muted-foreground">Play any past daily. Archive games are just for fun: they never count toward your streaks or stats.</p>
      <ConnArchiveCalendar today={today} daily={daily} archive={archive} onPlay={onPlay} onToday={onToday} />
    </Sheet>
  );
}
