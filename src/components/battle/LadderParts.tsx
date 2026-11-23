"use client";

import Link from "@/components/ui/Link";
import { Flame, Loader2, Medal, Trophy } from "lucide-react";
import type { RankedLeaderRow, RankedStanding } from "@/lib/ranked";
import { PLAY_FORMAT_INFO, type StandardFormatId } from "@/lib/battle/play";
import { LADDER_FORMATS } from "@/lib/battle/ladder";
import { useLadderStanding } from "@/lib/battle/ladder-client";
import { glickoBadge } from "./GlickoBadge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { NameAvatar } from "@/components/avatar/Avatar";
import type { AvatarMap } from "@/lib/avatar";
import { useT } from "@/i18n/client";
import battleLadder from "@/messages/battle-ladder";
import battleGlicko from "@/messages/battle-glicko";

/** Tabs across the ladder formats, as links (`hrefBase` + the format id). */
export function LadderTabs({ format, hrefBase }: { format: StandardFormatId; hrefBase: string }) {
  const t = useT(battleLadder);
  return (
    <div className="flex flex-wrap gap-2 max-md:-mx-4 max-md:flex-nowrap max-md:overflow-x-auto max-md:px-4 max-md:pb-1 max-md:[scrollbar-width:none]" role="tablist" aria-label={t("tabs")}>
      {LADDER_FORMATS.map((f) => (
        <Link
          key={f}
          href={`${hrefBase}${f}`}
          role="tab"
          aria-selected={f === format}
          className={cn(
            "rounded-md border px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wider transition-colors max-md:shrink-0 max-md:whitespace-nowrap max-md:py-2.5",
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
  const t = useT(battleLadder);
  const tg = useT(battleGlicko);
  if (!rows.length) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          {t.rich("nobody", {
            format: PLAY_FORMAT_INFO[format].short,
            link: (c) => (
              <Link href="/battle/play?vs=anyone" className="text-primary underline-offset-2 hover:underline">
                {c}
              </Link>
            ),
          })}
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
              <th className="p-3">{t("trainer")}</th>
              <th className="p-3" title={t("eloTitle")}>
                {t("elo")}
              </th>
              <th className="p-3" title={t("gxeTitle")}>
                {t("gxe")}
              </th>
              <th className="hidden p-3 text-right sm:table-cell">{t("wl")}</th>
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
                <td className="p-3 font-display text-base font-bold tabular-nums" data-testid="ladder-elo">
                  {row.elo !== undefined ? Math.round(row.elo) : "–"}
                </td>
                <td className="p-3">
                  {glickoBadge({ rating: row.rating, rd: row.rd, gxe: row.gxe, elo: row.elo, headline: false, size: "sm" }, tg)}
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

/** Your own standing in a format: Elo, GXE and Glicko-2 rating, place and record. */
export function YourBattleStanding({ format }: { format: StandardFormatId }) {
  const state = useLadderStanding(format);
  const t = useT(battleLadder);
  if (state.status === "off") return null;
  // While it loads, the card a newcomer gets holds its place (unseen, the spinner on it), so the ladder under it
  // doesn't jump down when the standing arrives.
  if (state.status === "loading")
    return (
      <div className="relative">
        <div className="invisible" aria-hidden inert>
          <StandingCard format={format} you={null} placeholder />
        </div>
        <Loader2 className="absolute inset-0 m-auto h-5 w-5 animate-spin text-screen" aria-label={t("loading")} />
      </div>
    );
  return <StandingCard format={format} you={state.you} />;
}

function StandingCard({ format, you, placeholder }: { format: StandardFormatId; you: RankedStanding | null; placeholder?: boolean }) {
  const t = useT(battleLadder);
  const tg = useT(battleGlicko);
  return (
    <Card className="border-primary/40">
      <CardContent className="space-y-3 p-5" data-testid={placeholder ? undefined : "your-standing"}>
        <p className="hud-label flex items-center gap-1.5 text-primary">
          <Trophy className="h-3.5 w-3.5" aria-hidden /> {t("you", { format: PLAY_FORMAT_INFO[format].name })}
        </p>
        {you && you.games > 0 ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {glickoBadge({ rating: you.rating, rd: you.rd, gxe: you.gxe, elo: you.elo, size: "lg" }, tg)}
              <div className="flex gap-5 text-right font-pixel text-xs tabular-nums">
                <span>
                  <span className="block text-base text-foreground">#{you.position ?? "–"}</span>
                  <span className="text-muted-foreground">{t("of", { n: you.players })}</span>
                </span>
                <span>
                  <span className="block text-base text-foreground">
                    {you.wins}–{you.losses}
                  </span>
                  <span className="text-muted-foreground">{t("wl")}</span>
                </span>
                {you.streak > 1 && (
                  <span>
                    <span className="flex items-center justify-end gap-1 text-base text-warning">
                      <Flame className="h-4 w-4" aria-hidden /> {you.streak}
                    </span>
                    <span className="text-muted-foreground">{t("streak")}</span>
                  </span>
                )}
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("none")}{" "}
            {/* Phones: the starting numbers are in the page's first line and under the table. */}
            <span className="max-md:hidden">{t("start")}</span>
            <Link href="/battle/play?vs=anyone" className="font-semibold text-foreground underline-offset-2 hover:underline">
              {t("find")}
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
