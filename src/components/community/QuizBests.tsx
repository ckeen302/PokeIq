import Link from "@/components/ui/Link";
import { ListChecks, Trophy } from "lucide-react";
import { PLAYABLE_FORMATS, moduleHref } from "@/lib/modes";
import { neaClock } from "@/lib/name-em-all/share";
import { neaHref } from "@/lib/name-em-all/categories";
import type { NeaBestRow, QuizBestRow } from "@/lib/quiz-bests";
import { ModeIcon } from "@/components/game/ModeIcon";
import { Card, CardContent } from "@/components/ui/card";
import { serverT } from "@/i18n/server";
import { formatNumber } from "@/i18n/catalog";
import profile from "@/messages/profile";
import modesNs from "@/messages/quiz-modes";
import neaCats from "@/messages/nea-cats";
import { NEA_CATEGORIES } from "@/lib/name-em-all/categories";
import { categoryText } from "@/lib/name-em-all/localize";

/** A trainer's quiz personal bests on their profile: the best score per mode and format, and Name 'em All per category. */
export function QuizBests({ username, quiz, nea }: { username: string; quiz: QuizBestRow[]; nea: NeaBestRow[] }) {
  const t = serverT(profile);
  const mt = serverT(modesNs);
  const nt = serverT(neaCats);
  const neaLabel = (row: NeaBestRow) => {
    const cat = t.locale === "en" ? undefined : NEA_CATEGORIES.find((c) => c.id === row.category);
    return cat ? categoryText(cat, nt).label : row.label;
  };
  const b = (c: React.ReactNode) => <b className="tabular-nums text-foreground">{c}</b>;
  return (
    <Card id="quiz-bests" className="scroll-mt-20" data-testid="profile-quiz-bests">
      <CardContent className="space-y-4 p-5">
        <p className="hud-label flex items-center gap-1.5 text-screen">
          <Trophy className="h-3.5 w-3.5" aria-hidden /> {t("quiz.title")}
        </p>
        {quiz.length === 0 && nea.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("quiz.none", { name: username })}{" "}
            <Link href="/quiz" className="text-primary underline-offset-2 hover:underline">
              {t("quiz.play")}
            </Link>
          </p>
        ) : (
          <>
            {quiz.length > 0 && (
              // A grid, not a table: on a phone the mode's name gets its own line above the three scores.
              <div className="text-sm" role="table" aria-label={t("quiz.table")}>
                <div role="row" className="grid grid-cols-3 border-b pb-2 text-[11px] font-semibold uppercase text-muted-foreground sm:grid-cols-[minmax(0,1fr)_6rem_6rem_6rem]">
                  <span role="columnheader" className="hidden sm:block">
                    {t("quiz.mode")}
                  </span>
                  {PLAYABLE_FORMATS.map((f) => (
                    <span key={f} role="columnheader" className="text-right">
                      {t(`quiz.formats.${f}`)}
                    </span>
                  ))}
                </div>
                {quiz.map((row) => (
                  <div
                    key={row.module}
                    role="row"
                    className="grid grid-cols-3 items-center gap-y-1 border-b border-border/60 py-2 last:border-0 sm:grid-cols-[minmax(0,1fr)_6rem_6rem_6rem]"
                    data-testid="profile-quiz-best"
                  >
                    <span role="rowheader" className="col-span-3 min-w-0 sm:col-span-1">
                      <Link href={moduleHref(row.module)} className="flex min-w-0 items-center gap-2 font-semibold hover:text-screen">
                        <ModeIcon module={row.module} className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{mt(`modules.${row.module}.title`)}</span>
                      </Link>
                    </span>
                    {PLAYABLE_FORMATS.map((f) => (
                      <span key={f} role="cell" className="text-right font-mono tabular-nums">
                        {(row.scores[f] !== undefined ? formatNumber(row.scores[f], t.locale) : undefined) ?? <span className="text-muted-foreground/60">—</span>}
                      </span>
                    ))}
                  </div>
                ))}
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
                        {neaLabel(row)}
                      </Link>
                      <span className="flex shrink-0 flex-wrap justify-end gap-x-3 text-right text-xs text-muted-foreground">
                        {row.count && <span>{t.rich("quiz.named", { named: row.count.named, total: row.total, b })}</span>}
                        {row.clearMs !== undefined && <span>{t.rich("quiz.cleared", { time: neaClock(row.clearMs), b })}</span>}
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
