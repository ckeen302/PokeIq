"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "@/components/ui/Link";
import { useRouter } from "@/i18n/navigation";
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "framer-motion";
import { CheckCircle2, Crown, Loader2, RotateCcw, Shuffle, Swords, Timer, WifiOff, XCircle } from "lucide-react";
import { CONN_DUEL_MS, CONN_DUEL_PENALTY_MS, pvpHref, type ConnDuelBoard, type ConnDuelView } from "@/lib/pvp-types";
import { guessKey, type ConnSize, type ConnTile } from "@/lib/connections/types";
import { localizePath } from "@/i18n/paths";
import { CONN_SQUARES } from "@/lib/share";
import { useConnPrefs } from "@/lib/connections/local";
import { recordConnDuel, type BadgeDef } from "@/lib/progress";
import { NewBadges } from "./results";
import { play, unlockAudio, vibrate } from "@/lib/sound";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useDuel } from "@/components/duel/use-duel";
import { DuelGone, DuelLoading, DuelLobby, DuelNotice, DuelVisitor, LeaveButton, MatchedNote, SeatDot, clock, seconds } from "@/components/duel/DuelParts";
import { DuelChat, DuelTools, EmoteFeed } from "@/components/duel/DuelReactions";
import { SeriesScore, seriesTag } from "@/components/duel/DuelSeries";
import { AddFriendAfterGame } from "@/components/community/AddFriend";
import { Avatar } from "@/components/avatar/Avatar";
import { ShareButton } from "@/components/share/ShareButton";
import { CONTROLS_DOCK, CONTROLS_WRAP, GridTile, GroupBar, GuessHistory, LevelMark, MistakeDots, WhyPanel, levelStyle, type TileMotion } from "./parts";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import type { Translator } from "@/i18n/catalog";
import duelNs from "@/messages/connections-duel";
import board from "@/messages/connections-board";
import share from "@/messages/share";
import { levelName } from "./parts";

type DuelT = Translator<typeof duelNs.en>;

/**
 * A PokéConnections duel at /pokeconnections/duel/<code>: the lobby, the race
 * and the result. The server runs the race and checks every guess; this
 * polls it (every second while racing) and sends the trainer's groups. You
 * see your opponent's progress as colours and counts only; the groups'
 * names and Pokémon reach you as you find them, and all four (with the
 * "Why?" panel) once the duel is over.
 */

const PENALTY_S = CONN_DUEL_PENALTY_MS / 1000;
const TOAST_MS = 1600;
const HOME = "/pokeconnections";

/** "1:23", or "1:23 + 0:30" with penalties. */
function timeText(b: ConnDuelBoard): string {
  if (b.ms === undefined) return "–";
  const penalty = b.mistakes * CONN_DUEL_PENALTY_MS;
  return penalty ? `${clock(b.ms)} + ${clock(penalty)}` : clock(b.ms);
}

const sizeOf = (view: Pick<ConnDuelView, "size"> | undefined): ConnSize => (view?.size === 5 ? 5 : 4);

/** "Solved in 1:53", "Out · 2/4 groups", "1/4 groups". */
function boardStatus(b: ConnDuelBoard | undefined, size: ConnSize, t: DuelT): string {
  if (!b) return "";
  if (b.solved) return t("status.solved", { time: clock(b.score ?? 0) });
  return t(b.out ? "status.out" : "status.groups", { found: b.found.length, size });
}

export function ConnectionsDuel({ code }: { code: string }) {
  const t = useT(duelNs);
  const router = useRouter();
  const prefs = useConnPrefs();
  const symbols = prefs?.symbols ?? true;
  const { view, now, gone, offline, error, setError, busy, sawPlay, act, send, join, rematch } = useDuel<ConnDuelView>(`/api/duel/${code}${t.locale === "en" ? "" : `?lang=${t.locale}`}`, code);
  const [order, setOrder] = useState<number[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const [tileMotion, setTileMotion] = useState<{ kind: Exclude<TileMotion, null>; ids: number[] } | null>(null);
  const [announce, setAnnounce] = useState("");
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const toastTimer = useRef<number | undefined>(undefined);
  const heard = useRef({ results: -1, theirs: -1, theirMistakes: -1, end: false });
  const [duelBadges, setDuelBadges] = useState<BadgeDef[]>([]);

  // A finished duel counts toward your record and badges, once (by its code, so a reload never counts it twice).
  const endedAs = view?.status === "finished" && view.you !== null && view.end ? (view.end.winner === null ? "draw" : view.end.winner === view.you ? "win" : "loss") : null;
  useEffect(() => {
    if (!endedAs || !view) return;
    const badges = recordConnDuel(view.code, endedAs);
    if (badges.length) setDuelBadges(badges);
    // Once per duel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endedAs, view?.code]);

  const me = view?.you ?? null;
  const mine = view?.mine;
  /** 4×4, or the 5×5 board the creator picked. */
  const size = sizeOf(view ?? undefined);
  const tilesKey = view?.tiles?.map((t) => t.id).join(",") ?? "";

  // The grid starts in the server's order; shuffling is yours alone.
  useEffect(() => {
    setOrder(tilesKey ? tilesKey.split(",").map(Number) : []);
    setSelected([]);
  }, [tilesKey]);

  const showToast = useCallback((text: string) => {
    window.clearTimeout(toastTimer.current);
    setToast((t) => ({ text, n: (t?.n ?? 0) + 1 }));
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // Each answer from the server: a group (bounce, then a bar), one away or a miss (shake). And the opponent's progress.
  useEffect(() => {
    if (!view || me === null) return;
    const h = heard.current;
    const results = mine?.results ?? [];
    if (h.results >= 0 && results.length > h.results) {
      const kind = results[results.length - 1];
      const last = mine!.guesses[mine!.guesses.length - 1];
      if (kind === "correct") {
        const group = mine!.found[mine!.found.length - 1];
        play("correct");
        setTileMotion({ kind: "jump", ids: last });
        setAnnounce(t("announce.correct", { label: group.label }));
        setSelected([]);
        window.setTimeout(() => setTileMotion(null), 650);
      } else {
        play("wrong");
        vibrate(60);
        setTileMotion({ kind: "shake", ids: last });
        if (kind === "one-away") showToast(t("toast.oneAway"));
        const left = size - (view.boards[me]?.mistakes ?? 0);
        setAnnounce(`${kind === "one-away" ? t("announce.oneAway") : t("announce.notGroup")}${t("announce.left", { left })}`);
        window.setTimeout(() => setTileMotion(null), 450);
      }
    }
    h.results = results.length;
    const theirs = view.boards[1 - me];
    if (theirs) {
      if (h.theirs >= 0 && theirs.found.length > h.theirs) {
        play("ping");
        setAnnounce(t("announce.theirs", { name: view.players[1 - me]?.name ?? t("Opponent"), found: theirs.found.length, size }));
      }
      h.theirs = theirs.found.length;
      h.theirMistakes = theirs.mistakes;
    }
    if (view.end && !h.end && sawPlay) play(view.end.winner === me ? "fanfare" : view.end.winner === null ? "streak" : "wrong");
    h.end = !!view.end;
  }, [view, me, mine, sawPlay, showToast, size, t]);

  const found = useMemo(() => new Set((mine?.found ?? []).flatMap((g) => g.members.map((m) => m.id))), [mine]);
  const tilesById = useMemo(() => new Map((view?.tiles ?? []).map((t) => [t.id, t])), [view?.tiles]);
  const remaining = order.filter((id) => !found.has(id)).map((id) => tilesById.get(id)).filter((t): t is ConnTile => Boolean(t));

  const myBoard = me !== null ? view?.boards[me] : undefined;
  const racing = !!view && view.status === "playing" && !!view.round && now >= view.round.startsAt && !!view.tiles;
  const canGuess = racing && !!myBoard && !myBoard.solved && !myBoard.out;

  function toggle(id: number) {
    if (!canGuess || busy) return;
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < size ? [...s, id] : s));
  }

  function shuffle() {
    setOrder((o) => {
      const rest = o.filter((id) => !found.has(id));
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      return [...o.filter((id) => found.has(id)), ...rest];
    });
  }

  async function submit() {
    if (!canGuess || busy || selected.length !== size) return;
    unlockAudio();
    if (mine?.guesses.some((g) => guessKey(g) === guessKey(selected))) {
      showToast(t("toast.repeat"));
      setAnnounce(t("announce.repeat"));
      return;
    }
    await act({ action: "group", pokemon: selected });
  }

  // Keyboard: arrows move between tiles, Enter submits four, Esc deselects.
  function onTileKey(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 }[e.key];
    if (move !== undefined) {
      e.preventDefault();
      tileRefs.current[Math.min(remaining.length - 1, Math.max(0, index + move))]?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selected.length === size) void submit();
      else toggle(remaining[index].id);
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selected.length && !(e.target as HTMLElement | null)?.closest("input, textarea")) setSelected([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.length]);

  async function leave() {
    if (await act({ action: "leave" })) router.push(HOME);
  }

  async function startRematch() {
    const next = await rematch();
    if (next) router.push(pvpHref("connections", next));
  }

  if (gone) return <DuelGone message={gone} href={HOME} label={t("back")} />;
  if (!view) return <DuelLoading />;

  const tag = seriesTag(view.series) ? t("tagSeries", { series: seriesTag(view.series) ?? "" }) : t("tag");
  const notice = (
    <>
      <MatchedNote view={view} />
      <DuelNotice error={error} offline={offline} />
      <EmoteFeed view={view} />
    </>
  );
  const tools = me !== null && (
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
          path={pvpHref("connections", view.code)}
          tag={tag}
          title={<>{t.rich("race", { r: (c) => <span className="text-primary">{c}</span> })}</>}
          invite={(host) => t(size === 5 ? "invite5" : "invite4", { host })}
          about={t(size === 5 ? "about5" : "about4")}
          shareText={t("inviteShare", { n: size * size, size })}
          rules={[
            { label: t("rules.race"), text: t(size === 5 ? "rules.race5" : "rules.race4") },
            {
              label: t("rules.mistakes"),
              text: t("rules.mistakesText", { s: PENALTY_S, size }),
            },
            {
              label: t("rules.winning"),
              text: t("rules.winningText", { min: CONN_DUEL_MS / 60_000 }),
            },
          ]}
          home={HOME}
          chat={chat}
          busy={busy}
          onJoin={join}
          onReady={(ready) => void act({ action: "ready", ready })}
          onLeave={() => void leave()}
        />
      </>
    );
  }

  if (me === null) {
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
            : t("visitor.underway", { list: view.players.map((p, k) => t("visitor.player", { name: p.name, status: boardStatus(view.boards[k], size, t) })).join(", ") })
        }
        home={HOME}
        label={t("visitor.startOwn")}
      />
    );
  }

  const them = view.players[1 - me]?.name ?? t("opponent");

  if (view.status === "finished") {
    return (
      <MotionConfig reducedMotion="user">
        {notice}
        <DuelSummary view={view} busy={busy} symbols={symbols} onRematch={() => void startRematch()} />
        <div className="mx-auto mt-4 max-w-3xl text-center">
          <NewBadges badges={duelBadges} />
        </div>
        <div className="mx-auto mt-4 max-w-3xl space-y-4">
          <AddFriendAfterGame kind="connections" code={view.code} />
          {tools}
          {chat}
        </div>
        {view.reveal && (
          <div className="mx-auto mt-8 max-w-3xl">
            <WhyPanel groups={view.reveal} symbols={symbols} />
          </div>
        )}
      </MotionConfig>
    );
  }

  const leaveButton = <LeaveButton busy={busy} onLeave={() => void leave()} />;

  // ---- lead-in ---------------------------------------------------------------------
  if (!racing) {
    const startsAt = view.round?.startsAt ?? now;
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {notice}
        <RaceHud view={view} now={now} symbols={symbols} />
        <Card>
          <CardContent className="space-y-3 p-10 text-center">
            <p className="hud-label text-screen">{t("ready")}</p>
            <motion.p key={seconds(startsAt - now)} initial={{ scale: 1.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="font-display text-7xl font-bold tabular-nums">
              {Math.max(1, seconds(startsAt - now))}
            </motion.p>
            <p className="text-sm text-muted-foreground">
              {t(size === 5 ? "lead5" : "lead4", { s: PENALTY_S })}
            </p>
          </CardContent>
        </Card>
        {tools}
        {leaveButton}
      </div>
    );
  }

  // ---- the race --------------------------------------------------------------------
  const done = myBoard?.solved || myBoard?.out;
  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto max-w-3xl space-y-4" data-testid="conn-duel">
        {notice}
        <RaceHud view={view} now={now} symbols={symbols} />
        <div className="relative">
          <AnimatePresence>
            {toast && (
              <motion.div
                key={toast.n}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute inset-x-0 top-[40%] z-20 flex justify-center"
                role="status"
                aria-live="assertive"
                data-testid="conn-toast"
              >
                <span className="rounded-md bg-foreground px-5 py-2.5 font-display text-base font-bold uppercase tracking-wider text-background shadow-[0_10px_30px_rgb(0_0_0/0.45)]">{toast.text}</span>
              </motion.div>
            )}
          </AnimatePresence>
          <LayoutGroup>
            <div className="space-y-2 sm:space-y-2.5">
              {(mine?.found ?? []).map((g) => (
                <GroupBar key={g.level} group={g} symbols={symbols} compact={size === 5} />
              ))}
              {remaining.length > 0 && (
                <div className={cn("grid gap-2 sm:gap-2.5", size === 5 ? "grid-cols-5" : "grid-cols-4")} data-testid="conn-grid" data-size={size} aria-label={t("grid")}>
                  {remaining.map((t, i) => (
                    <GridTile
                      key={t.id}
                      ref={(el) => {
                        tileRefs.current[i] = el;
                      }}
                      tile={t}
                      index={i}
                      selected={selected.includes(t.id)}
                      disabled={!canGuess}
                      motionKind={tileMotion?.ids.includes(t.id) ? tileMotion.kind : null}
                      order={tileMotion ? tileMotion.ids.indexOf(t.id) : 0}
                      onToggle={() => toggle(t.id)}
                      onKeyDown={(e) => onTileKey(e, i)}
                      compact={size === 5}
                    />
                  ))}
                </div>
              )}
            </div>
          </LayoutGroup>
        </div>
        <div className="sr-only" aria-live="polite" role="status">
          {announce}
        </div>

        {done ? (
          <Card className={cn(myBoard?.solved ? "border-success/50" : "border-destructive/40")} data-testid="conn-duel-waiting">
            <CardContent className="space-y-1 p-5 text-center">
              <p className="font-display text-2xl font-bold uppercase">{myBoard?.solved ? t(size === 5 ? "allFound5" : "allFound4") : t("outOfMistakes")}</p>
              <p className="text-sm text-muted-foreground">
                {myBoard?.solved
                  ? myBoard.mistakes
                    ? t("yourTimeScore", { time: timeText(myBoard), score: clock(myBoard.score ?? 0) })
                    : t("yourTime", { time: timeText(myBoard) })
                  : t("youFound", { found: myBoard?.found.length ?? 0, size })}{" "}
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {t("waiting", { name: them })}
                </span>
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className={cn("space-y-4", CONTROLS_WRAP)}>
            <MistakeDots left={size - (myBoard?.mistakes ?? 0)} max={size} />
            <div className={cn("flex flex-wrap items-center justify-center gap-2.5", CONTROLS_DOCK)} data-testid="conn-controls">
              <Button variant="outline" onClick={shuffle} className="max-sm:px-3 sm:min-w-28">
                <Shuffle className="h-4 w-4" aria-hidden /> {t("shuffle")}
              </Button>
              <Button variant="outline" onClick={() => (setSelected([]), setError(null))} disabled={selected.length === 0} className="max-sm:px-3 sm:min-w-28">
                {t.rich("deselect", { s: (c) => <span className="max-sm:hidden">{c}</span> })}
              </Button>
              <Button onClick={() => void submit()} disabled={busy || selected.length !== size} className="max-sm:min-w-[5.25rem] sm:min-w-28" data-testid="conn-submit">
                {t("submit")}
              </Button>
            </div>
          </div>
        )}
        {tools}
        {leaveButton}
      </div>
    </MotionConfig>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** Both trainers facing each other, with the race clock in the middle. */
function RaceHud({ view, now, symbols }: { view: ConnDuelView; now: number; symbols: boolean }) {
  const t = useT(duelNs);
  const elapsed = view.round ? Math.max(0, now - view.round.startsAt) : 0;
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-md border bg-card/90 px-3 py-2.5 backdrop-blur sm:gap-4 sm:px-4" data-testid="conn-race-hud">
      <Racer view={view} seat={0} symbols={symbols} />
      <div className="space-y-0.5 text-center">
        {view.status === "finished" ? (
          <div className="hud-label">{t("final")}</div>
        ) : (
          <>
            <div className="flex items-center justify-center gap-1 font-pixel text-sm tabular-nums" role="timer" aria-label={t("raceTime")}>
              <Timer className="h-3.5 w-3.5" aria-hidden /> {clock(elapsed)}
            </div>
            <div className="hud-label hidden sm:block">{t("penalty", { s: PENALTY_S })}</div>
          </>
        )}
      </div>
      <Racer view={view} seat={1} symbols={symbols} right />
    </div>
  );
}

/** One trainer: name, the colours of the groups they've found, and their mistakes. Never which Pokémon. */
function Racer({ view, seat, symbols, right }: { view: ConnDuelView; seat: number; symbols: boolean; right?: boolean }) {
  const t = useT(duelNs);
  const tb = useT(board);
  const player = view.players[seat];
  const b = view.boards[seat];
  const size = sizeOf(view);
  const name = player?.name ?? "—";
  const label = b
    ? t("racer.board", {
        name,
        found: b.found.length,
        size,
        levels: b.found.length ? t("racer.levels", { list: b.found.map((l) => levelName(tb, l)).join(tb("sep")) }) : "",
        mistakes: b.mistakes,
        state: b.solved ? t("racer.solved") : b.out ? t("racer.out") : "",
      })
    : t("racer.ready", { name });
  return (
    <div className={cn("min-w-0 space-y-1", right && "text-right")} aria-label={label} data-testid={`conn-racer-${seat}`}>
      <div className={cn("flex items-center gap-1.5", right && "flex-row-reverse")}>
        <SeatDot seat={seat} />
        {player && <Avatar avatar={player.avatar} size={22} />}
        <span className="truncate font-display text-sm font-bold uppercase sm:text-base">{player?.name ?? "—"}</span>
        {view.you === seat && <span className="hud-label">{t("you")}</span>}
        {player?.quiet && view.status === "playing" && <WifiOff className="h-3.5 w-3.5 shrink-0 text-warning" aria-label={t("connectionLost")} />}
      </div>
      <div className={cn("flex items-center gap-1", right && "flex-row-reverse")} aria-hidden>
        {Array.from({ length: size }, (_, i) => {
          const level = b?.found[i];
          return level === undefined ? (
            <span key={i} className="h-5 w-5 rounded-[4px] border border-dashed border-foreground/25 sm:h-6 sm:w-6" />
          ) : (
            <motion.span
              key={i}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex h-5 w-5 items-center justify-center rounded-[4px] text-[10px] sm:h-6 sm:w-6"
              style={levelStyle(level)}
            >
              {symbols && <LevelMark level={level} className="opacity-60" />}
            </motion.span>
          );
        })}
      </div>
      <div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", right && "flex-row-reverse")}>
        <span className="flex gap-0.5" aria-hidden>
          {Array.from({ length: size }, (_, i) => (
            <span key={i} className={cn("h-2 w-2 rounded-full", i < (b?.mistakes ?? 0) ? "bg-destructive" : "bg-foreground/20")} />
          ))}
        </span>
        <span className={cn(b?.solved && "font-semibold text-success", b?.out && "font-semibold text-destructive")}>
          {b?.solved ? t("solvedTime", { time: clock(b.score ?? 0) }) : b?.out ? t("out") : t("mistakes", { n: b?.mistakes ?? 0 })}
        </span>
      </div>
    </div>
  );
}

/** Why the duel ended the way it did, in a sentence. */
function reasonText(view: ConnDuelView, me: number, t: DuelT): string {
  const end = view.end!;
  const them = view.players[1 - me]?.name ?? t("Opponent");
  const won = end.winner === me;
  if (end.reason === "left") return won ? t("reason.theyLeft", { name: them }) : t("reason.youLeft");
  const [mine, theirs] = [view.boards[me], view.boards[1 - me]];
  if (!mine || !theirs) return "";
  if (end.winner === null) return mine.solved ? t("reason.deadHeat", { time: clock(mine.score ?? 0) }) : t("reason.level", { found: mine.found.length, mistakes: mine.mistakes });
  const [w, l] = won ? [mine, theirs] : [theirs, mine];
  const size = String(sizeOf(view));
  if (w.solved && l.solved) return won ? t("reason.bothYou", { a: clock(w.score ?? 0), b: clock(l.score ?? 0) }) : t("reason.bothThem", { name: them, a: clock(w.score ?? 0), b: clock(l.score ?? 0) });
  if (w.solved) return won ? t(l.out ? "reason.firstYouOut" : "reason.firstYou", { size, name: them }) : t(l.out ? "reason.firstThemOut" : "reason.firstThem", { size, name: them });
  if (w.found.length !== l.found.length) return won ? t("reason.moreYou", { a: w.found.length, b: l.found.length }) : t("reason.moreThem", { name: them, a: w.found.length, b: l.found.length });
  return won || them.toLowerCase() === "you" ? t("reason.fewerYou") : t("reason.fewerThem", { name: them });
}

/** The result, both races, and what's next. */
function DuelSummary({ view, busy, symbols, onRematch }: { view: ConnDuelView; busy: boolean; symbols: boolean; onRematch: () => void }) {
  const t = useT(duelNs);
  const ts = useT(share);
  const me = view.you!;
  const end = view.end!;
  const won = end.winner === me;
  const draw = end.winner === null;
  const them = view.players[1 - me]?.name ?? t("opponent");

  function shareText(): string {
    const rows = view.rows?.[me] ?? [];
    const board = view.boards[me];
    const score = board?.solved ? `⏱${clock(board.score ?? 0)}` : `${board?.found.length ?? 0}/${sizeOf(view)}`;
    return [
      t(draw ? "share.drew" : won ? "share.beat" : "share.lost", { name: them, score }),
      ...rows.map((r) => r.map((l) => CONN_SQUARES[l]).join("")),
      `${window.location.origin}${localizePath(HOME, ts.locale)}`,
    ].join("\n");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="conn-duel-result">
      <div className="space-y-2 text-center">
        <p className="hud-label text-screen">{t("over")}</p>
        <div className={cn("flex items-center justify-center gap-3 font-display text-6xl font-bold uppercase", won ? "text-success" : draw ? "text-screen" : "text-destructive")}>
          {won && <Crown className="h-12 w-12" aria-hidden />}
          {draw ? t("draw") : won ? t("victory") : t("defeat")}
        </div>
        <p className="text-muted-foreground">{reasonText(view, me, t)}</p>
      </div>

      <RaceHud view={view} now={view.now} symbols={symbols} />

      <Card>
        <CardContent className="space-y-5 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {view.players.map((p, seat) => {
              const b = view.boards[seat];
              return (
                <div key={seat} className={cn("space-y-3 rounded-md border bg-shade/20 p-4 text-center", end.winner === seat && "border-success/60")}>
                  <p className="hud-label flex items-center justify-center gap-1.5">
                    <SeatDot seat={seat} /> {p.name}
                    {seat === me && t("youSuffix")}
                  </p>
                  <p className={cn("flex items-center justify-center gap-1.5 font-display text-2xl font-bold tabular-nums", b?.solved ? "text-success" : "text-muted-foreground")}>
                    {b?.solved ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <XCircle className="h-5 w-5" aria-hidden />}
                    {b?.solved ? clock(b.score ?? 0) : `${b?.found.length ?? 0}/${sizeOf(view)}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("line", {
                      how: b?.solved ? (b.mistakes ? t("timePenalty", { time: timeText(b), n: b.mistakes, s: PENALTY_S }) : t("clean", { time: timeText(b) })) : b?.out ? t("outOfMistakes") : t("didntFinish"),
                      mistakes: t("mistakes", { n: b?.mistakes ?? 0 }),
                    })}
                  </p>
                  {view.rows?.[seat]?.length ? <GuessHistory rows={view.rows[seat]} symbols={symbols} /> : <p className="text-xs text-muted-foreground">{t("noGuesses")}</p>}
                </div>
              );
            })}
          </div>
          {view.series && <SeriesScore series={view.series} players={view.players} you={me} />}
          {view.rematch && (
            <p role="status" className="text-center font-display text-sm font-semibold uppercase tracking-wider text-warning">
              {t("rematchRequested")}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <Button size="lg" variant="success" disabled={busy} onClick={onRematch}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
              {view.rematch ? t("acceptRematch") : t("rematch")}
            </Button>
            <ShareButton getText={shareText} label={t("shareButton")} kind="connections" size="lg" />
            <Link href={HOME} className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
              <Swords className="h-4 w-4" aria-hidden /> PokéConnections
            </Link>
          </div>
          <p className="text-center text-xs text-muted-foreground">{t(view.size === 5 ? "rematchNote5" : "rematchNote4")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
