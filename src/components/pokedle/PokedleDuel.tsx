"use client";

/* eslint-disable @next/next/no-img-element -- sprites, artwork and the server-rendered silhouette */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Crown, Eye, Filter, Flame, Lightbulb, Loader2, RotateCcw, Swords, Tag, Timer, Trophy, UserSearch, Volume2, VolumeX, WifiOff } from "lucide-react";
import { DLE_COLUMNS, DLE_MAX_GUESSES, type CellStatus, type DleRow } from "@/lib/dle-types";
import {
  DLE_DUEL_HINT_COST,
  DLE_DUEL_IDLE_ROUNDS,
  DLE_DUEL_ROUND_MS,
  DLE_DUEL_SPEED_BONUS,
  dleDuelBase,
  pvpHref,
  DUEL_EMOTES,
  EMOTE_GAP_MS,
  EMOTE_SHOW_MS,
  EMOTE_TEXT,
  type DuelEmote,
  type DleDuelBoard,
  type DleDuelHint,
  type DleDuelRoundResult,
  type DleDuelScore,
  type DleDuelView,
} from "@/lib/pvp-types";
import { unlockAudio } from "@/lib/sound";
import { setDuelSfx, sfx, useDuelSfx } from "@/lib/duel-sfx";
import { useRanked } from "@/lib/ranked-client";
import { RANKED_MATCH, RatingChange, Searching, TierBadge, rankedExtra } from "./Ranked";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useDuel } from "@/components/duel/use-duel";
import { useMatchmaking } from "@/components/duel/use-matchmaking";
import { SeriesScore, seriesTag } from "@/components/duel/DuelSeries";
import { DuelGone, DuelLoading, DuelLobby, DuelNotice, DuelVisitor, LeaveButton, MatchedNote, SeatDot, clock, seconds } from "@/components/duel/DuelParts";
import { Board, CELL_STYLES, CellGlyph, GuessInput, STATUS_TEXT, spriteUrl, type NameEntry } from "./parts";
import { DexPanel } from "./DexPanel";
import { dexClues } from "@/lib/dle-dex";
import { useApplyDlePrefs } from "@/lib/dle-local";
import { cn } from "@/lib/utils";

/**
 * A Pokédle duel at /pokedle/duel/<code>: the lobby, three rounds with their
 * reveals, and the result. The server runs the duel; this polls it (every
 * second in play) and sends the trainer's guesses and hint buys. Your own
 * guesses come back with full clues; the opponent's only as colours, until
 * the round is over.
 */

const HOME = "/pokedle";
const GENS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
/** What "Find new opponent" searches for: the same queue as on /pokedle. */
const MATCH = { game: "pokedle" };
/** The last stretch of a round: the clock gets loud. */
const FINAL_MS = 10_000;
/** A guess that leaves this few Pokémon possible is close. */
const CLOSE_LEFT = 5;
const HINT_INFO: Record<DleDuelHint, { label: string; icon: typeof Tag }> = {
  genus: { label: "Category", icon: Tag },
  silhouette: { label: "Silhouette", icon: Eye },
};

const fmt = (n: number) => n.toLocaleString("en-US");
const gensText = (gens?: number[]) => (gens?.length ? gens.map((g) => `Gen ${g}`).join(", ") : "All generations");

/** The first value seen for `key`. Media URLs are re-signed on every poll, and the image shouldn't reload each time. */
function useFirst<T>(key: number | undefined, value: T | undefined): T | undefined {
  const [kept, setKept] = useState({ key, value });
  if (kept.key !== key || (kept.value === undefined && value !== undefined)) {
    setKept({ key, value });
    return value;
  }
  return kept.value;
}

/** How many Pokémon still fit a board's clues: after its last guess, or the whole pool before one. */
const leftOf = (board: Pick<DleDuelBoard, "possible">, pool: number) => board.possible.at(-1) ?? pool;
const possibleText = (n: number) => `${fmt(n)} Pokémon still possible`;

const progressText = (board: DleDuelBoard) =>
  board.solved ? `Solved in ${board.colours.length}` : board.done ? "Out of guesses" : `${board.colours.length}/${DLE_MAX_GUESSES} guesses`;

export function PokedleDuel({ code, names }: { code: string; names: NameEntry[] }) {
  const router = useRouter();
  const { view, now, gone, offline, error, busy, sawPlay, act, send, join, rematch } = useDuel<DleDuelView>(`/api/duel/${code}`, code);
  const [summary, setSummary] = useState(false);
  /** A Pokémon clicked in the Pokédex beside the board, for the guess box. */
  const [fill, setFill] = useState<{ name: string; n: number } | null>(null);
  useApplyDlePrefs();
  const heard = useRef({ revealed: -1, theirSolve: false, end: false, mine: -1, theirs: -1, round: -1, tick: -1 });

  // Each new screen (lobby, a round, a reveal, the result) starts at the top.
  const screen = !view ? "" : view.status === "lobby" ? "lobby" : view.round ? `round ${view.round.index}` : `reveal ${view.revealed.length} ${summary}`;
  useEffect(() => {
    if (screen) window.scrollTo({ top: 0, behavior: "smooth" });
  }, [screen]);

  // Sounds (when turned on): your guesses, the opponent solving, and each round's result.
  useEffect(() => {
    if (!view || view.you === null) return;
    const h = heard.current;
    const live = view.round;
    const myBoard = live?.boards[view.you];
    const theirBoard = live?.boards[1 - view.you];
    const theirSolve = !!theirBoard?.solved;
    if (live && myBoard && theirBoard) {
      if (h.round === live.index && myBoard.colours.length > h.mine) {
        sfx(myBoard.solved ? "correct" : (myBoard.possible.at(-1) ?? Infinity) <= CLOSE_LEFT ? "close" : "click");
      }
      // The rival's guesses ping; their solve too (below).
      if (h.round === live.index && theirBoard.colours.length > h.theirs && !theirSolve) sfx("ping");
      h.round = live.index;
      h.mine = myBoard.colours.length;
      h.theirs = theirBoard.colours.length;
    }
    if (theirSolve && !h.theirSolve) sfx("ping");
    h.theirSolve = theirSolve;
    if (h.revealed >= 0 && view.revealed.length > h.revealed) {
      const { scores } = view.revealed[view.revealed.length - 1];
      const [mine, theirs] = [scores[view.you].points, scores[1 - view.you].points];
      sfx(mine > theirs ? "correct" : mine === theirs ? "streak" : "wrong");
    }
    h.revealed = view.revealed.length;
    // A forfeit skips the last reveal, so its result sounds straight away.
    if (view.end?.reason === "left" && !h.end && sawPlay && view.end.winner === view.you) sfx("fanfare");
    h.end = !!view.end;
  }, [view, sawPlay]);

  // The last ten seconds tick, while you're still guessing.
  const finalSecond = view?.round && view.you !== null && !view.round.boards[view.you].done ? Math.ceil((view.round.endsAt - now) / 1000) : -1;
  useEffect(() => {
    if (finalSecond > 0 && finalSecond <= FINAL_MS / 1000 && heard.current.tick !== finalSecond) sfx("tick");
    heard.current.tick = finalSecond;
  }, [finalSecond]);

  const emote = async (e: DuelEmote) => {
    unlockAudio();
    return send({ action: "emote", emote: e });
  };

  const silhouette = useFirst(view?.round?.index, view?.round?.hints.silhouetteUrl);
  const mine = view?.round?.rows;
  const guessed = useMemo(() => new Set((mine ?? []).map((r) => r.id)), [mine]);
  const panelClues = useMemo(() => dexClues(mine ?? []), [mine]);

  async function leave() {
    if (await act({ action: "leave" })) router.push(HOME);
  }

  async function startRematch() {
    const next = await rematch();
    if (next) router.push(pvpHref("pokedle", next));
  }

  if (gone) return <DuelGone message={gone} href={HOME} label="Back to Pokédle" />;
  if (!view) return <DuelLoading />;

  const notice = (
    <>
      <MatchedNote view={view} />
      <DuelNotice error={error} offline={offline} />
      <EmoteFeed view={view} />
    </>
  );
  const tools = view.you !== null && <DuelTools onEmote={emote} />;

  if (view.status === "lobby") {
    return (
      <>
        {notice}
        <DuelLobby
          view={view}
          path={pvpHref("pokedle", view.code)}
          tag="Pokédle duel"
          title={
            <>
              Poké<span className="text-primary">dle</span> Duel
            </>
          }
          invite={(host) => `${host} challenges you! The same mystery Pokémon for both of you, three rounds, the most points wins.`}
          about="Head to head: the same mystery Pokémon for both of you, three rounds. Solve in fewer guesses, and faster, for more points."
          shareText="Duel me in Pokédle! Same mystery Pokémon, fewer guesses wins."
          settings={
            <div className="space-y-3">
              <GenPicker view={view} busy={busy} onPick={(gens) => void act({ action: "gens", gens })} />
              <LobbyRank />
            </div>
          }
          rules={[
            {
              label: "Rounds",
              text: `Three rounds, the same mystery Pokémon for both of you, with Pokédle's ${DLE_MAX_GUESSES} guesses and clues and ${DLE_DUEL_ROUND_MS / 60_000} minutes a round. You see your opponent's colours as they guess, never their Pokémon.`,
            },
            {
              label: "Points",
              text: `A solve scores ${fmt(dleDuelBase(1))} on the first guess down to ${dleDuelBase(DLE_MAX_GUESSES)} on the last, plus up to ${DLE_DUEL_SPEED_BONUS} for speed. Hints cost points: category −${DLE_DUEL_HINT_COST.genus}, silhouette −${DLE_DUEL_HINT_COST.silhouette}.`,
            },
            {
              label: "Winning",
              text: "The most points after three rounds wins; level on points, fewer guesses, then less time. Leave, or go quiet, and you forfeit.",
            },
          ]}
          home={HOME}
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
        tag="Pokédle duel"
        players={view.players}
        status={
          view.status === "finished"
            ? winner === null || winner === undefined
              ? "It ended in a draw."
              : `${view.players[winner]?.name} won.`
            : `Under way: round ${view.revealed.length + 1} of ${view.rounds}. ${fmt(view.totals[0])} points to ${fmt(view.totals[1])}.`
        }
        home={HOME}
        label="Start your own duel"
      />
    );
  }

  const me = view.you;
  const them = view.players[1 - me]?.name ?? "your opponent";
  const last = view.revealed[view.revealed.length - 1];

  if (view.status === "finished" && (summary || !sawPlay || view.end?.reason === "left" || !last)) {
    return (
      <>
        {notice}
        <DuelSummary view={view} busy={busy} onRematch={() => void startRematch()} />
        <div className="mx-auto mt-4 max-w-3xl">{tools}</div>
      </>
    );
  }

  const leaveButton = <LeaveButton busy={busy} onLeave={() => void leave()} />;
  const live = view.round && now >= view.round.startsAt ? view.round : undefined;

  // ---- lead-in: "Round 2" ----------------------------------------------------------
  if (view.round && !live) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        {notice}
        <DuelHud view={view} center={<div className="hud-label">Get ready</div>} />
        <Card>
          <CardContent className="space-y-3 p-10 text-center">
            <p className="hud-label text-screen">
              Round {view.round.index + 1} of {view.rounds}
            </p>
            <motion.p
              key={seconds(view.round.startsAt - now)}
              initial={{ scale: 1.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="font-display text-7xl font-bold tabular-nums"
            >
              {Math.max(1, seconds(view.round.startsAt - now))}
            </motion.p>
            <p className="text-sm text-muted-foreground">A new mystery Pokémon. Fewer guesses, and faster, scores more.</p>
          </CardContent>
        </Card>
        {leaveButton}
      </div>
    );
  }

  // ---- guessing --------------------------------------------------------------------------
  if (live) {
    const left = live.endsAt - now;
    const myBoard = live.boards[me];
    const theirs = live.boards[1 - me];
    const timeUp = left <= 0;
    const final = left > 0 && left <= FINAL_MS;
    const banner = myBoard.done
      ? myBoard.solved
        ? `Solved in ${myBoard.colours.length}! Waiting for ${them}…`
        : `Out of guesses. Waiting for ${them}…`
      : theirs.solved
        ? `${them} solved it in ${theirs.colours.length}!`
        : theirs.done
          ? `${them} is out of guesses.`
          : null;
    const buy = (hint: DleDuelHint) => {
      unlockAudio();
      void act({ action: "hint", round: live.index, hint });
    };
    return (
      <div className="mx-auto max-w-4xl space-y-4 xl:max-w-none">
        {notice}
        <DuelHud
          view={view}
          center={
            <>
              <div className="hud-label">
                Round {live.index + 1}/{view.rounds}
              </div>
              <RoundClock left={left} final={final && !myBoard.done} />
            </>
          }
        />
        <AnimatePresence>
          {banner && (
            <motion.p
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              role="status"
              className={cn(
                "rounded-md border px-4 py-2 text-center font-display text-sm font-semibold uppercase tracking-wider",
                myBoard.done ? "border-screen/40 text-screen" : "border-warning/50 bg-warning/[0.08] text-warning"
              )}
            >
              {banner}
            </motion.p>
          )}
        </AnimatePresence>
        <Momentum them={them} mine={myBoard} theirs={theirs} pool={view.pool} />

        {/*
          Your board and the opponent's side by side, the Pokédex below them. On a wide screen the
          Pokédex sits beside everything, and the opponent's board beside your guess box.
        */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_13rem] md:items-start xl:grid-cols-[minmax(0,1fr)_30rem]">
          {/* min-w-0: the board scrolls sideways on a phone instead of widening the page. */}
          <div className="min-w-0 space-y-4 md:col-start-1 md:row-start-1">
            <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_13rem] xl:items-start xl:gap-4">
              <div className="space-y-4">
                {!myBoard.done && (
                  <GuessInput
                    key={live.index}
                    names={names}
                    exclude={guessed}
                    disabled={timeUp}
                    placeholder={timeUp ? "Time's up" : `Guess ${live.rows.length + 1} of ${DLE_MAX_GUESSES} — type a Pokémon…`}
                    onGuess={(entry) => {
                      if (busy || timeUp) return false;
                      unlockAudio();
                      void act({ action: "guess", round: live.index, pokemon: entry[0] });
                      return true;
                    }}
                    fill={fill}
                  />
                )}
                <PossibleMeter left={leftOf(myBoard, view.pool)} pool={view.pool} label="Still possible for you" />
                {(!myBoard.done || myBoard.hints.length > 0) && (
                  <div className="mx-auto flex max-w-md flex-wrap items-center gap-3 rounded-md border bg-card p-3 text-sm">
                    <Lightbulb className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                    {silhouette && <img src={silhouette} alt="Silhouette hint" className="spotlight h-20 w-20 rounded-lg object-contain p-1" />}
                    {live.hints.genus && <span className="font-medium text-foreground">{live.hints.genus}</span>}
                    {!myBoard.done && (
                      <div className="flex flex-1 flex-wrap justify-end gap-2">
                        {(["genus", "silhouette"] as const)
                          .filter((hint) => !myBoard.hints.includes(hint))
                          .map((hint) => {
                            const Icon = HINT_INFO[hint].icon;
                            return (
                              <Button key={hint} size="sm" variant="outline" disabled={busy || live.rows.length === 0 || timeUp} onClick={() => buy(hint)}>
                                <Icon className="h-3.5 w-3.5" aria-hidden /> {HINT_INFO[hint].label} −{DLE_DUEL_HINT_COST[hint]}
                              </Button>
                            );
                          })}
                      </div>
                    )}
                    {live.rows.length === 0 && <p className="w-full text-xs text-muted-foreground">Hints open after your first guess. They cost points if you solve.</p>}
                  </div>
                )}
              </div>
              <div className="hidden xl:block">
                <OpponentBoard name={them} seat={1 - me} board={theirs} pool={view.pool} quiet={view.players[1 - me]?.quiet} round={live.index} />
              </div>
            </div>
            {live.rows.length > 0 ? (
              <Board rows={live.rows} />
            ) : (
              <p className="text-center text-sm text-muted-foreground">
                {DLE_MAX_GUESSES} guesses. 🟩 match · 🟨 right type, wrong slot, or close (dashed, with ▲▼) · ▲▼ the answer is higher / lower.
              </p>
            )}
          </div>
          {/* On a phone the opponent's progress comes first, above your (longer) board. */}
          <div className="order-first mx-auto w-full max-w-[13rem] md:order-none md:col-start-2 md:row-start-1 xl:hidden">
            <OpponentBoard name={them} seat={1 - me} board={theirs} pool={view.pool} quiet={view.players[1 - me]?.quiet} round={live.index} />
          </div>
          {/* Each round starts with every filter cleared. */}
          <DexPanel
            key={`${view.code}:${live.index}`}
            className="md:col-span-2 xl:col-span-1 xl:col-start-2 xl:row-start-1"
            gens={view.gens}
            guessed={guessed}
            clues={panelClues}
            onPick={myBoard.done || timeUp ? undefined : (name) => setFill((f) => ({ name, n: (f?.n ?? 0) + 1 }))}
          />
        </div>
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
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        {notice}
        <DuelHud view={view} center={<div className="hud-label">Round {last.index + 1}/{view.rounds}</div>} />
        <RoundReveal view={view} result={last}>
          <Button
            size="lg"
            className="w-full"
            disabled={!final && (pressed || busy)}
            onClick={() => {
              if (final) {
                sfx(view.end?.winner === me ? "fanfare" : view.end?.winner === null ? "streak" : "wrong");
                setSummary(true);
              } else void act({ action: "next", round: last.index });
            }}
          >
            {final ? "See results ▶" : pressed ? `Waiting for ${them}… (${nextIn})` : `Next round (${nextIn}) ▶`}
          </Button>
        </RoundReveal>
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

/** In the lobby: the creator picks the generations; the friend sees them. */
function GenPicker({ view, busy, onPick }: { view: DleDuelView; busy: boolean; onPick: (gens: number[]) => void }) {
  const gens = view.gens ?? [];
  if (view.you !== 0) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        Mystery Pokémon from: <b className="text-foreground">{gensText(view.gens)}</b>
      </p>
    );
  }
  const toggle = (g: number) => onPick(gens.includes(g) ? gens.filter((x) => x !== g) : [...gens, g]);
  return (
    <div className="space-y-2">
      <div className="hud-label">Mystery Pokémon from</div>
      <div className="flex flex-wrap gap-2">
        <Chip active={gens.length === 0} disabled={busy} onClick={() => onPick([])}>
          All
        </Chip>
        {GENS.map((g) => (
          <Chip key={g} active={gens.includes(g)} disabled={busy} onClick={() => toggle(g)}>
            Gen {g}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function Chip({ active, disabled, onClick, children }: { active: boolean; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "rounded-sm border px-2.5 py-1.5 font-pixel text-[10px] uppercase tracking-wider transition-colors disabled:opacity-60",
        active ? "border-primary bg-primary text-primary-foreground" : "border-foreground/10 bg-shade/20 text-muted-foreground hover:border-primary/50 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

/** Both trainers' names and points, facing each other, with the round in the middle. */
function DuelHud({ view, center }: { view: DleDuelView; center: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-md border bg-card/90 px-4 py-2 backdrop-blur">
      <Fighter view={view} seat={0} />
      <div className="text-center">
        {center}
        {seriesTag(view.series) && <div className="hud-label mt-0.5 text-warning">{seriesTag(view.series)}</div>}
      </div>
      <Fighter view={view} seat={1} right />
    </div>
  );
}

function Fighter({ view, seat, right }: { view: DleDuelView; seat: number; right?: boolean }) {
  const player = view.players[seat];
  const ahead = view.totals[seat] > view.totals[1 - seat];
  return (
    <div className={cn("min-w-0 space-y-0.5", right && "text-right")}>
      <div className={cn("flex items-center gap-1.5", right && "flex-row-reverse")}>
        <SeatDot seat={seat} />
        <span className="truncate font-display font-bold uppercase">{player?.name ?? "—"}</span>
        {view.you === seat && <span className="hud-label">You</span>}
        {player?.quiet && view.status === "playing" && <WifiOff className="h-3.5 w-3.5 shrink-0 text-warning" aria-label="Connection lost" />}
      </div>
      <div className={cn("font-pixel text-base tabular-nums", ahead ? "text-success" : "text-screen")}>{fmt(view.totals[seat])} pts</div>
      {view.ranked && (
        <div className={cn("flex", right && "justify-end")}>
          <TierBadge rating={view.ranked.ratings[seat]} games={view.ranked.provisional[seat] ? 0 : undefined} size="sm" />
        </div>
      )}
    </div>
  );
}

/** One clue as a coloured square (the opponent's view: no names, no values). With `delay`, it flips in like a board cell. */
function Square({ status, delay }: { status: CellStatus; delay?: number }) {
  const square = (
    <span className={cn("flex aspect-square items-center justify-center rounded-[3px] border text-[8px]", CELL_STYLES[status])} title={STATUS_TEXT[status]}>
      <CellGlyph status={status} size="h-2.5 w-2.5" />
    </span>
  );
  if (delay === undefined) return square;
  return (
    <motion.span className="block" initial={{ rotateX: 90, opacity: 0 }} animate={{ rotateX: 0, opacity: 1 }} transition={{ delay, duration: 0.35 }}>
      {square}
    </motion.span>
  );
}

function HintBadges({ hints }: { hints: DleDuelHint[] }) {
  if (hints.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {hints.map((hint) => {
        const Icon = HINT_INFO[hint].icon;
        return (
          <span key={hint} className="flex items-center gap-1 rounded-sm border border-warning/40 bg-warning/10 px-1.5 py-0.5 font-pixel text-[9px] uppercase text-warning">
            <Icon className="h-2.5 w-2.5" aria-hidden /> {HINT_INFO[hint].label}
          </span>
        );
      })}
    </span>
  );
}

/**
 * The opponent's progress in a live round: one row of colours per guess,
 * filling in as they guess (the newest row flips in), with a "Rival
 * guessed!" pulse, and the hints they bought.
 */
function OpponentBoard({ name, seat, board, pool, quiet, round }: { name: string; seat: number; board: DleDuelBoard; pool: number; quiet?: boolean; round: number }) {
  const reduced = useReducedMotion();
  const count = board.colours.length;
  // Rows already there when this board (re)appeared don't flip: only guesses made while you watch.
  const [seen] = useState(() => ({ round, count }));
  const [pulse, setPulse] = useState(0);
  const last = useRef({ round, count });
  useEffect(() => {
    if (last.current.round === round && count > last.current.count) setPulse((p) => p + 1);
    last.current = { round, count };
  }, [round, count]);
  const flipRow = !reduced && (seen.round !== round || count > seen.count) ? count - 1 : -1;
  return (
    <Card className={cn("relative", board.solved && "border-success/50")}>
      <AnimatePresence>
        {pulse > 0 && (
          <motion.span
            key={pulse}
            className="pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-warning"
            initial={{ opacity: 0.9 }}
            animate={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.01 : 1.2 }}
            aria-hidden
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {pulse > 0 && (
          <motion.span
            key={`t${pulse}`}
            role="status"
            className="pointer-events-none absolute -top-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-warning/60 bg-card px-2 py-0.5 font-display text-[11px] font-bold uppercase tracking-wider text-warning shadow"
            initial={reduced ? { opacity: 1 } : { opacity: 0, y: 6, scale: 0.8 }}
            animate={reduced ? { opacity: 0 } : { opacity: [1, 1, 0], y: 0, scale: 1 }}
            transition={{ duration: 1.8, times: [0, 0.7, 1] }}
          >
            {board.solved ? "Rival solved it!" : "Rival guessed!"}
          </motion.span>
        )}
      </AnimatePresence>
      <CardContent className="space-y-3 p-4">
        <p className="hud-label flex items-center gap-1.5">
          <SeatDot seat={seat} /> <span className="truncate">{name}</span>
          {quiet && <WifiOff className="h-3.5 w-3.5 shrink-0 text-warning" aria-label="Connection lost" />}
        </p>
        <div className="space-y-1" style={{ perspective: 400 }} aria-label={`${name}: ${progressText(board)}`}>
          {Array.from({ length: DLE_MAX_GUESSES }).map((_, r) => {
            const row = board.colours[r];
            return (
              <div key={row ? `g${r}` : `e${r}`} className="grid grid-cols-7 gap-1">
                {row
                  ? row.map((status, i) => <Square key={i} status={status} delay={r === flipRow ? i * 0.1 : undefined} />)
                  : Array.from({ length: 7 }).map((_, i) => <span key={i} className="aspect-square rounded-[3px] border border-dashed border-foreground/10" />)}
              </div>
            );
          })}
        </div>
        <HintBadges hints={board.hints} />
        <p className={cn("text-center font-display text-sm font-semibold uppercase tracking-wider", board.solved ? "text-success" : "text-muted-foreground")}>{progressText(board)}</p>
        {!board.solved && <PossibleMeter left={leftOf(board, pool)} pool={pool} compact />}
      </CardContent>
    </Card>
  );
}

/**
 * "N Pokémon still possible": how many Pokémon fit every clue a board has
 * shown, worked out on the server (the opponent's clues never leave it,
 * only this count). The bar shrinks from the whole pool towards one.
 */
function PossibleMeter({ left, pool, label, compact }: { left: number; pool: number; label?: string; compact?: boolean }) {
  // A log scale: the drop from 1,000 to 100 reads as much as 10 to 1.
  const share = pool > 1 ? Math.log(Math.max(1, left)) / Math.log(pool) : 0;
  return (
    <div className={cn("space-y-1", !compact && "mx-auto max-w-md")} role="status" aria-label={`${label ? `${label}: ` : ""}${possibleText(left)}`}>
      <p className={cn("flex items-center justify-between gap-2 text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>
        <span className="flex items-center gap-1">
          <Filter className="h-3 w-3" aria-hidden /> {label ?? "Still possible"}
        </span>
        <span className="font-pixel tabular-nums text-foreground">{fmt(left)}</span>
      </p>
      <span className="block h-1.5 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
        <span className="block h-full rounded-full bg-screen transition-[width] duration-500" style={{ width: `${Math.max(2, share * 100)}%` }} />
      </span>
    </div>
  );
}

/** A finished round's guesses: sprite, name and colours. */
function Guesses({ rows }: { rows: DleRow[] }) {
  if (rows.length === 0) return <p className="py-2 text-center text-sm text-muted-foreground">No guesses</p>;
  return (
    <ol className="space-y-1">
      {rows.map((row) => (
        <li key={row.id} className="grid grid-cols-[2rem_minmax(0,1fr)_repeat(7,1.1rem)] items-center gap-1 text-xs">
          <img src={spriteUrl(row.id)} alt="" width={32} height={32} className="h-8 w-8" />
          <span className="truncate font-semibold">{row.name}</span>
          {DLE_COLUMNS.map((c) => (
            <Square key={c.key} status={row.cells[c.key].status} />
          ))}
        </li>
      ))}
    </ol>
  );
}

/** How a round's points add up: the solve, speed, hints. */
function Breakdown({ score }: { score: DleDuelScore }) {
  const line = (label: string, value: string, tone?: string) => (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", tone)}>{value}</span>
    </div>
  );
  return (
    <div className="space-y-0.5 text-xs">
      {line("Guesses", score.solved ? `Solved in ${score.guesses}` : `${score.guesses}, not solved`)}
      {line("Time", score.ms !== undefined ? clock(score.ms) : "—")}
      {line("Solve", fmt(score.base))}
      {line("Speed bonus", `+${score.speed}`, score.speed > 0 ? "text-success" : undefined)}
      {line("Hints", score.cost ? `−${score.cost}` : "0", score.cost ? "text-warning" : undefined)}
      <div className="flex justify-between gap-3 border-t border-foreground/10 pt-1 font-display text-sm font-bold uppercase">
        <span>Round</span>
        <span className="tabular-nums">{fmt(score.points)} pts</span>
      </div>
    </div>
  );
}

function RoundReveal({ view, result, children }: { view: DleDuelView; result: DleDuelRoundResult; children: React.ReactNode }) {
  const me = view.you;
  const [a, b] = result.scores.map((s) => s.points);
  const best = a === b ? null : a > b ? 0 : 1;
  const name = (seat: number) => (seat === me ? "You" : (view.players[seat]?.name ?? "They"));
  const headline = best === null ? "An even round" : `${name(best)} ${best === me ? "take" : "takes"} round ${result.index + 1}`;
  return (
    <>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Card className={cn(best === me ? "border-success/50" : best === null ? "" : "border-destructive/40")}>
          <CardContent className="grid items-center gap-4 p-6 sm:grid-cols-[9rem_1fr]">
            <img src={result.answer.imageUrl} alt={result.answer.name} className="mx-auto h-36 w-36 object-contain" />
            <div className="space-y-3 text-center sm:text-left">
              <p className="font-display text-2xl font-bold uppercase leading-tight">{headline}</p>
              <p className="text-muted-foreground">
                It was <b className="text-foreground">{result.answer.name}</b>, the {result.answer.genus}.{result.timedOut && " The clock ran out."}
              </p>
              {children}
            </div>
          </CardContent>
        </Card>
      </motion.div>
      <div className="grid gap-4 sm:grid-cols-2">
        {result.boards.map((board, seat) => (
          <Card key={seat} className={cn(best === seat && "border-success/50")}>
            <CardContent className="space-y-3 p-4">
              <p className="hud-label flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <SeatDot seat={seat} /> {view.players[seat]?.name}
                </span>
                <span>{fmt(result.totals[seat])} pts in all</span>
              </p>
              <Guesses rows={board.rows} />
              <HintBadges hints={board.hints} />
              <Breakdown score={result.scores[seat]} />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

function DuelSummary({ view, busy, onRematch }: { view: DleDuelView; busy: boolean; onRematch: () => void }) {
  const me = view.you!;
  const end = view.end!;
  const them = view.players[1 - me]?.name ?? "Your opponent";
  const won = end.winner === me;
  const draw = end.winner === null;
  const [mine, theirs] = [view.totals[me], view.totals[1 - me]];
  // "Find new opponent" / "Play again": the queue this duel came from (casual for a friend's duel), under the same name.
  const ranked = view.queue === "ranked";
  const finder = useMatchmaking(ranked ? RANKED_MATCH : MATCH);
  const myName = view.players[me]?.name ?? "";
  const guesses = (seat: number) => view.revealed.reduce((sum, r) => sum + r.scores[seat].guesses, 0);
  const played = draw
    ? "Level on points, guesses and time."
    : mine !== theirs
      ? won
        ? `You scored ${fmt(mine)} to ${fmt(theirs)}.`
        : `${them} scored ${fmt(theirs)} to ${fmt(mine)}.`
      : guesses(0) !== guesses(1)
        ? `Level on ${fmt(mine)} points: ${won ? "you" : them} needed fewer guesses.`
        : `Level on ${fmt(mine)} points and guesses: ${won ? "you were" : `${them} was`} quicker.`;
  const reason = {
    played,
    left: won ? `${them} left the duel.` : "You left the duel.",
    idle: draw ? `Neither of you guessed for ${DLE_DUEL_IDLE_ROUNDS} rounds.` : won ? `${them} stopped guessing.` : `You didn't guess for ${DLE_DUEL_IDLE_ROUNDS} rounds.`,
  }[end.reason];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2 text-center">
        <p className="hud-label text-screen">Pokédle duel over · {gensText(view.gens)}</p>
        <div className={cn("flex items-center justify-center gap-3 font-display text-6xl font-bold uppercase", won ? "text-success" : draw ? "text-screen" : "text-destructive")}>
          {won && <Crown className="h-12 w-12" aria-hidden />}
          {draw ? "Draw" : won ? "Victory!" : "Defeat"}
        </div>
        <p className="text-muted-foreground">{reason}</p>
      </div>

      <DuelHud view={view} center={<div className="hud-label">Final</div>} />

      {view.ranked && <RankedOutcome view={view} />}

      {view.series && !ranked && <SeriesScore series={view.series} players={view.players} you={me} />}

      <Card>
        <CardContent className="space-y-5 p-5">
          {view.revealed.length > 0 && (
            <div className="space-y-3">
              {view.revealed.map((r) => (
                <section key={r.index} className="space-y-3 rounded-md border bg-shade/20 p-3" aria-label={`Round ${r.index + 1}`}>
                  <p className="flex min-w-0 items-center gap-2">
                    <span className="font-pixel text-xs text-muted-foreground">R{r.index + 1}</span>
                    <img src={spriteUrl(r.answer.id)} alt="" width={32} height={32} className="h-8 w-8 shrink-0" />
                    <span className="truncate font-semibold">{r.answer.name}</span>
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {r.scores.map((score, seat) => (
                      <div key={seat} className="min-w-0 space-y-2">
                        <p className="hud-label flex items-center justify-between gap-1.5">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <SeatDot seat={seat} /> <span className="truncate">{view.players[seat]?.name}</span>
                          </span>
                          <span className="tabular-nums">{fmt(score.points)} pts</span>
                        </p>
                        <Guesses rows={r.boards[seat].rows} />
                        <HintBadges hints={r.boards[seat].hints} />
                        <Breakdown score={score} />
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          {view.rematch && (
            <p role="status" className="text-center font-display text-sm font-semibold uppercase tracking-wider text-warning">
              Rematch requested!
            </p>
          )}
          {finder.searching ? (
            <Searching since={finder.since} onCancel={finder.cancel} ranked={ranked} />
          ) : view.queue ? (
            // From the queue: going again is the main thing; a rematch with this trainer is there too (always casual).
            <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
              <Button size="lg" variant="success" disabled={busy || !myName} onClick={() => void finder.search(myName, ranked ? rankedExtra() : {})} autoFocus>
                {ranked ? <Trophy className="h-4 w-4" aria-hidden /> : <UserSearch className="h-4 w-4" aria-hidden />}
                {ranked ? "Queue ranked" : "Play again"}
              </Button>
              <Button size="lg" variant="outline" disabled={busy} onClick={onRematch}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
                {view.rematch ? "Accept rematch" : ranked ? "Casual rematch" : "Rematch"}
              </Button>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <Button size="lg" variant="success" disabled={busy} onClick={onRematch}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
                {view.rematch ? "Accept rematch" : "Rematch"}
              </Button>
              <Button size="lg" variant="outline" disabled={busy || !myName} onClick={() => void finder.search(myName)}>
                <UserSearch className="h-4 w-4" aria-hidden /> Find new opponent
              </Button>
            </div>
          )}
          {finder.error && (
            <p role="alert" className="text-center text-sm text-destructive">
              {finder.error}
            </p>
          )}
          <p className="text-center text-xs text-muted-foreground">
            {view.series && view.series.winner === null
              ? `A rematch is game ${view.series.game + 1} of the series, with new mystery Pokémon. It starts when you both press it.`
              : "A rematch keeps the trainers and generations, with new mystery Pokémon. It starts when you both press it."}{" "}
            <Link href={HOME} className="underline underline-offset-2 hover:text-foreground">
              <Swords className="mr-1 inline h-3 w-3" aria-hidden />
              Back to Pokédle
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live feel
// ---------------------------------------------------------------------------

/** The round's clock: calm, then red under 30 s, then big and pulsing for the last ten. */
function RoundClock({ left, final }: { left: number; final: boolean }) {
  const reduced = useReducedMotion();
  const secondsLeft = Math.max(0, Math.ceil(left / 1000));
  if (!final) {
    return (
      <div className={cn("flex items-center justify-center gap-1 font-pixel text-lg tabular-nums", left < 30_000 ? "text-destructive" : "text-screen")}>
        <Timer className="h-4 w-4" aria-hidden />
        {clock(left)}
      </div>
    );
  }
  return (
    <motion.div
      key={secondsLeft}
      initial={reduced ? false : { scale: 1.5, opacity: 0.4 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="flex items-center justify-center gap-1 font-pixel text-3xl tabular-nums text-destructive drop-shadow-[0_0_8px_hsl(0_80%_55%/0.6)]"
      role="timer"
      aria-label={`${secondsLeft} seconds left`}
    >
      {secondsLeft}
    </motion.div>
  );
}

/** "Rival is down to 3 possible": how the race stands, by Pokémon still possible. */
function Momentum({ them, mine, theirs, pool }: { them: string; mine: DleDuelBoard; theirs: DleDuelBoard; pool: number }) {
  if (theirs.done || theirs.colours.length === 0) return null;
  const theirLeft = leftOf(theirs, pool);
  const myLeft = leftOf(mine, pool);
  const ahead = !mine.done && theirLeft < myLeft;
  const text =
    theirLeft === 1 ? `${them} has it down to 1. One guess from solving!` : `${them} is down to ${fmt(theirLeft)} possible${mine.done ? "" : ` · you: ${fmt(myLeft)}`}`;
  return (
    <p
      role="status"
      className={cn("flex items-center justify-center gap-1.5 text-center text-sm font-semibold", ahead || theirLeft === 1 ? "text-warning" : "text-muted-foreground")}
    >
      {(ahead || theirLeft === 1) && <Flame className="h-4 w-4 shrink-0" aria-hidden />}
      {text}
    </p>
  );
}

/** The reactions bar and the sound switch. */
function DuelTools({ onEmote }: { onEmote: (e: DuelEmote) => Promise<string | null> }) {
  const on = useDuelSfx();
  const [coolUntil, setCoolUntil] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [, force] = useState(0);
  useEffect(() => {
    if (!coolUntil) return;
    const id = window.setTimeout(() => force((n) => n + 1), Math.max(0, coolUntil - Date.now()) + 20);
    return () => window.clearTimeout(id);
  }, [coolUntil]);
  const cooling = coolUntil > Date.now();
  return (
    <div className="mx-auto flex max-w-md flex-wrap items-center justify-center gap-2">
      <span className="hud-label">React</span>
      {DUEL_EMOTES.map((e) => (
        <button
          key={e}
          type="button"
          disabled={cooling}
          onClick={async () => {
            setCoolUntil(Date.now() + EMOTE_GAP_MS);
            const err = await onEmote(e);
            setNote(err);
          }}
          className="h-9 min-w-9 rounded-full border border-foreground/15 bg-card px-2.5 text-base font-bold transition-transform hover:scale-110 hover:border-primary/60 disabled:opacity-50 disabled:hover:scale-100"
          aria-label={`Send ${e === "gg" ? "GG" : EMOTE_TEXT[e]}`}
        >
          {e === "gg" ? <span className="font-display text-xs">GG</span> : EMOTE_TEXT[e]}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setDuelSfx(!on)}
        aria-pressed={on}
        className="ml-2 flex h-9 items-center gap-1 rounded-full border border-foreground/15 bg-card px-3 text-xs text-muted-foreground hover:text-foreground"
        title={on ? "Sound effects on" : "Sound effects off"}
      >
        {on ? <Volume2 className="h-3.5 w-3.5" aria-hidden /> : <VolumeX className="h-3.5 w-3.5" aria-hidden />} Sound {on ? "on" : "off"}
      </button>
      {note && (
        <p className="w-full text-center text-xs text-muted-foreground" role="status">
          {note}
        </p>
      )}
    </div>
  );
}

/** Reactions as they arrive: a bubble on the sender's side of the screen. */
function EmoteFeed({ view }: { view: DleDuelView }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<{ n: number; seat: number; emote: DuelEmote }[]>([]);
  const seen = useRef(0);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const fresh = (view.emotes ?? []).filter((e) => e.n > seen.current && view.now - e.at < EMOTE_SHOW_MS);
    if (!fresh.length) return;
    seen.current = Math.max(...fresh.map((e) => e.n));
    if (fresh.some((e) => e.seat !== view.you)) sfx("ping");
    setShown((s) => [...s, ...fresh.map(({ n, seat, emote }) => ({ n, seat, emote }))].slice(-6));
    const ns = new Set(fresh.map((e) => e.n));
    // Each bubble's own timer: later polls don't cut it short.
    timers.current.push(window.setTimeout(() => setShown((s) => s.filter((x) => !ns.has(x.n))), 3_000));
  }, [view.emotes, view.now, view.you]);
  useEffect(() => {
    const list = timers.current;
    return () => list.forEach((id) => window.clearTimeout(id));
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-50 mx-auto flex max-w-4xl justify-between px-4" aria-live="polite">
      {[0, 1].map((seat) => (
        <div key={seat} className={cn("flex flex-col gap-2", seat === 1 && "items-end")}>
          <AnimatePresence>
            {shown
              .filter((e) => e.seat === seat)
              .map((e) => (
                <motion.span
                  key={e.n}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.6 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: reduced ? 0 : -10 }}
                  className="flex items-center gap-1.5 rounded-full border bg-card/95 px-3 py-1.5 text-2xl shadow-lg backdrop-blur"
                >
                  <span className="max-w-[8rem] truncate font-display text-[11px] font-bold uppercase text-muted-foreground">
                    {seat === view.you ? "You" : view.players[seat]?.name}
                  </span>
                  {e.emote === "gg" ? <span className="font-display text-lg font-bold">GG</span> : EMOTE_TEXT[e.emote]}
                </motion.span>
              ))}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

/** In a friend's duel lobby: your ranked tier and streak, if you have one. */
function LobbyRank() {
  const { state } = useRanked();
  if (state.status !== "ready" || !state.you || state.you.games === 0) return null;
  const you = state.you;
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
      <span className="hud-label">Your rank</span>
      <TierBadge rating={you.rating} games={you.games} size="sm" />
      {you.position !== null && <span>#{fmt(you.position)}</span>}
      {you.streak > 0 && (
        <span className="flex items-center gap-1 font-semibold text-warning">
          <Flame className="h-3.5 w-3.5" aria-hidden /> {you.streak} win streak
        </span>
      )}
    </div>
  );
}

/** After a ranked duel: the rating change and, once counted, your streak and place. */
function RankedOutcome({ view }: { view: DleDuelView }) {
  const me = view.you!;
  const result = view.ranked?.result;
  const { state, reload } = useRanked({ enabled: !!result });
  useEffect(() => {
    if (result) reload();
  }, [result, reload]);
  if (!result) {
    return (
      <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Counting your rating…
      </p>
    );
  }
  const you = state.status === "ready" ? state.you : null;
  return (
    <div className="space-y-2">
      <RatingChange before={result.before[me]} after={result.after[me]} provisional={view.ranked?.provisional[me]} />
      {you && (
        <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {you.position !== null && (
            <span>
              Ladder <b className="text-foreground">#{fmt(you.position)}</b> of {fmt(you.players)}
            </span>
          )}
          {you.streak > 1 ? (
            <span className="flex items-center gap-1 font-semibold text-warning">
              <Flame className="h-4 w-4" aria-hidden /> {you.streak} wins in a row!
            </span>
          ) : you.streak === 1 ? (
            <span>Win the next one to start a streak.</span>
          ) : null}
          <Link href="/leaderboard?board=pokedle" className="underline underline-offset-2 hover:text-foreground">
            Ranked ladder
          </Link>
        </p>
      )}
    </div>
  );
}
