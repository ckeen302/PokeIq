"use client";

import { SourceLink } from "./SourceLink";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "@/components/ui/Link";
import { useRouter } from "@/i18n/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Crown, Loader2, RotateCcw, Swords, WifiOff, XCircle } from "lucide-react";
import {
  QUIZ_DUEL_IDLE_QUESTIONS,
  QUIZ_DUEL_POINTS,
  QUIZ_DUEL_QUESTION_MS,
  QUIZ_DUEL_SPEED_BONUS,
  ZOOM_DUEL_QUESTION_MS,
  pvpHref,
  type QuizDuelPick,
  type QuizDuelQuestionView,
  type QuizDuelResult,
  type QuizDuelView,
} from "@/lib/pvp-types";
import { levelKey, moduleHref } from "@/lib/modes";
import { play, unlockAudio, vibrate } from "@/lib/sound";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DialogBox } from "@/components/game/DialogBox";
import { HpBar } from "@/components/game/HpBar";
import { useDuel } from "@/components/duel/use-duel";
import { DuelGone, DuelLoading, DuelLobby, DuelNotice, DuelVisitor, LeaveButton, SEAT_COLORS, SeatDot, seconds } from "@/components/duel/DuelParts";
import { DuelChat, DuelTools, EmoteFeed } from "@/components/duel/DuelReactions";
import { CryPlayer, ImageMedia } from "./QuestionMedia";
import { GuessBox, TeamBoard, TrainerReveal } from "./WhoseTeam";
import { preloadAssets, questionAssets } from "@/lib/preload";
import { cn } from "@/lib/utils";
import { AddFriendAfterGame } from "@/components/community/AddFriend";
import { ZOOM_POINTS, ZOOM_SKIP, ZOOM_STEPS, zoomShareLine } from "@/lib/zoom-reveal";
import type { NameEntry } from "@/components/pokedle/parts";
import { ZoomPlay, zoomGuess as guessName } from "./zoom/ZoomPlay";
import { Avatar } from "@/components/avatar/Avatar";
import { useT } from "@/i18n/client";
import { formatNumber, type Translator } from "@/i18n/catalog";
import type { Locale } from "@/i18n/config";
import duelNs from "@/messages/quiz-duel";
import runNs from "@/messages/quiz-run";
import modesNs from "@/messages/quiz-modes";

/**
 * A quiz duel at /quiz/duel/<code>: the lobby, ten questions with their
 * reveals, and the result. The server runs the duel; this polls it (every
 * second in play, and right on time for each question) and sends the
 * trainer's answers. Your pick stays yours until the reveal, which shows the
 * right answer and both picks.
 */

const fmt = (n: number, locale: Locale) => formatNumber(n, locale);
/** Seconds with one decimal: "1.5" ("1,5" in a language that writes a decimal comma). */
const secs = (ms: number, locale: Locale) => (locale === "en" ? (ms / 1000).toFixed(1) : formatNumber(ms / 1000, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

type ModesT = Translator<typeof modesNs.en>;
/** The mode's name, and its difficulty's where it has a choice (Whose Team and Real Shiny; every other mode plays one fixed tuning). */
function modeWords(view: QuizDuelView, mt: ModesT): { mode: string; level: string | null } {
  const key = levelKey(view.module, view.difficulty);
  return { mode: mt(`modules.${view.module}.title`), level: key ? mt(`levels.${key}.label`) : null };
}

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
  const t = useT(duelNs);
  const rt = useT(runNs);
  const mt = useT(modesNs);
  const lang = t.locale;
  const router = useRouter();
  // A page in another language asks for the questions in it.
  const { view, now, gone, offline, error, busy, sawPlay, act, send, join, rematch } = useDuel<QuizDuelView>(`/api/duel/${code}${lang === "en" ? "" : `?lang=${lang}`}`, code, questionDue);
  const [summary, setSummary] = useState(false);
  const heard = useRef({ revealed: -1, theirs: false, end: false });

  const home = view ? moduleHref(view.module) : "/quiz";
  const last = view?.revealed[view.revealed.length - 1];
  const live = view?.question?.question ? view.question : undefined;
  // One picture or cry per question, from its start through its reveal.
  const media = useFirst(live?.index ?? last?.index, live ? live.question?.media : last?.question.media);
  const revealArt = useFirst(last?.index, last?.revealUrl);
  // Zoom Reveal: one crop per step (its URL is re-signed on every poll too).
  const liveZoom = live?.question?.zoom;
  const zoomView = useFirst(
    live ? live.index * 10 + (liveZoom?.step ?? 0) : last ? last.index * 10 + 9 : undefined,
    live ? liveZoom : last?.question.zoom
  );
  // The names this trainer has tried on the live question: a step further out means the last one was wrong.
  const [tried, setTried] = useState<{ index: number; list: NameEntry[] }>({ index: -1, list: [] });
  const sentGuess = useRef<{ index: number; step: number; entry: NameEntry | null } | null>(null);
  const myStep = liveZoom?.step;
  useEffect(() => {
    const sent = sentGuess.current;
    if (!live || myStep === undefined || !sent || sent.index !== live.index || myStep <= sent.step) return;
    sentGuess.current = null;
    if (sent.entry) {
      const entry = sent.entry;
      setTried((t) => ({ index: live.index, list: t.index === live.index ? [...t.list, entry] : [entry] }));
    }
    // Only a new step moves a tried name into the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myStep, live?.index]);
  const triedNow = live && tried.index === live.index ? tried.list : last && tried.index === last.index ? tried.list : [];

  // Each trainer's clock starts once their browser has the question's images
  // and cry loaded (bounded server-side): preload, then tell the server.
  const liveQ = live?.question;
  const liveIndex = live?.index;
  const needsLoad = !!liveQ && view?.you != null && live?.loaded === false;
  const loadSent = useRef(-1);
  useEffect(() => {
    if (!needsLoad || liveIndex === undefined || !liveQ || loadSent.current === liveIndex) return;
    loadSent.current = liveIndex;
    void preloadAssets(questionAssets({ ...liveQ, media })).then(() => send({ action: "loaded", round: liveIndex }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsLoad, liveIndex]);

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

  async function zoomGuess(entry: NameEntry | null) {
    if (!view?.question?.question?.zoom || view.question.yours || busy) return;
    unlockAudio();
    sentGuess.current = { index: view.question.index, step: view.question.question.zoom.step, entry };
    if (!(await act({ action: "zoom", round: view.question.index, choice: entry ? guessName(entry) : ZOOM_SKIP }))) sentGuess.current = null;
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
      if (live?.question && !live.question.input && !live.yours && now < live.endsAt) {
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

  if (gone) return <DuelGone message={gone} href="/quiz" label={t("backToModes")} />;
  if (!view) return <DuelLoading />;

  const { mode, level } = modeWords(view, mt);
  const isZoom = view.module === "zoom-reveal";
  const questionMs = isZoom ? ZOOM_DUEL_QUESTION_MS : QUIZ_DUEL_QUESTION_MS;
  const tag = [t("tag"), mode, level].filter(Boolean).join(" · ");
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
  const chat = <DuelChat view={view} game={t("tag")} onSend={(text) => send({ action: "chat", text })} />;

  if (view.status === "lobby") {
    return (
      <>
        {notice}
        <DuelLobby
          view={view}
          path={pvpHref("quiz", view.code)}
          tag={tag}
          title={t.rich("title", { mode, d: (c) => <span className="text-primary">{c}</span> })}
          invite={(host) => t("invite", { host, n: view.total })}
          about={level ? t("aboutLevel", { n: view.total, mode, level }) : t("about", { n: view.total, mode })}
          shareText={t("shareText", { mode, n: view.total })}
          settings={
            <p className="text-center text-sm text-muted-foreground">
              {level
                ? t.rich("settingsLevel", { mode, level, b: (c) => <b className="text-foreground">{c}</b> })
                : t.rich("settings", { mode, b: (c) => <b className="text-foreground">{c}</b> })}
            </p>
          }
          rules={isZoom ? [
            {
              label: t("rules.pokemon"),
              text: t("rules.zoomPokemon", { n: view.total, seconds: ZOOM_DUEL_QUESTION_MS / 1000 }),
            },
            {
              label: t("rules.points"),
              text: t("rules.zoomPoints", { first: ZOOM_POINTS[0], last: ZOOM_POINTS[ZOOM_STEPS - 1], steps: ZOOM_STEPS }),
            },
            {
              label: t("rules.winning"),
              text: t("rules.zoomWinning", { n: view.total }),
            },
          ] : [
            {
              label: t("rules.questions"),
              text: t("rules.questionsText", { n: view.total, seconds: QUIZ_DUEL_QUESTION_MS / 1000 }),
            },
            {
              label: t("rules.points"),
              text: t("rules.pointsText", { points: QUIZ_DUEL_POINTS, bonus: QUIZ_DUEL_SPEED_BONUS }),
            },
            {
              label: t("rules.winning"),
              text: t("rules.winningText", { n: view.total }),
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
              ? t("visitor.draw")
              : t("visitor.won", { name: `${view.players[winner]?.name}` })
            : t("visitor.underway", { n: view.revealed.length + 1, total: view.total, a: fmt(view.scores[0], lang), b: fmt(view.scores[1], lang) })
        }
        home={home}
        label={t("visitor.start")}
      />
    );
  }

  const me = view.you;
  const them = view.players[1 - me]?.name ?? t("yourOpponent");

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
        <DuelHud view={view} center={<div className="hud-label">{t("getReady")}</div>} />
        <Card>
          <CardContent className="space-y-3 p-10 text-center">
            <p className="hud-label text-screen">
              {t("questionOf", { n: view.question.index + 1, total: view.total })}
            </p>
            <motion.p
              key={seconds(view.question.startsAt - now)}
              initial={{ scale: 1.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="font-display text-7xl font-bold tabular-nums"
            >
              {Math.max(1, seconds(view.question.startsAt - now))}
            </motion.p>
            <p className="text-sm text-muted-foreground">
              {isZoom ? t("zoomUpTo", { points: ZOOM_POINTS[0] }) : t("upTo", { points: QUIZ_DUEL_POINTS + QUIZ_DUEL_SPEED_BONUS })}
            </p>
          </CardContent>
        </Card>
        {tools}
        {leaveButton}
      </div>
    );
  }

  // ---- answering -------------------------------------------------------------------------
  if (live?.question) {
    const loading = live.loaded === false;
    const left = loading ? questionMs : Math.max(0, live.endsAt - now);
    const locked = live.yours ?? null;
    const theyLocked = live.answered[1 - me];
    const timeUp = left <= 0;
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {notice}
        <DuelHud view={view} center={<div className="hud-label">{t("hud", { n: live.index + 1, total: view.total })}</div>} />
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
              {isZoom
                ? locked ? (theyLocked ? t("bothDone") : t("doneWaiting", { name: them })) : t("theyDone", { name: them })
                : locked ? (theyLocked ? t("bothLocked") : t("lockedWaiting", { name: them })) : t("theyLocked", { name: them })}
            </motion.p>
          )}
        </AnimatePresence>
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 px-4 pt-4 sm:px-6">
            <HpBar value={left / questionMs} label={t("time")} className="flex-1" />
            <span className={cn("w-8 text-right font-pixel text-xs tabular-nums", left < questionMs / 4 && "animate-blink text-destructive")}>{seconds(left)}</span>
          </div>
          <CardContent className="relative space-y-5 p-4 pt-4 sm:p-6 sm:pt-5">
            {loading && (
              <div className="absolute inset-0 z-10 flex items-start justify-center pt-16" role="status">
                <span className="hud-label animate-pulse text-muted-foreground">{t("loading")}</span>
              </div>
            )}
            <div className={cn("space-y-5", loading && "invisible")} aria-hidden={loading || undefined}>
            {isZoom && zoomView ? (
              <>
                <DialogBox as="h2" text={live.question.prompt} speed={12} />
                <ZoomPlay
                  key={live.index}
                  view={zoomView}
                  wrong={triedNow}
                  locked={!!locked || timeUp || busy || loading}
                  onGuess={(entry) => void zoomGuess(entry)}
                  onSkip={() => void zoomGuess(null)}
                  waiting={locked ? (theyLocked ? t("bothDoneRevealing") : t("waitingFor", { name: them })) : timeUp ? t("timeUpWaiting") : undefined}
                />
                {live.steps && !theyLocked && (
                  <p className="text-center font-pixel text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t("theirStep", { name: them, step: live.steps[1 - me], steps: ZOOM_STEPS })}
                  </p>
                )}
              </>
            ) : live.question.input === "type" ? (
              <>
                <QuestionBody key={live.index} question={live.question} media={media} />
                <TeamBoard
                  cards={live.question.cards ?? []}
                  reveal={live.question.reveal}
                  onReveal={locked || timeUp || loading ? undefined : () => void act({ action: "reveal", round: live.index })}
                  revealing={busy}
                />
                {locked ? (
                  <p className="rounded-md border-2 border-screen/50 bg-screen/10 px-4 py-3 text-center font-display font-semibold tracking-wide" role="status">
                    {t("lockedIn", { answer: locked })}
                  </p>
                ) : (
                  <GuessBox key={live.index} options={live.question.options} disabled={timeUp || busy || loading} onGuess={(name) => void answer(name)} />
                )}
              </>
            ) : (
              <>
                <QuestionBody key={live.index} question={live.question} media={media} />
                <Options
                  question={live.question}
                  onPick={locked || timeUp || busy || loading ? undefined : (choice) => void answer(choice)}
                  mine={locked}
                />
              </>
            )}
            </div>
            {timeUp && !locked && !isZoom && <p className="text-center text-sm text-muted-foreground">{t("timeUpWaiting")}</p>}
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
    // Picture questions grade by a card id, which means nothing to read out.
    const typed = last.question.input === "type";
    const pictures = !!last.question.cards?.length && !typed;
    const answerText = pictures ? rt("verdict.markedGreen") : last.answer;
    const verdict = isZoom
      ? mine?.correct
        ? rt("verdict.zoomCorrect", { answer: last.answer, step: mine.step ?? 1, steps: ZOOM_STEPS })
        : rt("verdict.zoomMissed", { answer: last.answer })
      : mine?.correct ? (pictures ? rt("verdict.theOne") : rt("verdict.correct", { answer: answerText })) : mine ? rt("verdict.wrong", { answer: answerText }) : rt("verdict.timeUp", { answer: answerText });
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {notice}
        <DuelHud view={view} center={<div className="hud-label">{t("hud", { n: last.index + 1, total: view.total })}</div>} gained={last.picks.map((p) => p?.points ?? 0)} />
        <Card className="overflow-hidden">
          <CardContent className="space-y-5 p-4 sm:p-6">
            {isZoom && zoomView ? (
              <>
                <DialogBox as="h2" text={last.question.prompt} speed={0} />
                <ZoomPlay
                  key={last.index}
                  view={zoomView}
                  wrong={triedNow}
                  locked
                  outcome={{ step: mine?.step ?? ZOOM_STEPS, solved: !!mine?.correct, answer: last.answer, revealUrl: revealArt, revealFrom: last.zoomFrom }}
                  onGuess={() => undefined}
                  onSkip={() => undefined}
                  shareTitle={t("shareTitle", { n: last.index + 1 })}
                />
              </>
            ) : typed ? (
              <>
                <QuestionBody key={last.index} question={last.question} media={media} revealUrl={revealArt} answer={last.answer} />
                <TeamBoard cards={last.question.cards ?? []} />
                <TrainerReveal name={last.answer} appearance={last.explanation} correct={!!mine?.correct} />
              </>
            ) : (
              <>
                <QuestionBody key={last.index} question={last.question} media={media} revealUrl={revealArt} answer={last.answer} />
                <Options question={last.question} result={last} names={view.players.map((p) => p.name)} />
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              {last.picks.map((pick, seat) => (
                <PickResult key={seat} seat={seat} name={view.players[seat]?.name ?? "—"} pick={pick} said={typed} />
              ))}
            </div>
            <DialogBox text={verdict} speed={10} className={mine?.correct ? "border-success/90" : "border-destructive/90"}>
              {(last.explanation || last.sourceUrl) && (
                <p className="text-sm text-muted-foreground">
                  {!typed && last.explanation}
                  {last.learnHref && (
                    <>
                      {" "}
                      <Link href={last.learnHref} target="_blank" className="font-medium text-screen hover:underline">
                        {rt("study")}
                      </Link>
                    </>
                  )}
                  {last.sourceUrl && <SourceLink href={last.sourceUrl} />}
                </p>
              )}
            </DialogBox>
            <Button size="lg" className="w-full" disabled={!final && (pressed || busy)} onClick={() => (final ? showResults() : void nextQuestion())}>
              {final ? t("seeResults") : pressed ? t("waitingNext", { name: them, n: nextIn }) : t("next", { n: nextIn })}
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
  const t = useT(duelNs);
  const player = view.players[seat];
  const ahead = view.scores[seat] > view.scores[1 - seat];
  return (
    <div className={cn("min-w-0 space-y-0.5", right && "text-right")}>
      <div className={cn("flex items-center gap-1.5", right && "flex-row-reverse")}>
        <SeatDot seat={seat} />
        {player && <Avatar avatar={player.avatar} size={24} />}
        <span className="truncate font-display font-bold uppercase">{player?.name ?? "—"}</span>
        {view.you === seat && <span className="hud-label">{t("you")}</span>}
        {player?.quiet && view.status === "playing" && <WifiOff className="h-3.5 w-3.5 shrink-0 text-warning" aria-label={t("connectionLost")} />}
      </div>
      <div className={cn("flex items-center gap-2 font-pixel text-base tabular-nums", right && "flex-row-reverse", ahead ? "text-success" : "text-screen")}>
        <span>{t("pts", { score: fmt(view.scores[seat], t.locale) })}</span>
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
  const rt = useT(runNs);
  const isEntry = question.module === "dex" && question.detail?.startsWith("“");
  return (
    <>
      <DialogBox as="h2" text={question.prompt} speed={answer ? 0 : 12} />
      {question.detail &&
        (isEntry ? (
          <div className="screen rounded-md p-4">
            <div className="hud-label relative z-[3] mb-2 text-screen">{rt("entry")}</div>
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
  const t = useT(duelNs);
  const rt = useT(runNs);
  const cards = question.cards?.length ? question.cards : null;
  const images = question.images ?? null;
  return (
    <div className={cn("grid gap-2.5", cards || images ? "grid-cols-2" : "sm:grid-cols-2")}>
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
              card || images ? "py-3" : "min-h-[52px] py-2.5",
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
                <Image src={card.imageUrl} alt={card.label} fill priority unoptimized sizes="150px" className="relative z-[1] object-contain p-2" />
              </div>
            )}
            {images && (
              <div className="screen relative mx-auto aspect-square w-full max-w-[200px] rounded-md">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={images[i]} alt={rt("option", { n: i + 1 })} width={384} height={384} draggable={false} className="relative z-[1] h-full w-full object-contain p-1 [image-rendering:pixelated]" />
              </div>
            )}
            <span className="flex items-center justify-between gap-2">
              <span className={cn("flex-1", (card || images) && "text-center")}>{images ? rt("option", { n: i + 1 }) : (card?.label ?? option)}</span>
              {pickedBy.map((seat) => (
                <span
                  key={seat}
                  className="rounded-sm px-1.5 py-0.5 font-pixel text-[9px] uppercase text-white"
                  style={{ background: SEAT_COLORS[seat] }}
                  title={t("pick", { name: names?.[seat] ?? t("aTrainer") })}
                >
                  {names?.[seat] ?? "?"}
                </span>
              ))}
              {result ? (
                right && <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label={t("rightAnswer")} />
              ) : mine === option ? (
                <span className="hud-label text-screen">{t("locked")}</span>
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
function PickResult({ seat, name, pick, said }: { seat: number; name: string; pick: QuizDuelPick | null; said?: boolean }) {
  const t = useT(duelNs);
  return (
    <div className={cn("rounded-md border bg-shade/20 p-3 text-center", pick?.correct && "border-success/50")}>
      <p className="hud-label flex items-center justify-center gap-1.5">
        <SeatDot seat={seat} /> {name}
      </p>
      <p className={cn("flex items-center justify-center gap-1.5 font-display text-2xl font-bold tabular-nums", pick?.correct ? "text-success" : "text-muted-foreground")}>
        {pick?.correct ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <XCircle className="h-5 w-5" aria-hidden />}+{pick?.points ?? 0}
      </p>
      {pick?.step !== undefined ? (
        <p className="text-xs text-muted-foreground">{zoomShareLine(pick.step, pick.correct)}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {pick ? t(pick.correct ? "rightIn" : "wrongIn", { s: secs(pick.ms, t.locale) }) : t("noAnswer")}
          {pick?.shown !== undefined && t("saw", { n: pick.shown })}
        </p>
      )}
      {said && pick && !pick.correct && <p className="truncate text-xs text-muted-foreground">{t("said", { answer: pick.choice })}</p>}
    </div>
  );
}

function DuelSummary({ view, busy, home, onRematch }: { view: QuizDuelView; busy: boolean; home: string; onRematch: () => void }) {
  const t = useT(duelNs);
  const mt = useT(modesNs);
  const lang = t.locale;
  const { mode, level } = modeWords(view, mt);
  const me = view.you!;
  const end = view.end!;
  const them = view.players[1 - me]?.name ?? t("opponent");
  const won = end.winner === me;
  const draw = end.winner === null;
  const [mine, theirs] = [view.scores[me], view.scores[1 - me]];
  const right = (seat: number) => view.revealed.filter((r) => r.picks[seat]?.correct).length;
  const reason = {
    played: draw
      ? t("summary.levelQuick")
      : mine !== theirs
        ? won
          ? t("summary.youScored", { a: fmt(mine, lang), b: fmt(theirs, lang) })
          : t("summary.theyScored", { name: them, a: fmt(theirs, lang), b: fmt(mine, lang) })
        : won
          ? t("summary.yourQuicker", { a: fmt(mine, lang) })
          : t("summary.theirQuicker", { a: fmt(mine, lang), name: them }),
    left: won ? t("summary.theyLeft", { name: them }) : t("summary.youLeft"),
    idle: draw
      ? t("summary.neitherIdle", { n: QUIZ_DUEL_IDLE_QUESTIONS })
      : won
        ? t("summary.theyIdle", { name: them })
        : t("summary.youIdle", { n: QUIZ_DUEL_IDLE_QUESTIONS }),
  }[end.reason];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2 text-center">
        <p className="hud-label text-screen">
          {[t("summary.over"), mode, level].filter(Boolean).join(" · ")}
        </p>
        <div className={cn("flex items-center justify-center gap-3 font-display text-6xl font-bold uppercase", won ? "text-success" : draw ? "text-screen" : "text-destructive")}>
          {won && <Crown className="h-12 w-12" aria-hidden />}
          {draw ? t("summary.draw") : won ? t("summary.victory") : t("summary.defeat")}
        </div>
        <p className="text-muted-foreground">{reason}</p>
      </div>

      <DuelHud view={view} center={<div className="hud-label">{t("summary.final")}</div>} />

      <Card>
        <CardContent className="space-y-5 p-5">
          {view.revealed.length > 0 && (
            <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-4 gap-y-1.5 text-sm">
              <span />
              <span className="hud-label">{t("summary.answer")}</span>
              {[0, 1].map((seat) => (
                <span key={seat} className="hud-label flex items-center justify-end gap-1.5">
                  <SeatDot seat={seat} />
                  {view.players[seat]?.name} · {right(seat)}/{view.revealed.length}
                </span>
              ))}
              {view.revealed.map((r) => (
                <div key={r.index} className="contents">
                  <span className="font-pixel text-xs text-muted-foreground">{t("summary.row", { n: r.index + 1 })}</span>
                  <span className="min-w-0 truncate font-semibold" title={r.question.prompt}>
                    {r.answer}
                  </span>
                  {r.picks.map((p, seat) => (
                    <span key={seat} className={cn("text-right tabular-nums", p?.correct ? "font-bold text-success" : "text-muted-foreground")}>
                      {p
                        ? p.step !== undefined
                          ? t("summary.zoomPick", { mark: p.correct ? "✓" : "✗", points: p.points, step: p.correct ? p.step : "X", steps: ZOOM_STEPS })
                          : t("summary.pick", { mark: p.correct ? "✓" : "✗", points: p.points, s: secs(p.ms, lang) })
                        : "—"}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}

          {view.rematch && (
            <p role="status" className="text-center font-display text-sm font-semibold uppercase tracking-wider text-warning">
              {t("summary.rematchRequested")}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button size="lg" variant="success" disabled={busy} onClick={onRematch}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
              {view.rematch ? t("summary.accept") : t("summary.rematch")}
            </Button>
            <Link href={home} className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
              <Swords className="h-4 w-4" aria-hidden /> {t("summary.back", { mode })}
            </Link>
          </div>
          <p className="text-center text-xs text-muted-foreground">{level ? t("summary.keepsLevel") : t("summary.keeps")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
