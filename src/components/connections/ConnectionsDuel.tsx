"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "framer-motion";
import { CheckCircle2, Crown, Loader2, RotateCcw, Shuffle, Swords, Timer, WifiOff, XCircle } from "lucide-react";
import { CONN_DUEL_MS, CONN_DUEL_PENALTY_MS, pvpHref, type ConnDuelBoard, type ConnDuelView } from "@/lib/pvp-types";
import { CONN_LEVELS, guessKey, type ConnSize, type ConnTile } from "@/lib/connections/types";
import { CONN_SQUARES } from "@/lib/share";
import { useConnPrefs } from "@/lib/connections/local";
import { recordConnDuel, type BadgeDef } from "@/lib/progress";
import { NewBadges } from "./results";
import { play, unlockAudio, vibrate } from "@/lib/sound";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConnRankedOutcome } from "./ConnectionsRanked";
import { useDuel } from "@/components/duel/use-duel";
import { DuelGone, DuelLoading, DuelLobby, DuelNotice, DuelVisitor, LeaveButton, MatchedNote, SeatDot, clock, seconds } from "@/components/duel/DuelParts";
import { DuelChat, DuelTools, EmoteFeed } from "@/components/duel/DuelReactions";
import { SeriesScore, seriesTag } from "@/components/duel/DuelSeries";
import { AddFriendAfterGame } from "@/components/community/AddFriend";
import { Avatar } from "@/components/avatar/Avatar";
import { ShareButton } from "@/components/share/ShareButton";
import { GridTile, GroupBar, GuessHistory, LevelMark, MistakeDots, WhyPanel, levelStyle, type TileMotion } from "./parts";
import { cn } from "@/lib/utils";

/**
 * A PokéConnections duel at /connections/duel/<code>: the lobby, the race
 * and the result. The server runs the race and checks every guess; this
 * polls it (every second while racing) and sends the trainer's groups. You
 * see your opponent's progress as colours and counts only; the groups'
 * names and Pokémon reach you as you find them, and all four (with the
 * "Why?" panel) once the duel is over.
 */

const PENALTY_S = CONN_DUEL_PENALTY_MS / 1000;
const TOAST_MS = 1600;
const HOME = "/connections";

/** "1:23", or "1:23 + 0:30" with penalties. */
function timeText(b: ConnDuelBoard): string {
  if (b.ms === undefined) return "–";
  const penalty = b.mistakes * CONN_DUEL_PENALTY_MS;
  return penalty ? `${clock(b.ms)} + ${clock(penalty)}` : clock(b.ms);
}

const sizeOf = (view: Pick<ConnDuelView, "size"> | undefined): ConnSize => (view?.size === 5 ? 5 : 4);
const WORDS = { 4: "four", 5: "five" } as const;
const SQUARES = { 4: "sixteen", 5: "twenty-five" } as const;

/** "Solved in 1:53", "Out · 2/4 groups", "1/4 groups". */
function boardStatus(b: ConnDuelBoard | undefined, size: ConnSize): string {
  if (!b) return "";
  if (b.solved) return `Solved · ${clock(b.score ?? 0)}`;
  return `${b.out ? "Out · " : ""}${b.found.length}/${size} groups`;
}

export function ConnectionsDuel({ code }: { code: string }) {
  const router = useRouter();
  const prefs = useConnPrefs();
  const symbols = prefs?.symbols ?? true;
  const { view, now, gone, offline, error, setError, busy, sawPlay, act, send, join, rematch } = useDuel<ConnDuelView>(`/api/duel/${code}`, code);
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
        setAnnounce(`Correct: ${group.label}.`);
        setSelected([]);
        window.setTimeout(() => setTileMotion(null), 650);
      } else {
        play("wrong");
        vibrate(60);
        setTileMotion({ kind: "shake", ids: last });
        if (kind === "one-away") showToast("One away…");
        const left = size - (view.boards[me]?.mistakes ?? 0);
        setAnnounce(`${kind === "one-away" ? "One away. " : "Not a group. "}${left} mistake${left === 1 ? "" : "s"} left.`);
        window.setTimeout(() => setTileMotion(null), 450);
      }
    }
    h.results = results.length;
    const theirs = view.boards[1 - me];
    if (theirs) {
      if (h.theirs >= 0 && theirs.found.length > h.theirs) {
        play("ping");
        setAnnounce(`${view.players[1 - me]?.name ?? "Your opponent"} found a group (${theirs.found.length} of ${size}).`);
      }
      h.theirs = theirs.found.length;
      h.theirMistakes = theirs.mistakes;
    }
    if (view.end && !h.end && sawPlay) play(view.end.winner === me ? "fanfare" : view.end.winner === null ? "streak" : "wrong");
    h.end = !!view.end;
  }, [view, me, mine, sawPlay, showToast, size]);

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
      showToast("Already guessed!");
      setAnnounce("Already guessed. That doesn't cost a mistake.");
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

  if (gone) return <DuelGone message={gone} href={HOME} label="Back to PokéConnections" />;
  if (!view) return <DuelLoading />;

  const tag = `PokéConnections duel${seriesTag(view.series) ? ` · ${seriesTag(view.series)}` : ""}`;
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
  const chat = <DuelChat view={view} game="PokéConnections duel" onSend={(text) => send({ action: "chat", text })} />;

  if (view.status === "lobby") {
    return (
      <>
        {notice}
        <DuelLobby
          view={view}
          path={pvpHref("connections", view.code)}
          tag={tag}
          title={
            <>
              PokéConnections <span className="text-primary">Race</span>
            </>
          }
          invite={(host) => `${host} challenges you${size === 5 ? " to a 5×5 board" : ""}! The same ${SQUARES[size]} Pokémon for both of you: the first to find all ${WORDS[size]} groups wins.`}
          about={`The same ${SQUARES[size]} Pokémon for both of you${size === 5 ? " (a 5×5 board)" : ""}. Find the ${WORDS[size]} groups of ${WORDS[size]} before your opponent does.`}
          shareText={`Race me at PokéConnections! Same ${size * size} Pokémon, first to find the ${size} groups wins.`}
          rules={[
            { label: "The race", text: `The same ${SQUARES[size]} Pokémon and ${WORDS[size]} hidden groups for both of you${size === 5 ? " (a 5×5 board)" : ""}. The first to find all ${WORDS[size]} wins.` },
            {
              label: "Mistakes",
              text: `Each mistake adds ${PENALTY_S} seconds to your time, so a quick but sloppy solve can still lose. ${size} mistakes and you're out.`,
            },
            {
              label: "Winning",
              text: `The lower time (penalties included) wins. If you're both out, or ${CONN_DUEL_MS / 60_000} minutes pass, more groups found wins, then fewer mistakes. You see your opponent's groups as colours only.`,
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
              ? "It ended in a draw."
              : `${view.players[winner]?.name} won.`
            : `Under way: ${view.players.map((p, k) => `${p.name} ${boardStatus(view.boards[k], size)}`).join(", ")}.`
        }
        home={HOME}
        label="Start your own race"
      />
    );
  }

  const them = view.players[1 - me]?.name ?? "your opponent";

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
            <p className="hud-label text-screen">Get ready</p>
            <motion.p key={seconds(startsAt - now)} initial={{ scale: 1.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="font-display text-7xl font-bold tabular-nums">
              {Math.max(1, seconds(startsAt - now))}
            </motion.p>
            <p className="text-sm text-muted-foreground">
              {SQUARES[size][0].toUpperCase() + SQUARES[size].slice(1)} Pokémon, {WORDS[size]} groups. Each mistake costs {PENALTY_S} seconds.
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
                <div className={cn("grid gap-2 sm:gap-2.5", size === 5 ? "grid-cols-5" : "grid-cols-4")} data-testid="conn-grid" data-size={size} aria-label="Pokémon to group">
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
              <p className="font-display text-2xl font-bold uppercase">{myBoard?.solved ? `All ${WORDS[size]} found!` : "Out of mistakes"}</p>
              <p className="text-sm text-muted-foreground">
                {myBoard?.solved
                  ? `Your time: ${timeText(myBoard)}${myBoard.mistakes ? ` = ${clock(myBoard.score ?? 0)}` : ""}.`
                  : `You found ${myBoard?.found.length ?? 0} of ${size} groups.`}{" "}
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Waiting for {them}…
                </span>
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <MistakeDots left={size - (myBoard?.mistakes ?? 0)} max={size} />
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <Button variant="outline" onClick={shuffle} className="rounded-full sm:min-w-28">
                <Shuffle className="h-4 w-4" aria-hidden /> Shuffle
              </Button>
              <Button variant="outline" onClick={() => (setSelected([]), setError(null))} disabled={selected.length === 0} className="rounded-full sm:min-w-28">
                Deselect all
              </Button>
              <Button onClick={() => void submit()} disabled={busy || selected.length !== size} className="rounded-full sm:min-w-28" data-testid="conn-submit">
                Submit
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
  const elapsed = view.round ? Math.max(0, now - view.round.startsAt) : 0;
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-md border bg-card/90 px-3 py-2.5 backdrop-blur sm:gap-4 sm:px-4" data-testid="conn-race-hud">
      <Racer view={view} seat={0} symbols={symbols} />
      <div className="space-y-0.5 text-center">
        {view.status === "finished" ? (
          <div className="hud-label">Final</div>
        ) : (
          <>
            <div className="flex items-center justify-center gap-1 font-pixel text-sm tabular-nums" role="timer" aria-label="Race time">
              <Timer className="h-3.5 w-3.5" aria-hidden /> {clock(elapsed)}
            </div>
            <div className="hud-label hidden sm:block">+{PENALTY_S}s a mistake</div>
          </>
        )}
      </div>
      <Racer view={view} seat={1} symbols={symbols} right />
    </div>
  );
}

/** One trainer: name, the colours of the groups they've found, and their mistakes. Never which Pokémon. */
function Racer({ view, seat, symbols, right }: { view: ConnDuelView; seat: number; symbols: boolean; right?: boolean }) {
  const player = view.players[seat];
  const board = view.boards[seat];
  const size = sizeOf(view);
  const label = `${player?.name ?? "—"}: ${board ? `${board.found.length} of ${size} groups found${board.found.length ? ` (${board.found.map((l) => CONN_LEVELS[l].name).join(", ")})` : ""}, ${board.mistakes} of ${size} mistakes${board.solved ? ", solved" : board.out ? ", out" : ""}` : "ready"}`;
  return (
    <div className={cn("min-w-0 space-y-1", right && "text-right")} aria-label={label} data-testid={`conn-racer-${seat}`}>
      <div className={cn("flex items-center gap-1.5", right && "flex-row-reverse")}>
        <SeatDot seat={seat} />
        {player && <Avatar avatar={player.avatar} size={22} />}
        <span className="truncate font-display text-sm font-bold uppercase sm:text-base">{player?.name ?? "—"}</span>
        {view.you === seat && <span className="hud-label">You</span>}
        {player?.quiet && view.status === "playing" && <WifiOff className="h-3.5 w-3.5 shrink-0 text-warning" aria-label="Connection lost" />}
      </div>
      <div className={cn("flex items-center gap-1", right && "flex-row-reverse")} aria-hidden>
        {Array.from({ length: size }, (_, i) => {
          const level = board?.found[i];
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
            <span key={i} className={cn("h-2 w-2 rounded-full", i < (board?.mistakes ?? 0) ? "bg-destructive" : "bg-foreground/20")} />
          ))}
        </span>
        <span className={cn(board?.solved && "font-semibold text-success", board?.out && "font-semibold text-destructive")}>
          {board?.solved ? `Solved ${clock(board.score ?? 0)}` : board?.out ? "Out" : `${board?.mistakes ?? 0} mistake${board?.mistakes === 1 ? "" : "s"}`}
        </span>
      </div>
    </div>
  );
}

/** Why the duel ended the way it did, in a sentence. */
function reasonText(view: ConnDuelView, me: number): string {
  const end = view.end!;
  const them = view.players[1 - me]?.name ?? "Your opponent";
  const won = end.winner === me;
  if (end.reason === "left") return won ? `${them} left the duel.` : "You left the duel.";
  const [mine, theirs] = [view.boards[me], view.boards[1 - me]];
  if (!mine || !theirs) return "";
  if (end.winner === null) return mine.solved ? `Dead heat: ${clock(mine.score ?? 0)} each.` : `Level: ${mine.found.length} groups and ${mine.mistakes} mistakes each.`;
  const [w, l] = won ? [mine, theirs] : [theirs, mine];
  const who = won ? "You" : them;
  if (w.solved && l.solved) return `${who} solved it in ${clock(w.score ?? 0)} to ${clock(l.score ?? 0)}, penalties included.`;
  if (w.solved) return `${who} found all ${WORDS[sizeOf(view)]} groups first${l.out ? `; ${won ? them : "you"} ran out of mistakes` : ""}.`;
  if (w.found.length !== l.found.length) return `Nobody solved it: ${who} found more groups, ${w.found.length} to ${l.found.length}.`;
  return `Nobody solved it, and ${who.toLowerCase() === "you" ? "you" : who} made fewer mistakes.`;
}

/** The result, both races, and what's next. */
function DuelSummary({ view, busy, symbols, onRematch }: { view: ConnDuelView; busy: boolean; symbols: boolean; onRematch: () => void }) {
  const me = view.you!;
  const end = view.end!;
  const won = end.winner === me;
  const draw = end.winner === null;
  const them = view.players[1 - me]?.name ?? "your opponent";

  function shareText(): string {
    const rows = view.rows?.[me] ?? [];
    const board = view.boards[me];
    const headline = draw ? `drew with ${them}` : won ? `beat ${them}` : `lost to ${them}`;
    return [
      `PokéIQ PokéConnections duel: I ${headline}! ${board?.solved ? `⏱${clock(board.score ?? 0)}` : `${board?.found.length ?? 0}/${sizeOf(view)}`}`,
      ...rows.map((r) => r.map((l) => CONN_SQUARES[l]).join("")),
      `${window.location.origin}${HOME}`,
    ].join("\n");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="conn-duel-result">
      <div className="space-y-2 text-center">
        <p className="hud-label text-screen">Duel over · PokéConnections</p>
        <div className={cn("flex items-center justify-center gap-3 font-display text-6xl font-bold uppercase", won ? "text-success" : draw ? "text-screen" : "text-destructive")}>
          {won && <Crown className="h-12 w-12" aria-hidden />}
          {draw ? "Draw" : won ? "Victory!" : "Defeat"}
        </div>
        <p className="text-muted-foreground">{reasonText(view, me)}</p>
      </div>

      {view.ranked && <ConnRankedOutcome view={view} />}

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
                    {seat === me && " · You"}
                  </p>
                  <p className={cn("flex items-center justify-center gap-1.5 font-display text-2xl font-bold tabular-nums", b?.solved ? "text-success" : "text-muted-foreground")}>
                    {b?.solved ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <XCircle className="h-5 w-5" aria-hidden />}
                    {b?.solved ? clock(b.score ?? 0) : `${b?.found.length ?? 0}/${sizeOf(view)}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {b?.solved ? (b.mistakes ? `Time ${timeText(b)} penalty (${b.mistakes} × ${PENALTY_S}s)` : `Clean solve in ${timeText(b)}`) : b?.out ? "Out of mistakes" : "Didn't finish"} ·{" "}
                    {b?.mistakes ?? 0} mistake{b?.mistakes === 1 ? "" : "s"}
                  </p>
                  {view.rows?.[seat]?.length ? <GuessHistory rows={view.rows[seat]} symbols={symbols} /> : <p className="text-xs text-muted-foreground">No guesses</p>}
                </div>
              );
            })}
          </div>
          {view.series && <SeriesScore series={view.series} players={view.players} you={me} />}
          {view.rematch && (
            <p role="status" className="text-center font-display text-sm font-semibold uppercase tracking-wider text-warning">
              Rematch requested!
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <Button size="lg" variant="success" disabled={busy} onClick={onRematch}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
              {view.rematch ? "Accept rematch" : "Rematch"}
            </Button>
            <ShareButton getText={shareText} label="Share" kind="connections" size="lg" />
            <Link href={HOME} className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
              <Swords className="h-4 w-4" aria-hidden /> PokéConnections
            </Link>
          </div>
          <p className="text-center text-xs text-muted-foreground">A rematch keeps the trainers, with {SQUARES[sizeOf(view)]} new Pokémon{view.size === 5 ? " (still 5×5)" : ""}. It starts when you both press it.</p>
        </CardContent>
      </Card>
    </div>
  );
}
