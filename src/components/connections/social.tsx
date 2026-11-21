"use client";

import { useEffect, useState } from "react";
import Link from "@/components/ui/Link";
import { Flag, Link2, Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import {
  CONN_LEVELS,
  type ConnGroupExplained,
  type ConnLevel,
} from "@/lib/connections/types";
import {
  REPORT_REASONS,
  beatVerdict,
  groupStatLine,
  type ConnChallenge,
  type ConnFeedbackResponse,
  type ConnFriendRow,
  type ConnFriendsBoardResponse,
  type ConnGroupStats,
  type ConnScore,
  type ReportReason,
} from "@/lib/connections/social";
import { dlePlayerId } from "@/lib/dle-player";
import { clock } from "@/lib/share";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { translator, type Translator } from "@/i18n/catalog";
import conn from "@/messages/connections";

type ConnT = Translator<typeof conn.en>;

/** PokéConnections' social extras: feedback, group stats, the friends board and "Beat my time". */

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// Feedback ---------------------------------------------------------------------

/** The rating question: only the live daily is "today's". */
export const feedbackQuestion = (today: boolean, t: ConnT = translator(conn, "en", undefined)) => t(today ? "feedback.today" : "feedback.this");

/** A thumbs up or down on the puzzle and a "Report this group" per group, after a finished daily. One of each per player: the server keeps the first. */
export function FeedbackPanel({
  date,
  guesses,
  groups,
  today = true,
}: {
  date: string;
  guesses: number[][];
  groups: ConnGroupExplained[];
  /** False for a past daily from the archive: the question then says "this puzzle". */
  today?: boolean;
}) {
  const t = useT(conn);
  const [rated, setRated] = useState<1 | -1 | null>(null);
  const [reporting, setReporting] = useState<ConnLevel | null>(null);
  const [reported, setReported] = useState<ConnLevel[]>([]);
  const [off, setOff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(body: {
    rating?: 1 | -1;
    report?: { level: ConnLevel; reason: ReportReason };
  }): Promise<boolean> {
    setError(null);
    try {
      const r = await post("/api/connections/feedback", {
        date,
        player: dlePlayerId(),
        guesses,
        ...body,
      });
      const data = (await r.json()) as ConnFeedbackResponse & {
        error?: string;
      };
      if (!r.ok) throw new Error(data.error ?? t("feedback.error"));
      if (!data.available) setOff(true);
      return data.available;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("feedback.error"));
      return false;
    }
  }

  if (off) return null;
  return (
    <section
      className="space-y-3 rounded-lg border bg-card p-4 text-left"
      aria-label={t("feedback.aria")}
      data-testid="conn-feedback"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{feedbackQuestion(today, t)}</p>
        <div className="flex gap-1.5">
          {([1, -1] as const).map((v) => (
            <Button
              key={v}
              size="sm"
              variant={rated === v ? "default" : "outline"}
              disabled={rated !== null}
              aria-pressed={rated === v}
              aria-label={v === 1 ? t("feedback.good") : t("feedback.bad")}
              data-testid={v === 1 ? "conn-thumbs-up" : "conn-thumbs-down"}
              onClick={async () => {
                if (await send({ rating: v })) setRated(v);
              }}
            >
              {v === 1 ? (
                <ThumbsUp className="h-4 w-4" aria-hidden />
              ) : (
                <ThumbsDown className="h-4 w-4" aria-hidden />
              )}
            </Button>
          ))}
        </div>
      </div>
      {rated !== null && (
        <p className="text-xs text-muted-foreground">
          {t("feedback.thanks")}
        </p>
      )}
      <ul className="divide-y text-sm">
        {groups.map((g) => (
          <li key={g.level} className="py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                <span aria-hidden>{CONN_LEVELS[g.level].emoji}</span> {g.label}
              </span>
              {reported.includes(g.level) ? (
                <span className="text-xs text-muted-foreground">{t("feedback.reported")}</span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs max-sm:h-9"
                  aria-expanded={reporting === g.level}
                  onClick={() =>
                    setReporting(reporting === g.level ? null : g.level)
                  }
                  data-testid={`conn-report-${g.level}`}
                >
                  <Flag className="h-3 w-3" aria-hidden /> {t("feedback.report")}
                </Button>
              )}
            </div>
            {reporting === g.level && (
              <div
                className="mt-1.5 flex flex-wrap gap-1.5"
                role="group"
                aria-label={t("feedback.why", { label: g.label })}
              >
                {REPORT_REASONS.map((reason) => (
                  <Button
                    key={reason}
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={async () => {
                      if (await send({ report: { level: g.level, reason } })) {
                        setReported((r) => [...r, g.level]);
                        setReporting(null);
                      }
                    }}
                  >
                    {t(`feedback.${reason}`)}
                  </Button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

// Group stats ------------------------------------------------------------------

/** "Only 12% found purple": how many of today's players found each group. Hidden until enough have played. */
export function GroupStats({
  stats,
}: {
  stats: ConnGroupStats | undefined | null;
}) {
  const t = useT(conn);
  const lines = ([0, 1, 2, 3] as ConnLevel[])
    .map((lv) => ({ lv, text: groupStatLine(stats, lv, t) }))
    .filter((l) => l.text);
  if (!lines.length) return null;
  return (
    <ul
      className="space-y-1 rounded-md border bg-shade/30 px-3 py-2 text-left text-sm"
      data-testid="conn-group-stats"
      aria-label={t("groupStats.aria")}
    >
      {lines.map(({ lv, text }) => (
        <li key={lv} className="flex items-center gap-2">
          <span aria-hidden style={{ color: CONN_LEVELS[lv].hex }}>
            {CONN_LEVELS[lv].symbol}
          </span>
          {text}
        </li>
      ))}
    </ul>
  );
}

// Friends board and Beat my time -----------------------------------------------

/** Today's board for you and your friends (signed-in trainers). */
export function FriendsBoard({
  date,
  refreshKey,
}: {
  date: string;
  refreshKey: unknown;
}) {
  const t = useT(conn);
  const [data, setData] = useState<ConnFriendsBoardResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/connections/leaderboard?date=${date}&scope=friends`, {
      cache: "no-store",
    })
      .then((r) =>
        r.ok
          ? (r.json() as Promise<ConnFriendsBoardResponse>)
          : Promise.reject(new Error("failed")),
      )
      .then((d) => live && setData(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [date, refreshKey]);
  if (failed)
    return (
      <p className="text-sm text-muted-foreground">
        {t("friends.failed")}
      </p>
    );
  if (!data)
    return (
      <Loader2 className="mx-auto h-4 w-4 animate-spin" aria-label={t("friends.loading")} />
    );
  if (!data.signedIn)
    return (
      <p className="text-sm text-muted-foreground">
        {t.rich("friends.signIn", {
          a: (c) => (
            <Link href="/account" className="text-primary hover:underline">
              {c}
            </Link>
          ),
        })}
      </p>
    );
  if (!data.rows || data.rows.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {t("friends.none")}
      </p>
    );
  return (
    <ol className="divide-y text-sm" data-testid="conn-friends-board">
      {data.rows.map((r: ConnFriendRow, i) => (
        <li
          key={r.name}
          className={cn(
            "flex items-center gap-3 py-1.5",
            r.you && "-mx-2 rounded-md bg-primary/10 px-2 font-semibold",
          )}
        >
          <span className="w-6 text-right font-mono tabular-nums text-muted-foreground">
            {i + 1}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {r.name}
            {r.hinted && (
              <span title={t("board.usedHint")} aria-label={t("board.usedHintAria")}>
                {" "}
                💡
              </span>
            )}
          </span>
          <span className="tabular-nums text-muted-foreground">
            {r.mistakes === 0 ? t("board.perfect") : t("board.mistakes", { n: r.mistakes })}
          </span>
          <span className="w-12 text-right font-mono tabular-nums">
            {clock(r.ms / 1000)}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** "Beat my time": a link to today's daily that carries your ranked result. */
export function BeatMyTime({ date }: { date: string }) {
  const t = useT(conn);
  const [state, setState] = useState<"idle" | "busy" | "copied" | "failed">(
    "idle",
  );
  async function share() {
    setState("busy");
    try {
      const r = await post("/api/connections/beat", {
        date,
        player: dlePlayerId(),
      });
      const body = (await r.json()) as { path?: string; error?: string };
      if (!r.ok || !body.path) throw new Error(body.error ?? "failed");
      const url = `${window.location.origin}${body.path}`;
      if (navigator.share) {
        try {
          await navigator.share({
            title: t("beat.shareTitle"),
            url,
          });
          return setState("idle");
        } catch {
          // Cancelled, or not allowed: copy it instead.
        }
      }
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
  }
  return (
    <div className="space-y-1">
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => void share()}
        disabled={state === "busy"}
        data-testid="conn-beat"
      >
        <Link2 className="h-4 w-4" aria-hidden /> {t("beat.button")}
      </Button>
      {state === "copied" && (
        <p className="text-xs text-success">
          {t("beat.copied")}
        </p>
      )}
      {state === "failed" && (
        <p className="text-xs text-muted-foreground">
          {t("beat.failed")}
        </p>
      )}
    </div>
  );
}

/** Before playing: whose time the link asks you to beat. */
export function ChallengeBanner({ challenge }: { challenge: ConnChallenge }) {
  const t = useT(conn);
  return (
    <p
      className="mx-auto max-w-md rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-center text-sm"
      data-testid="conn-challenge"
    >
      {t.rich("challenge.banner", {
        name: challenge.name,
        mistakes: challenge.mistakes,
        time: clock(challenge.ms / 1000),
        hint: challenge.hinted ? t("challenge.withHint") : "",
        b: (c) => <b>{c}</b>,
      })}
    </p>
  );
}

/** On the results screen: your result against the friend's. */
export function ChallengeResult({
  challenge,
  mine,
}: {
  challenge: ConnChallenge;
  mine: ConnScore | null;
}) {
  const t = useT(conn);
  const verdict = mine ? beatVerdict(mine, challenge) : null;
  const line = (who: string, s: ConnScore) => (
    <div className="flex items-center justify-between gap-3">
      <span className="truncate font-semibold">{who}</span>
      <span className="tabular-nums">
        {s.mistakes === 0 ? t("board.perfect") : t("board.mistakes", { n: s.mistakes })} ·{" "}
        {clock(s.ms / 1000)}
        {s.hinted ? " 💡" : ""}
      </span>
    </div>
  );
  return (
    <section
      className="space-y-1 rounded-lg border bg-card p-4 text-left text-sm"
      aria-label={t("challenge.aria")}
      data-testid="conn-challenge-result"
    >
      <p className="font-display text-base font-bold uppercase tracking-wide">
        {verdict === "beat"
          ? t("challenge.beat", { name: challenge.name })
          : verdict === "lost"
            ? t("challenge.lost", { name: challenge.name })
            : verdict === "tied"
              ? t("challenge.tied")
              : t("challenge.versus", { name: challenge.name })}
      </p>
      {mine ? (
        line(t("challenge.you"), mine)
      ) : (
        <p className="text-muted-foreground">
          {t("challenge.compare")}
        </p>
      )}
      {line(challenge.name, challenge)}
    </section>
  );
}
