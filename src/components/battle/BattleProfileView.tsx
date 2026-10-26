import Link from "next/link";
import { Clapperboard, Swords, Trophy } from "lucide-react";
import type { BattleProfile } from "@/lib/battle/profile";
import { GlickoBadge } from "./GlickoBadge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const RESULT_STYLE = { win: "text-success", loss: "text-destructive", draw: "text-muted-foreground" } as const;
const RESULT_LABEL = { win: "Won", loss: "Lost", draw: "Drew" } as const;

/** A battle record: per format (wins, losses, rating), then the latest battles with their replays. */
export function BattleProfileView({ profile, now, empty }: { profile: BattleProfile; now: number; empty?: React.ReactNode }) {
  if (!profile.formats.length && !profile.recent.length) {
    return <div className="text-sm text-muted-foreground">{empty ?? "No live battles yet."}</div>;
  }
  return (
    <div className="space-y-5" data-testid="battle-record">
      <div className="grid gap-2 sm:grid-cols-2">
        {profile.formats.map((f) => {
          const played = f.wins + f.losses + f.draws;
          return (
            <div key={f.format} className="space-y-1.5 rounded-md border bg-card/60 p-3">
              <p className="hud-label flex items-center justify-between gap-2 text-screen">
                <span className="truncate">{f.formatName}</span>
                {f.position ? <span className="text-muted-foreground">#{f.position}</span> : null}
              </p>
              <p className="flex items-baseline gap-3 font-display">
                <span className="text-2xl font-bold tabular-nums">
                  {f.wins}–{f.losses}
                  {f.draws ? `–${f.draws}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">{played ? `${Math.round((f.wins / played) * 100)}% wins` : "ranked only"}</span>
              </p>
              {f.rating !== undefined && <GlickoBadge rating={f.rating} rd={f.rd} gxe={f.gxe} size="sm" />}
            </div>
          );
        })}
      </div>
      {profile.recent.length > 0 && (
        <div className="space-y-1.5">
          <p className="hud-label">Recent battles</p>
          <ul className="divide-y rounded-md border">
            {profile.recent.map((b) => {
              const delta = b.ratingAfter !== undefined && b.ratingBefore !== undefined ? b.ratingAfter - b.ratingBefore : null;
              const days = Math.floor((now - b.at) / 86_400_000);
              return (
                <li key={b.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className={cn("w-12 font-display font-bold uppercase", RESULT_STYLE[b.result])}>{RESULT_LABEL[b.result]}</span>
                  <span className="min-w-0 flex-1 truncate">
                    vs <b>{b.opponent}</b> <span className="text-xs text-muted-foreground">· {b.formatName}</span>
                  </span>
                  {b.ranked && (
                    <span className="flex items-center gap-1 font-pixel text-[10px] tabular-nums">
                      <Trophy className="h-3 w-3 text-warning" aria-label="Ranked" />
                      {delta !== null && <span className={delta >= 0 ? "text-success" : "text-destructive"}>{delta >= 0 ? `+${delta}` : delta}</span>}
                    </span>
                  )}
                  <span className="w-16 text-right text-xs text-muted-foreground">{days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`}</span>
                  {b.replay ? (
                    <Link href={`/battle/replay/${b.code}`} className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline" data-testid="record-replay">
                      <Clapperboard className="h-3.5 w-3.5" aria-hidden /> Replay
                    </Link>
                  ) : (
                    <span className="w-[3.75rem]" />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A card around a battle record, with a way into battle. */
export function BattleRecordCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="hud-label flex items-center gap-1.5 text-primary">
            <Swords className="h-3.5 w-3.5" aria-hidden /> {title}
          </p>
          <Link href="/battle/ladder" className="hud-label hover:text-foreground">
            Ladder →
          </Link>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
