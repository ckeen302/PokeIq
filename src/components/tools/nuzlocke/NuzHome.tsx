"use client";

import "./nuzlocke.css";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, ChevronsUp, HeartCrack, Medal } from "lucide-react";
import Link from "@/components/ui/Link";
import { useT } from "@/i18n/client";
import { useLocale } from "@/i18n/navigation";
import { INTL_LOCALE } from "@/i18n/format";
import nuz from "@/messages/nuzlocke";
import { cn } from "@/lib/utils";
import { badgeCount, badgeTotal, levelCap, stats, team, type Run } from "@/lib/nuzlocke/run";
import { listRuns, loadStore, saveRun } from "@/lib/nuzlocke/storage";
import { VERSION_LOOK } from "@/lib/nuzlocke/versions";
import type { GameSummary, GameView } from "@/lib/nuzlocke/view";
import { Sprite, Toast, VersionDot, relativeTime, type ToastState } from "./parts";
import { StartRun, TRACKER_PATH, runPath } from "./StartRun";
import { useViews } from "./data";
import { takeDeleted } from "./deleted";

/**
 * The tracker's front page, in the browser: the runs saved here (Continue), then every game to start a new run in.
 * The game tiles are in the page's HTML (each with its game page's link); the saved runs appear once the page loads.
 */
export function NuzHome({ games, headings }: { games: GameSummary[]; headings: { start: string; lead: string; regionGen: Record<string, string>; guide: string } }) {
  const t = useT(nuz);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const done = useCallback(() => setToast(null), []);

  useEffect(() => {
    const read = () => setRuns(listRuns(loadStore()));
    read();
    // A run just deleted from its page can be put back from here.
    const gone = takeDeleted();
    if (gone)
      setToast({
        id: Date.now(),
        text: t("home.deleted", { name: gone.name }),
        undo: () => {
          saveRun(gone);
          read();
        },
      });
    const onStorage = (e: StorageEvent) => e.key?.startsWith("pokeiq:nuzlocke") && read();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [t]);

  const used = games.filter((g) => runs?.some((r) => r.game === g.id));
  const views = useViews(used);

  return (
    <>
      {runs && runs.length > 0 && (
        <section className="mt-8 max-sm:mt-6" aria-labelledby="nz-continue" data-testid="nz-continue">
          <h2 id="nz-continue" className="mb-4 font-display text-2xl font-semibold tracking-tight">
            {t("home.continue")}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
            {runs.map((r) => (
              <RunCard key={r.id} run={r} game={games.find((g) => g.id === r.game)} view={views[r.game]} />
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10 max-sm:mt-8" aria-labelledby="nz-games">
        <h2 id="nz-games" className="font-display text-2xl font-semibold tracking-tight">
          {headings.start}
        </h2>
        <p className="mt-1 text-[15px] text-muted-foreground">{headings.lead}</p>
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4" data-testid="nz-games">
          {games.map((g) => (
            <li key={g.id} className="flex flex-col overflow-hidden rounded-[22px] border border-foreground/[0.08] bg-card shadow-[0_16px_40px_-32px_hsl(var(--shade)/0.9)]">
              <button
                type="button"
                onClick={() => setStart(g.id)}
                className="group flex flex-1 flex-col items-start gap-3 p-4 text-left transition-colors hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                data-testid={`nz-game-${g.id}`}
              >
                <span className="screen icon-well relative flex h-24 w-full items-end justify-center overflow-hidden rounded-2xl">
                  {g.versions.slice(0, 2).map((v, i) => (
                    <Sprite key={v.id} art={VERSION_LOOK[v.id]?.mascot} className={cn("relative z-[3] h-[88px] w-[88px] drop-shadow-[0_8px_10px_rgb(0_0_0/0.35)] transition-transform duration-300 group-hover:scale-[1.06] motion-reduce:transition-none", g.versions.length > 1 && (i === 0 ? "-mr-3" : "-ml-3"))} eager />
                  ))}
                </span>
                <span className="min-w-0">
                  <span className="block font-display text-[17px] font-bold leading-tight tracking-tight">{g.name}</span>
                  <span className="mt-1 block text-[12.5px] text-muted-foreground">{headings.regionGen[g.id]}</span>
                </span>
              </button>
              <Link href={`${TRACKER_PATH}/${g.id}`} className="flex min-h-11 items-center justify-between gap-2 border-t border-foreground/[0.06] px-4 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground" data-testid={`nz-guide-${g.id}`}>
                {headings.guide} <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {start && <StartRun games={games} gameId={start} onClose={() => setStart(null)} />}
      <Toast toast={toast} undoLabel={t("toast.undo")} onDone={done} />
    </>
  );
}

/** A saved run. One whose game the tracker doesn't offer right now still shows, saying so. */
function RunCard({ run, game, view }: { run: Run; game: GameSummary | undefined; view: GameView | undefined }) {
  const t = useT(nuz);
  const locale = useLocale();
  const s = stats(run);
  const members = team(run);
  const version = game?.versions.find((v) => v.id === run.version);
  const badges = view ? badgeCount(run, view) : null;
  const cap = view && run.rules.caps ? levelCap(run, view) : null;
  const total = view ? badgeTotal(view) : null;
  return (
    <li>
      <Link
        href={runPath(run.id)}
        aria-label={t("home.open", { name: run.name })}
        className="group flex h-full flex-col gap-3 rounded-[24px] border border-foreground/[0.08] bg-card p-4 shadow-[0_16px_40px_-32px_hsl(var(--shade)/0.9)] transition-[border-color,transform] hover:-translate-y-0.5 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        data-testid="nz-run-card"
      >
        <span className="flex items-center justify-between gap-3 text-[12.5px] text-muted-foreground">
          <span className="flex min-w-0 items-center gap-2">
            <VersionDot id={run.version} />
            <span className="truncate font-semibold text-foreground/85">{version?.name ?? game?.name ?? run.version}</span>
          </span>
          <span className="shrink-0">{t("home.played", { when: relativeTime(run.updatedAt, INTL_LOCALE[locale], t("home.justNow")) })}</span>
        </span>
        <span className="block truncate font-display text-[21px] font-bold leading-tight tracking-tight">{run.name}</span>
        {!game && <span className="text-[13px] text-muted-foreground">{t("home.noGame")}</span>}
        <span className="flex h-14 items-center gap-1" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => {
            const m = members[i];
            return (
              <span key={i} className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-full max-[380px]:h-10 max-[380px]:w-10", m ? "bg-foreground/[0.05]" : "border border-dashed border-foreground/[0.14]")}>
                {m && <Sprite art={view?.mons[m.mon]?.art} className="h-11 w-11 max-[380px]:h-9 max-[380px]:w-9" />}
              </span>
            );
          })}
        </span>
        {!members.length && <span className="sr-only">{t("home.teamEmpty")}</span>}
        <span className="mt-auto flex items-center gap-4 text-[13px] font-semibold">
          <span className="inline-flex items-center gap-1.5">
            <Medal className="h-4 w-4 text-[hsl(var(--warning))]" aria-hidden />
            {badges === null ? "–" : total ? `${badges}/${total}` : badges}
            <span className="sr-only">{t("home.badges", { n: badges ?? 0 })}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <HeartCrack className="h-4 w-4" aria-hidden />
            {t("home.fallen", { n: s.dead })}
          </span>
          {cap && (
            <span className="inline-flex items-center gap-1 text-screen">
              <ChevronsUp className="h-4 w-4" aria-hidden />
              {t("home.cap", { n: cap.cap })}
            </span>
          )}
          <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
        </span>
      </Link>
    </li>
  );
}
