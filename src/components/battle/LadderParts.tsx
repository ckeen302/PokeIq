"use client";

import Link from "next/link";
import { Flame, Loader2, Medal, Trophy } from "lucide-react";
import type { RankedLeaderRow } from "@/lib/ranked";
import { PLAY_FORMAT_INFO, type StandardFormatId } from "@/lib/battle/play";
import { LADDER_FORMATS } from "@/lib/battle/ladder";
import { useLadderStanding } from "@/lib/battle/ladder-client";
import { GlickoBadge } from "./GlickoBadge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { NameAvatar } from "@/components/avatar/Avatar";
import type { AvatarMap } from "@/lib/avatar";

const fmt = (n: number) => n.toLocaleString("en-US");

/** Tabs across the ladder formats, as links (`hrefBase` + the format id). */
export function LadderTabs({ format, hrefBase }: { format: StandardFormatId; hrefBase: string }) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Ladder format">
      {LADDER_FORMATS.map((f) => (
        <Link
          key={f}
          href={`${hrefBase}${f}`}
          role="tab"
          aria-selected={f === format}
          className={cn(
            "rounded-md border px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wider transition-colors",
            f === format ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:border-screen/60 hover:text-foreground"
          )}
          scroll={false}
        >
          {PLAY_FORMAT_INFO[f].short}
        </Link>
      ))}
    </div>
  );
}

/** The top of a format's ladder. */
export function LadderTable({ rows, format, avatars }: { rows: RankedLeaderRow[]; format: StandardFormatId; avatars?: AvatarMap }) {
  if (!rows.length) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Nobody is ranked in {PLAY_FORMAT_INFO[format].short} yet.{" "}
          <Link href="/battle/play?vs=anyone" className="text-primary underline-offset-2 hover:underline">
            Queue a ranked battle
          </Link>{" "}
          and be the first!
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm" data-testid="ladder-table">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-muted-foreground">
              <th className="p-3">#</th>
              <th className="p-3">Trainer</th>
              <th className="p-3">Rating</th>
              <th className="hidden p-3 text-right sm:table-cell">W–L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.position} className={cn("border-b last:border-0", row.position <= 3 && "bg-primary/[0.04]")}>
                <td className="p-3 font-mono tabular-nums text-muted-foreground">
                  {row.position <= 3 ? <Medal className={cn("h-4 w-4", row.position === 1 ? "text-warning" : row.position === 2 ? "text-slate-300" : "text-amber-600")} aria-label={`${row.position}`} /> : row.position}
                </td>
                <td className="max-w-[12rem] truncate p-3 font-semibold">
                  <span className="flex items-center gap-2">
                    <NameAvatar name={row.name} avatars={avatars} />
                    <span className="truncate">{row.name}</span>
                  </span>
                </td>
                <td className="p-3">
                  <GlickoBadge rating={row.rating} rd={row.rd} gxe={row.gxe} size="sm" />
                </td>
                <td className="hidden p-3 text-right tabular-nums sm:table-cell">
                  {row.wins}–{row.losses}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/** Your own standing in a format: Glicko-2 rating, GXE, place and record. */
export function YourBattleStanding({ format }: { format: StandardFormatId }) {
  const state = useLadderStanding(format);
  if (state.status === "loading") return <Loader2 className="mx-auto h-5 w-5 animate-spin text-screen" aria-label="Loading your standing" />;
  if (state.status === "off") return null;
  const you = state.you;
  return (
    <Card className="border-primary/40">
      <CardContent className="space-y-3 p-5" data-testid="your-standing">
        <p className="hud-label flex items-center gap-1.5 text-primary">
          <Trophy className="h-3.5 w-3.5" aria-hidden /> You · {PLAY_FORMAT_INFO[format].name}
        </p>
        {you && you.games > 0 ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <GlickoBadge rating={you.rating} rd={you.rd} gxe={you.gxe} size="lg" />
              <div className="flex gap-5 text-right font-pixel text-xs tabular-nums">
                <span>
                  <span className="block text-base text-foreground">#{you.position ?? "–"}</span>
                  <span className="text-muted-foreground">of {fmt(you.players)}</span>
                </span>
                <span>
                  <span className="block text-base text-foreground">
                    {you.wins}–{you.losses}
                  </span>
                  <span className="text-muted-foreground">W–L</span>
                </span>
                {you.streak > 1 && (
                  <span>
                    <span className="flex items-center justify-end gap-1 text-base text-warning">
                      <Flame className="h-4 w-4" aria-hidden /> {you.streak}
                    </span>
                    <span className="text-muted-foreground">streak</span>
                  </span>
                )}
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No ranked battles in this format yet. Everyone starts at 1500 ± 350 (Glicko-2); while your rating deviation is high, each battle moves it a lot.{" "}
            <Link href="/battle/play?vs=anyone" className="font-semibold text-foreground underline-offset-2 hover:underline">
              Find a ranked battle
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
