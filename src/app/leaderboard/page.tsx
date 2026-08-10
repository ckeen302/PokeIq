import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { CATEGORY_META, QUIZ_CATEGORIES } from "@/engines/types";
import { SESSION_COOKIE, hashSessionToken } from "@/lib/auth";
import { getSessionUser, getTopTrainers } from "@/lib/auth-store";
import { getTopScores } from "@/lib/leaderboard-store";
import { AlakazamMascot } from "@/components/AlakazamMascot";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "Top 10 trainers per quiz module.",
};

const MEDALS = ["🥇", "🥈", "🥉"];

function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function LeaderboardPage() {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  const [viewer, trainers, daily, ...boards] = await Promise.all([
    sessionToken
      ? getSessionUser(hashSessionToken(sessionToken))
      : Promise.resolve(null),
    getTopTrainers(10),
    getTopScores("daily"),
    ...QUIZ_CATEGORIES.map(async (category) => ({
      category,
      ...(await getTopScores(category)),
    })),
  ]);
  const persistent = daily.persistent || boards.some((b) => b.persistent);
  const isViewer = (name: string) => viewer?.username === name;
  const podium = trainers.slice(0, 3);
  const runnersUp = trainers.slice(3);
  // Visual order: silver left, gold center, bronze right.
  const podiumOrder = [podium[1], podium[0], podium[2]].filter(Boolean);
  const PODIUM_STYLES = [
    { medal: "🥈", height: "h-20", ring: "border-slate-300/25" },
    { medal: "🥇", height: "h-28", ring: "border-amber-400/40" },
    { medal: "🥉", height: "h-16", ring: "border-orange-400/25" },
  ];

  return (
    <div>
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-black tracking-tight">
          🏆 Hall of <span className="text-gradient">Fame</span>
        </h1>
        <p className="mt-2 text-sm text-muted">
          Top 10 trainers per module
          {!persistent && " · session-only (connect Supabase to persist)"}
        </p>
      </header>

      <div className="glass relative mb-5 overflow-hidden rounded-2xl p-6">
        <div
          aria-hidden
          className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 opacity-10 blur-2xl"
        />
        <h2 className="flex items-center gap-2.5 font-bold">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-400 to-purple-500 text-base shadow"
            aria-hidden
          >
            🏅
          </span>
          Top Trainers
          <span className="text-xs font-normal text-muted">
            ranked by lifetime XP
          </span>
        </h2>
        {trainers.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-white/10 py-6 text-center text-sm text-muted">
            No trainers ranked yet —{" "}
            <Link href="/login" className="underline decoration-dotted hover:text-foreground">
              create an account
            </Link>{" "}
            and every run you finish earns XP.
          </div>
        ) : (
          <>
            {/* Olympic podium for the top 3 */}
            <div className="mt-6 flex items-end justify-center gap-3">
              {podiumOrder.map((trainer) => {
                const place = podium.indexOf(trainer);
                const style = PODIUM_STYLES[podiumOrder.indexOf(trainer)];
                const you = isViewer(trainer.username);
                return (
                  <div
                    key={trainer.username}
                    className="flex w-24 flex-col items-center sm:w-32"
                  >
                    <span className="text-2xl" aria-hidden>
                      {style.medal}
                    </span>
                    <span
                      className={cn(
                        "mt-1 w-full truncate text-center text-sm font-bold",
                        you && "text-indigo-300",
                      )}
                      title={trainer.username}
                    >
                      {trainer.username}
                      {you && " (you)"}
                    </span>
                    <span className="font-mono text-xs text-indigo-200">
                      {trainer.stats.totalScore.toLocaleString()} XP
                    </span>
                    <div
                      className={cn(
                        "mt-2 w-full rounded-t-xl border border-b-0 bg-gradient-to-b from-white/10 to-white/[0.02]",
                        style.height,
                        style.ring,
                        you && "border-indigo-400/50",
                      )}
                      aria-hidden
                    >
                      <div className="pt-2 text-center font-mono text-lg font-black text-white/30">
                        {place + 1}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {runnersUp.length > 0 && (
              <ol className="mt-4 space-y-1.5">
                {runnersUp.map((trainer, i) => {
                  const accuracy =
                    trainer.stats.totalAnswered > 0
                      ? Math.round(
                          (100 * trainer.stats.totalCorrect) /
                            trainer.stats.totalAnswered,
                        )
                      : 0;
                  const you = isViewer(trainer.username);
                  return (
                    <li
                      key={trainer.username}
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-3 py-2 text-sm",
                        you
                          ? "border border-indigo-400/40 bg-indigo-400/10"
                          : "bg-white/[0.03]",
                      )}
                    >
                      <span className="w-7 text-center font-mono text-xs text-muted">
                        {i + 4}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-semibold">
                        {trainer.username}
                        {you && (
                          <span className="ml-1.5 text-xs text-indigo-300">
                            (you)
                          </span>
                        )}
                      </span>
                      <span className="hidden text-[11px] text-muted sm:inline">
                        {trainer.stats.gamesPlayed} runs · {accuracy}% ·{" "}
                        {trainer.stats.bestStreak}🔥
                      </span>
                      <span className="w-16 text-right font-mono font-bold tabular-nums text-indigo-200">
                        {trainer.stats.totalScore.toLocaleString()}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </>
        )}
      </div>

      <div className="glass relative mb-5 overflow-hidden rounded-2xl p-6">
        <div
          aria-hidden
          className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br from-amber-400 to-rose-500 opacity-10 blur-2xl"
        />
        <h2 className="flex items-center gap-2.5 font-bold">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-rose-500 text-base shadow"
            aria-hidden
          >
            🗓️
          </span>
          Daily Gauntlet
        </h2>
        {daily.entries.length === 0 ? (
          <div className="mt-5 flex flex-col items-center gap-3 rounded-xl border border-dashed border-white/10 py-6 text-center text-sm text-muted">
            <AlakazamMascot size={56} showSpoons={false} />
            Nobody has conquered today&apos;s gauntlet yet — be the first!
          </div>
        ) : (
          <ol className="mt-4 grid gap-1.5 sm:grid-cols-2">
            {daily.entries.map((entry, i) => (
              <li
                key={`${entry.name}-${entry.created_at}-${i}`}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2 text-sm",
                  isViewer(entry.name)
                    ? "border border-indigo-400/40 bg-indigo-400/10"
                    : i === 0
                      ? "border border-amber-400/20 bg-amber-400/[0.07]"
                      : "bg-white/[0.03]",
                )}
              >
                <span className="w-7 text-center" aria-hidden>
                  {MEDALS[i] ?? (
                    <span className="font-mono text-xs text-muted">{i + 1}</span>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {entry.name}
                  {isViewer(entry.name) && (
                    <span className="ml-1.5 text-xs text-indigo-300">(you)</span>
                  )}
                </span>
                <span className="hidden text-[11px] text-muted sm:inline">
                  {relativeTime(entry.created_at)}
                </span>
                <span className="w-12 text-right font-mono font-bold tabular-nums">
                  {entry.score}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {boards.map(({ category, entries }, i) => {
          const meta = CATEGORY_META[category];
          return (
            <Card
              key={category}
              style={{ "--delay": `${i * 80}ms` } as React.CSSProperties}
              className="card-enter relative overflow-hidden"
            >
              <div
                aria-hidden
                className={`absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br ${meta.accent} opacity-10 blur-2xl`}
              />
              <h2 className="flex items-center gap-2.5 font-bold">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${meta.accent} text-base shadow`}
                  aria-hidden
                >
                  {meta.emoji}
                </span>
                {meta.name}
              </h2>
              {entries.length === 0 ? (
                <div className="mt-6 rounded-xl border border-dashed border-white/10 py-8 text-center text-sm text-muted">
                  <span aria-hidden className="spoon-bend mr-1.5 inline-block">
                    🥄
                  </span>
                  No scores yet — claim the throne!
                </div>
              ) : (
                <ol className="mt-4 space-y-1.5">
                  {entries.map((entry, i) => (
                    <li
                      key={`${entry.name}-${entry.created_at}-${i}`}
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-3 py-2 text-sm",
                        isViewer(entry.name)
                          ? "border border-indigo-400/40 bg-indigo-400/10"
                          : i === 0
                            ? "border border-amber-400/20 bg-amber-400/[0.07]"
                            : "bg-white/[0.03]",
                      )}
                    >
                      <span className="w-7 text-center" aria-hidden>
                        {MEDALS[i] ?? (
                          <span className="font-mono text-xs text-muted">
                            {i + 1}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-semibold">
                        {entry.name}
                        {isViewer(entry.name) && (
                          <span className="ml-1.5 text-xs text-indigo-300">
                            (you)
                          </span>
                        )}
                      </span>
                      <span className="hidden text-[11px] text-muted sm:inline">
                        {relativeTime(entry.created_at)}
                      </span>
                      <Badge className="capitalize">{entry.difficulty}</Badge>
                      <span className="w-12 text-right font-mono font-bold tabular-nums">
                        {entry.score}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
