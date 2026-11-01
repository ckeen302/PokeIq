import Link from "next/link";
import { ListChecks, Trophy } from "lucide-react";
import { FORMAT_INFO, MODULE_INFO, PLAYABLE_FORMATS, moduleHref } from "@/lib/modes";
import { neaClock } from "@/lib/name-em-all/share";
import { neaHref } from "@/lib/name-em-all/categories";
import type { NeaBestRow, QuizBestRow } from "@/lib/quiz-bests";
import { ModeIcon } from "@/components/game/ModeIcon";
import { Card, CardContent } from "@/components/ui/card";

/** A trainer's quiz personal bests on their profile: the best score per mode and format, and Name 'em All per category. */
export function QuizBests({ username, quiz, nea }: { username: string; quiz: QuizBestRow[]; nea: NeaBestRow[] }) {
  return (
    <Card id="quiz-bests" className="scroll-mt-20" data-testid="profile-quiz-bests">
      <CardContent className="space-y-4 p-5">
        <p className="hud-label flex items-center gap-1.5 text-screen">
          <Trophy className="h-3.5 w-3.5" aria-hidden /> Quiz personal bests
        </p>
        {quiz.length === 0 && nea.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {username} hasn&apos;t set a quiz best yet.{" "}
            <Link href="/play" className="text-primary underline-offset-2 hover:underline">
              Play a quiz
            </Link>
          </p>
        ) : (
          <>
            {quiz.length > 0 && (
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                      <th className="px-5 py-2 font-semibold">Mode</th>
                      {PLAYABLE_FORMATS.map((f) => (
                        <th key={f} className="px-2 py-2 text-right font-semibold last:pr-5">
                          {FORMAT_INFO[f].title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {quiz.map((row) => (
                      <tr key={row.module} className="border-b border-border/60 last:border-0" data-testid="profile-quiz-best">
                        <td className="max-w-0 px-5 py-2">
                          <Link href={moduleHref(row.module)} className="flex min-w-0 items-center gap-2 font-semibold hover:text-screen">
                            <ModeIcon module={row.module} className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="truncate">{MODULE_INFO[row.module].title}</span>
                          </Link>
                        </td>
                        {PLAYABLE_FORMATS.map((f) => (
                          <td key={f} className="w-[4.5rem] whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums last:pr-5 sm:w-24">
                            {row.scores[f]?.toLocaleString("en-US") ?? <span className="text-muted-foreground/60">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {nea.length > 0 && (
              <div className="space-y-2 border-t pt-3" data-testid="profile-nea-bests">
                <p className="hud-label flex items-center gap-1.5">
                  <ListChecks className="h-3.5 w-3.5" aria-hidden /> Name &apos;em All
                </p>
                <ul className="divide-y divide-border/60 text-sm">
                  {nea.map((row) => (
                    <li key={row.category} className="flex items-center justify-between gap-3 py-2" data-testid="profile-nea-best">
                      <Link href={neaHref(row.category)} className="min-w-0 truncate font-semibold hover:text-screen">
                        {row.label}
                      </Link>
                      <span className="flex shrink-0 flex-wrap justify-end gap-x-3 text-right text-xs text-muted-foreground">
                        {row.count && (
                          <span>
                            <b className="tabular-nums text-foreground">
                              {row.count.named}/{row.total}
                            </b>{" "}
                            named
                          </span>
                        )}
                        {row.clearMs !== undefined && (
                          <span>
                            cleared in <b className="tabular-nums text-foreground">{neaClock(row.clearMs)}</b>
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
