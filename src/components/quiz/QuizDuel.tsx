"use client";

import { SourceLink } from "./SourceLink";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Crown, Loader2, RotateCcw, Swords, WifiOff, XCircle } from "lucide-react";
import {
  QUIZ_DUEL_IDLE_QUESTIONS,
  QUIZ_DUEL_POINTS,
  QUIZ_DUEL_QUESTION_MS,
  QUIZ_DUEL_SPEED_BONUS,
  pvpHref,
  type QuizDuelPick,
  type QuizDuelQuestionView,
  type QuizDuelResult,
  type QuizDuelView,
} from "@/lib/pvp-types";
import { MODULE_INFO, moduleHref } from "@/lib/modes";
import { play, unlockAudio, vibrate } from "@/lib/sound";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DialogBox } from "@/components/game/DialogBox";
import { HpBar } from "@/components/game/HpBar";
import { useDuel } from "@/components/duel/use-duel";
import { DuelGone, DuelLoading, DuelLobby, DuelNotice, DuelVisitor, LeaveButton, SEAT_COLORS, SeatDot, seconds } from "@/components/duel/DuelParts";
import { DuelChat, DuelTools, EmoteFeed } from "@/components/duel/DuelReactions";
import { CryPlayer, ImageMedia } from "./QuestionMedia";
import { cn } from "@/lib/utils";
import { AddFriendAfterGame } from "@/components/community/AddFriend";
import { Avatar } from "@/components/avatar/Avatar";

/**
 * A quiz duel at /quiz/duel/<code>: the lobby, ten questions with their
 * reveals, and the result. The server runs the duel; this polls it (every
 * second in play, and right on time for each question) and sends the
 * trainer's answers. Your pick stays yours until the reveal, which shows the
 * right answer and both picks.
 */

const fmt = (n: number) => n.toLocaleString("en-US");
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The first value seen for `key`. Media URLs are re-signed on every poll, and the media shouldn't reload each time. */
function useFirst<T>(key: number | undefined, value: T | undefined): T | undefined {
  const [kept, setKept] = useState({ key, value });
  if (kept.key !== key || (kept.value === undefined && value !== undefined)) {
    setKept({ key, value });
    return value;
  }
  return kept.value;
}

/** Poll right when the next question appears. */
const questionDue = (v: QuizDuelView) => (v.question && !v.question.question ? v.question.startsAt : undefined);

export function QuizDuel({ code }: { code: string }) {
  const router = useRouter();
  const { view, now, gone, offline, error, busy, sawPlay, act, send, join, rematch } = useDuel<QuizDuelView>(`/api/duel/${code}`, code, questionDue);
  const [summary, setSummary] = useState(false);
  const heard = useRef({ revealed: -1, theirs: false, end: false });

  const home = view ? moduleHref(view.module) : "/play";
  const last = view?.revealed[view.revealed.length - 1];
  const live = view?.question?.question ? view.question : undefined;
  // One picture or cry per question, from its start through its reveal.
  const media = useFirst(live?.index ?? last?.index, live ? live.question?.media : last?.question.media);
  const revealArt = useFirst(last?.index, last?.revealUrl);

  // Each new screen (lobby, a question, a reveal, the result) starts at the top.
  const screen = !view ? "" : view.status === "lobby" ? "lobby" : view.question ? `q ${view.question.index}` : `reveal ${view.revealed.length} ${summary}`;
  useEffect(() => {
    if (screen) window.scrollTo({ top: 0, behavior: "smooth" });
  }, [screen]);

  // Sounds: the opponent locking in, and each reveal (were you right?).
  useEffect(() => {
    if (!view || view.you === null) return;
    const h = heard.current;
    const theirs = !!view.question?.answered[1 - view.you];
    if (theirs && !h.theirs && !view.question?.yours) play("click");
    h.theirs = theirs;
    if (h.revealed >= 0 && view.revealed.length > h.revealed) {
      const mine = view.revealed[view.revealed.length - 1].picks[view.you];
      if (mine?.correct) play("correct");
      else {
        play("wrong");
        vibrate(60);
      }
    }
    h.revealed = view.revealed.length;
    if (view.end?.reason === "left" && !h.end && sawPlay && view.end.winner === view.you) play("fanfare");
    h.end = !!view.end;
  }, [view, sawPlay]);

  async function answer(choice: string) {
    if (!view?.question || view.question.yours || busy) return;
    unlockAudio();
    await act({ action: "answer", round: view.question.index, choice });
  }

  async function nextQuestion() {
    if (!view || view.you === null || !last || view.next?.pressed[view.you] || busy) return;
    unlockAudio();
    await act({ action: "next", round: last.index });
  }

  function showResults() {
    if (view?.end) play(view.end.winner === view.you ? "fanfare" : view.end.winner === null ? "streak" : "wrong");
    setSummary(true);
  }

  // Number keys answer, Enter / Space moves on from a reveal.
  const revealing = !!view && view.status === "playing" && !view.question && !!last;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, a")) return;
      if (live?.question && !live.yours && now < live.endsAt) {
        const n = /^[1-9]$/.test(e.key) ? Number(e.key) : 0;
        if (n >= 1 && n <= live.question.options.length) void answer(live.question.options[n - 1]);
      } else if (revealing && (e.key === "Enter" || e.key === " ") && !t?.closest("button")) {
        e.preventDefault();
        void nextQuestion();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function leave() {
    if (await act({ action: "leave" })) router.push(home);
  }

  async function startRematch() {
    const next = await rematch();
    if (next) router.push(pvpHref("quiz", next));
  }

  if (gone) return <DuelGone message={gone} href="/play" label="Back to the game modes" />;
  if (!view) return <DuelLoading />;

  const info = MODULE_INFO[view.module];
  const tag = `Quiz duel · ${info.title} · ${capitalize(view.difficulty)}`;
  const notice = (
    <>
      <DuelNotice error={error} offline={offline} />
      <EmoteFeed view={view} />
    </>
  );
  const tools = view.you !== null && (
    <DuelTools
      onEmote={(e) => {
        unlockAudio();
        return send({ action: "emote", emote: e });
      }}
    />
  );
  const chat = <DuelChat view={view} game="Quiz duel" onSend={(text) => send({ action: "chat", text })} />;

  if (view.status === "lobby") {
    return (
      <>
        {notice}
        <DuelLobby
          view={view}
          path={pvpHref("quiz", view.code)}
          tag={tag}
          title={
            <>
              {info.title} <span className="text-primary">Duel</span>
            </>
          }
          invite={(host) => `${host} challenges you! The same ${view.total} questions for both of you, the most points wins.`}
          about={`Head to head: the same ${view.total} ${info.title} questions for both of you, on ${view.difficulty}. Right and fast scores most.`}
          shareText={`Duel me in ${info.title}! Same ${view.total} questions, the most points wins.`}
          settings={
            <p className="text-center text-sm text-muted-foreground">
              Mode: <b className="text-foreground">{info.title}</b> · Difficulty: <b className="text-foreground">{capitalize(view.difficulty)}</b>
            </p>
          }
          rules={[
            {
              label: "Questions",
              text: `${view.total} questions, the same for both of you, ${QUIZ_DUEL_QUESTION_MS / 1000} seconds each. You see when your opponent locks in, never what they picked.`,
            },
            {
              label: "Points",
              text: `A right answer scores ${QUIZ_DUEL_POINTS}, plus up to ${QUIZ_DUEL_SPEED_BONUS} for speed. A wrong answer, or none in time, scores nothing.`,
            },
            {
              label: "Winning",
              text: `The most points after ${view.total} questions wins; level on points, the quicker right answers. Leave, or go quiet, and you forfeit.`,
            },
          ]}
          home={home}
          chat={chat}
          busy={busy}
          onJoin={join}
          onReady={(ready) => void act({ action: "ready", ready })}
          onLeave={() => void leave()}
        />
      </>
    );
  }

  if (view.you === null) {
    const winner = view.end?.winner;
    return (
      <DuelVisitor
        tag={tag}
        players={view.players}
        status={
          view.status === "finished"
            ? winner === null || winner === undefined
              ? "It ended in a draw."
              : `${view.players[winner]?.name} won.`
            : `Under way: question ${view.revealed.length + 1} of ${view.total}. ${fmt(view.scores[0])} points to ${fmt(view.scores[1])}.`
        }
        home={home}
        label="Start your own duel"
      />
    );
  }

  const me = view.you;
  const them = view.players[1 - me]?.name ?? "your opponent";

  if (view.status === "finished" && (summary || !sawPlay || view.end?.reason === "left" || !last)) {
    return (
      <>
        {notice}
        <DuelSummary view={view} busy={busy} home={home} onRematch={() => void startRematch()} />
        <div className="mx-auto mt-4 max-w-3xl space-y-4">
          {view.you !== null && <AddFriendAfterGame kind="quiz" code={view.code} />}
          {tools}
          {chat}
        </div>
      </>
    );
  }

  const leaveButton = <LeaveButton busy={busy} onLeave={() => void leave()} />;

  // ---- lead-in: "Question 3" ---------------------------------------------------------
  if (view.question && !live) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {notice}
        <DuelHud view={view} center={<div className="hud-label">Get ready</div>} />
        <Card>
          <CardContent className="space-y-3 p-10 text-center">
            <p className="hud-label text-screen">
              Question {view.question.index + 1} of {view.total}
            </p>
            <motion.p
              key={seconds(view.question.startsAt - now)}
              initial={{ scale: 1.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="font-display text-7xl font-bold tabular-nums"
            >
              {Math.max(1, seconds(view.question.startsAt - now))}
            </motion.p>
            <p className="text-sm text-muted-foreground">Right and fast: up to {QUIZ_DUEL_POINTS + QUIZ_DUEL_SPEED_BONUS} points.</p>
          </CardContent>
        </Card>
        {tools}
        {leaveButton}
      </div>
    );
  }

  // ---- answering -------------------------------------------------------------------------
  if (live?.question) {
    const left = Math.max(0, live.endsAt - now);
    const locked = live.yours ?? null;
    const theyLocked = live.answered[1 - me];
    const timeUp = left <= 0;
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {notice}
        <DuelHud view={view} center={<div className="hud-label">Q {live.index + 1}/{view.total}</div>} />
        <AnimatePresence>
          {(theyLocked || locked) && (
            <motion.p
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              role="status"
              className={cn(
                "rounded-md border px-4 py-2 text-center font-display text-sm font-semibold uppercase tracking-wider",
                locked ? "border-screen/40 text-screen" : "border-warning/50 bg-warning/[0.08] text-warning"
              )}
            >
              {locked ? (theyLocked ? "Both locked in!" : `Locked in. Waiting for ${them}…`) : `${them} has locked in!`}
            </motion.p>
          )}
        </AnimatePresence>
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 px-4 pt-4 sm:px-6">
            <HpBar value={left / QUIZ_DUEL_QUESTION_MS} label="TIME" className="flex-1" />
            <span className={cn("w-8 text-right font-pixel text-xs tabular-nums", left < QUIZ_DUEL_QUESTION_MS / 4 && "animate-blink text-destructive")}>{seconds(left)}</span>
          </div>
          <CardContent className="space-y-5 p-4 pt-4 sm:p-6 sm:pt-5">
            <QuestionBody key={live.index} question={live.question} media={media} />
            <Options
              question={live.question}
              onPick={locked || timeUp || busy ? undefined : (choice) => void answer(choice)}
              mine={locked}
            />
            {timeUp && !locked && <p className="text-center text-sm text-muted-foreground">Time&apos;s up! Waiting for the reveal…</p>}
          </CardContent>
        </Card>
        {tools}
        {leaveButton}
      </div>
    );
  }

  // ---- reveal --------------------------------------------------------------------------
  if (last) {
    const final = view.status === "finished";
    const pressed = view.next?.pressed[me] ?? false;
    const nextIn = view.next ? seconds(view.next.at - now) : 0;
    const mine = last.picks[me];
    const verdict = mine?.correct ? `Correct! It's ${last.answer}!` : mine ? `Not quite… it was ${last.answer}.` : `Time's up! It was ${last.answer}.`;
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {notice}
        <DuelHud view={view} center={<div className="hud-label">Q {last.index + 1}/{view.total}</div>} gained={last.picks.map((p) => p?.points ?? 0)} />
        <Card className="overflow-hidden">
          <CardContent className="space-y-5 p-4 sm:p-6">
            <QuestionBody key={last.index} question={last.question} media={media} revealUrl={revealArt} answer={last.answer} />
            <Options question={last.question} result={last} names={view.players.map((p) => p.name)} />
            <div className="grid grid-cols-2 gap-3">
              {last.picks.map((pick, seat) => (
                <PickResult key={seat} seat={seat} name={view.players[seat]?.name ?? "—"} pick={pick} />
              ))}
            </div>
            <DialogBox text={verdict} speed={10} className={mine?.correct ? "border-success/90" : "border-destructive/90"}>
              {(last.explanation || last.sourceUrl) && (
                <p className="text-sm text-muted-foreground">
                  {last.explanation}
                  {last.learnHref && (
                    <>
                      {" "}
                      <Link href={last.learnHref} target="_blank" className="font-medium text-screen hover:underline">
                        Study it in the Pokédex →
                      </Link>
                    </>
                  )}
                  {last.sourceUrl && <SourceLink href={last.sourceUrl} />}
                </p>
              )}
            </DialogBox>
            <Button size="lg" className="w-full" disabled={!final && (pressed || busy)} onClick={() => (final ? showResults() : void nextQuestion())}>
              {final ? "See results ▶" : pressed ? `Waiting for ${them}… (${nextIn})` : `Next question (${nextIn}) ▶`}
            </Button>
          </CardContent>
        </Card>
        {tools}
        {!final && leaveButton}
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** Both trainers' names and points, facing each other, with the question in the middle. */
function DuelHud({ view, center, gained }: { view: QuizDuelView; center: React.ReactNode; gained?: number[] }) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-md border bg-card/90 px-4 py-2 backdrop-blur">
      <Fighter view={view} seat={0} gained={gained?.[0]} />
      <div className="text-center">{center}</div>
      <Fighter view={view} seat={1} gained={gained?.[1]} right />
    </div>
  );
}

function Fighter({ view, seat, gained, right }: { view: QuizDuelView; seat: number; gained?: number; right?: boolean }) {
  const player = view.players[seat];
  const ahead = view.scores[seat] > view.scores[1 - seat];
  return (
    <div className={cn("min-w-0 space-y-0.5", right && "text-right")}>
      <div className={cn("flex items-center gap-1.5", right && "flex-row-reverse")}>
        <SeatDot seat={seat} />
        {player && <Avatar avatar={player.avatar} size={24} />}
        <span className="truncate font-display font-bold uppercase">{player?.name ?? "—"}</span>
        {view.you === seat && <span className="hud-label">You</span>}
        {player?.quiet && view.status === "playing" && <WifiOff className="h-3.5 w-3.5 shrink-0 text-warning" aria-label="Connection lost" />}
      </div>
      <div className={cn("flex items-center gap-2 font-pixel text-base tabular-nums", right && "flex-row-reverse", ahead ? "text-success" : "text-screen")}>
        <span>{fmt(view.scores[seat])} pts</span>
        {!!gained && (
          <motion.span key={`${seat}-${view.revealed.length}`} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="text-xs text-success">
            +{gained}
          </motion.span>
        )}
      </div>
    </div>
  );
}

/** The prompt, any text (a Pokédex entry) and the picture or cry. */
function QuestionBody({
  question,
  media,
  revealUrl,
  answer,
}: {
  question: QuizDuelQuestionView;
  media?: QuizDuelQuestionView["media"];
  revealUrl?: string;
  answer?: string;
}) {
  const isEntry = question.module === "dex" && question.detail?.startsWith("“");
  return (
    <>
      <DialogBox as="h2" text={question.prompt} speed={answer ? 0 : 12} />
      {question.detail &&
        (isEntry ? (
          <div className="screen rounded-md p-4">
            <div className="hud-label relative z-[3] mb-2 text-screen">Pokédex entry</div>
            <p className="relative z-[3] text-[15px] leading-relaxed text-foreground/90">{question.detail}</p>
          </div>
        ) : (
          <p className="hud-label normal-case tracking-wide text-muted-foreground">{question.detail}</p>
        ))}
      {media?.type === "image" && (
        <ImageMedia src={media.url} revealSrc={revealUrl} silhouette={question.module === "whos-that"} revealed={!!answer} label={answer} />
      )}
      {media?.type === "audio" &&
        (answer ? (
          revealUrl && <ImageMedia src={revealUrl} silhouette={false} revealed={false} label={answer} />
        ) : (
          <CryPlayer src={media.url} />
        ))}
      {!media && answer && revealUrl && <ImageMedia src={revealUrl} silhouette={false} revealed={false} label={answer} />}
    </>
  );
}

/**
 * The options: tappable while the question is open (`onPick`), with your
 * locked-in pick marked; in the reveal, the right one in green and each
 * trainer's pick marked with their colour.
 */
function Options({
  question,
  onPick,
  mine,
  result,
  names,
}: {
  question: QuizDuelQuestionView;
  onPick?: (choice: string) => void;
  mine?: string | null;
  result?: QuizDuelResult;
  names?: string[];
}) {
  const cards = question.cards?.length ? question.cards : null;
  return (
    <div className={cn("grid gap-2.5", cards ? "grid-cols-2" : "sm:grid-cols-2")}>
      {question.options.map((option, i) => {
        const right = result?.answer === option;
        const pickedBy = result ? result.picks.flatMap((p, seat) => (p?.choice === option ? [seat] : [])) : [];
        const card = cards?.[i];
        return (
          <motion.button
            key={option}
            type="button"
            disabled={!onPick}
            onPointerDown={unlockAudio}
            onClick={() => onPick?.(option)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: result ? 0 : 0.05 + i * 0.04, duration: 0.24 }}
            className={cn(
              "menu-item flex w-full flex-col items-stretch justify-center gap-2 rounded-md border-2 border-foreground/10 bg-shade/30 px-4 text-left font-display text-[15px] font-semibold tracking-wide",
              card ? "py-3" : "min-h-[52px] py-2.5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              onPick && "hover:border-screen/60 hover:bg-screen/[0.06]",
              mine === option && "border-screen/70 bg-screen/10",
              right && "border-success bg-success/15 shadow-[0_0_18px_-6px_hsl(var(--success))]",
              result && !right && pickedBy.length > 0 && "border-destructive bg-destructive/15",
              result && !right && pickedBy.length === 0 && "opacity-50"
            )}
          >
            {card && (
              <div className="screen relative mx-auto aspect-square w-full max-w-[150px] rounded-md">
                <Image src={card.imageUrl} alt={card.label} fill priority sizes="150px" className="relative z-[1] object-contain p-2" />
              </div>
            )}
            <span className="flex items-center justify-between gap-2">
              <span className={cn("flex-1", card && "text-center")}>{card?.label ?? option}</span>
              {pickedBy.map((seat) => (
                <span
                  key={seat}
                  className="rounded-sm px-1.5 py-0.5 font-pixel text-[9px] uppercase text-white"
                  style={{ background: SEAT_COLORS[seat] }}
                  title={`${names?.[seat] ?? "A trainer"}'s pick`}
                >
                  {names?.[seat] ?? "?"}
                </span>
              ))}
              {result ? (
                right && <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Right answer" />
              ) : mine === option ? (
                <span className="hud-label text-screen">Locked in</span>
              ) : (
                <kbd className="hidden font-pixel text-[10px] text-muted-foreground sm:inline" aria-hidden>
                  [{i + 1}]
                </kbd>
              )}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

/** One trainer's result for a question: right or wrong, how fast, the points. */
function PickResult({ seat, name, pick }: { seat: number; name: string; pick: QuizDuelPick | null }) {
  return (
    <div className={cn("rounded-md border bg-shade/20 p-3 text-center", pick?.correct && "border-success/50")}>
      <p className="hud-label flex items-center justify-center gap-1.5">
        <SeatDot seat={seat} /> {name}
      </p>
      <p className={cn("flex items-center justify-center gap-1.5 font-display text-2xl font-bold tabular-nums", pick?.correct ? "text-success" : "text-muted-foreground")}>
        {pick?.correct ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <XCircle className="h-5 w-5" aria-hidden />}+{pick?.points ?? 0}
      </p>
      <p className="text-xs text-muted-foreground">{pick ? `${pick.correct ? "Right" : "Wrong"} in ${(pick.ms / 1000).toFixed(1)} s` : "No answer in time"}</p>
    </div>
  );
}

function DuelSummary({ view, busy, home, onRematch }: { view: QuizDuelView; busy: boolean; home: string; onRematch: () => void }) {
  const me = view.you!;
  const end = view.end!;
  const them = view.players[1 - me]?.name ?? "Your opponent";
  const won = end.winner === me;
  const draw = end.winner === null;
  const [mine, theirs] = [view.scores[me], view.scores[1 - me]];
  const right = (seat: number) => view.revealed.filter((r) => r.picks[seat]?.correct).length;
  const reason = {
    played: draw
      ? "Level on points, and just as quick."
      : mine !== theirs
        ? won
          ? `You scored ${fmt(mine)} to ${fmt(theirs)}.`
          : `${them} scored ${fmt(theirs)} to ${fmt(mine)}.`
        : `Level on ${fmt(mine)} points: ${won ? "your" : `${them}'s`} right answers were quicker.`,
    left: won ? `${them} left the duel.` : "You left the duel.",
    idle: draw
      ? `Neither of you answered for ${QUIZ_DUEL_IDLE_QUESTIONS} questions.`
      : won
        ? `${them} stopped answering.`
        : `You didn't answer for ${QUIZ_DUEL_IDLE_QUESTIONS} questions.`,
  }[end.reason];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2 text-center">
        <p className="hud-label text-screen">
          Duel over · {MODULE_INFO[view.module].title} · {capitalize(view.difficulty)}
        </p>
        <div className={cn("flex items-center justify-center gap-3 font-display text-6xl font-bold uppercase", won ? "text-success" : draw ? "text-screen" : "text-destructive")}>
          {won && <Crown className="h-12 w-12" aria-hidden />}
          {draw ? "Draw" : won ? "Victory!" : "Defeat"}
        </div>
        <p className="text-muted-foreground">{reason}</p>
      </div>

      <DuelHud view={view} center={<div className="hud-label">Final</div>} />

      <Card>
        <CardContent className="space-y-5 p-5">
          {view.revealed.length > 0 && (
            <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-4 gap-y-1.5 text-sm">
              <span />
              <span className="hud-label">Answer</span>
              {[0, 1].map((seat) => (
                <span key={seat} className="hud-label flex items-center justify-end gap-1.5">
                  <SeatDot seat={seat} />
                  {view.players[seat]?.name} · {right(seat)}/{view.revealed.length}
                </span>
              ))}
              {view.revealed.map((r) => (
                <div key={r.index} className="contents">
                  <span className="font-pixel text-xs text-muted-foreground">Q{r.index + 1}</span>
                  <span className="min-w-0 truncate font-semibold" title={r.question.prompt}>
                    {r.answer}
                  </span>
                  {r.picks.map((p, seat) => (
                    <span key={seat} className={cn("text-right tabular-nums", p?.correct ? "font-bold text-success" : "text-muted-foreground")}>
                      {p ? `${p.correct ? "✓" : "✗"} +${p.points} · ${(p.ms / 1000).toFixed(1)} s` : "—"}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}

          {view.rematch && (
            <p role="status" className="text-center font-display text-sm font-semibold uppercase tracking-wider text-warning">
              Rematch requested!
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button size="lg" variant="success" disabled={busy} onClick={onRematch}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
              {view.rematch ? "Accept rematch" : "Rematch"}
            </Button>
            <Link href={home} className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
              <Swords className="h-4 w-4" aria-hidden /> Back to {MODULE_INFO[view.module].title}
            </Link>
          </div>
          <p className="text-center text-xs text-muted-foreground">A rematch keeps the mode, difficulty and trainers, with new questions. It starts when you both press it.</p>
        </CardContent>
      </Card>
    </div>
  );
}
