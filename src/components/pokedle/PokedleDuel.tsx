"use client";

/* eslint-disable @next/next/no-img-element -- sprites, artwork and the server-rendered silhouette */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, Crown, Eye, Lightbulb, Loader2, RotateCcw, Swords, Tag, Timer, WifiOff } from "lucide-react";
import { DLE_COLUMNS, DLE_MAX_GUESSES, type CellStatus, type DleRow } from "@/lib/dle-types";
import {
  DLE_DUEL_HINT_COST,
  DLE_DUEL_IDLE_ROUNDS,
  DLE_DUEL_ROUND_MS,
  DLE_DUEL_SPEED_BONUS,
  dleDuelBase,
  pvpHref,
  type DleDuelBoard,
  type DleDuelHint,
  type DleDuelRoundResult,
  type DleDuelScore,
  type DleDuelView,
} from "@/lib/pvp-types";
import { play, unlockAudio } from "@/lib/sound";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useDuel } from "@/components/duel/use-duel";
import { DuelGone, DuelLoading, DuelLobby, DuelNotice, DuelVisitor, LeaveButton, SeatDot, clock, seconds } from "@/components/duel/DuelParts";
import { Board, CELL_STYLES, GuessInput, spriteUrl, type NameEntry } from "./parts";
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

const progressText = (board: DleDuelBoard) =>
  board.solved ? `Solved in ${board.colours.length}` : board.done ? "Out of guesses" : `${board.colours.length}/${DLE_MAX_GUESSES} guesses`;

export function PokedleDuel({ code, names }: { code: string; names: NameEntry[] }) {
  const router = useRouter();
  const { view, now, gone, offline, error, busy, sawPlay, act, join, rematch } = useDuel<DleDuelView>(`/api/duel/${code}`, code);
  const [summary, setSummary] = useState(false);
  const heard = useRef({ revealed: -1, theirSolve: false, end: false });

  // Each new screen (lobby, a round, a reveal, the result) starts at the top.
  const screen = !view ? "" : view.status === "lobby" ? "lobby" : view.round ? `round ${view.round.index}` : `reveal ${view.revealed.length} ${summary}`;
  useEffect(() => {
    if (screen) window.scrollTo({ top: 0, behavior: "smooth" });
  }, [screen]);

  // Sounds: the opponent solving, and each round's result.
  useEffect(() => {
    if (!view || view.you === null) return;
    const h = heard.current;
    const theirSolve = !!view.round?.boards[1 - view.you]?.solved;
    if (theirSolve && !h.theirSolve) play("click");
    h.theirSolve = theirSolve;
    if (h.revealed >= 0 && view.revealed.length > h.revealed) {
      const { scores } = view.revealed[view.revealed.length - 1];
      const [mine, theirs] = [scores[view.you].points, scores[1 - view.you].points];
      play(mine > theirs ? "correct" : mine === theirs ? "streak" : "wrong");
    }
    h.revealed = view.revealed.length;
    // A forfeit skips the last reveal, so its result sounds straight away.
    if (view.end?.reason === "left" && !h.end && sawPlay && view.end.winner === view.you) play("fanfare");
    h.end = !!view.end;
  }, [view, sawPlay]);

  const silhouette = useFirst(view?.round?.index, view?.round?.hints.silhouetteUrl);
  const mine = view?.round?.rows;
  const guessed = useMemo(() => new Set((mine ?? []).map((r) => r.id)), [mine]);

  async function leave() {
    if (await act({ action: "leave" })) router.push(HOME);
  }

  async function startRematch() {
    const next = await rematch();
    if (next) router.push(pvpHref("pokedle", next));
  }

  if (gone) return <DuelGone message={gone} href={HOME} label="Back to Pokédle" />;
  if (!view) return <DuelLoading />;

  const notice = <DuelNotice error={error} offline={offline} />;

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
          settings={<GenPicker view={view} busy={busy} onPick={(gens) => void act({ action: "gens", gens })} />}
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
      <div className="mx-auto max-w-4xl space-y-4">
        {notice}
        <DuelHud
          view={view}
          center={
            <>
              <div className="hud-label">
                Round {live.index + 1}/{view.rounds}
              </div>
              <div className={cn("flex items-center justify-center gap-1 font-pixel text-lg tabular-nums", left < 30_000 ? "text-destructive" : "text-screen")}>
                <Timer className="h-4 w-4" aria-hidden />
                {clock(left)}
              </div>
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

        <div className="grid gap-4 md:grid-cols-[1fr_13rem] md:items-start">
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
                  play("click");
                  void act({ action: "guess", round: live.index, pokemon: entry[0] });
                  return true;
                }}
              />
            )}
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
            {live.rows.length > 0 ? (
              <Board rows={live.rows} />
            ) : (
              <p className="text-center text-sm text-muted-foreground">
                {DLE_MAX_GUESSES} guesses. 🟩 match · 🟨 right type, wrong slot · ▲▼ the answer is higher / lower.
              </p>
            )}
          </div>
          {/* On a phone the opponent's progress comes first, above your (longer) board. */}
          <div className="order-first mx-auto w-full max-w-[13rem] md:order-none">
            <OpponentBoard name={them} seat={1 - me} board={theirs} quiet={view.players[1 - me]?.quiet} />
          </div>
        </div>
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
                play(view.end?.winner === me ? "fanfare" : view.end?.winner === null ? "streak" : "wrong");
                setSummary(true);
              } else void act({ action: "next", round: last.index });
            }}
          >
            {final ? "See results ▶" : pressed ? `Waiting for ${them}… (${nextIn})` : `Next round (${nextIn}) ▶`}
          </Button>
        </RoundReveal>
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
      <div className="text-center">{center}</div>
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
    </div>
  );
}

/** One clue as a coloured square (the opponent's view: no names, no values). */
function Square({ status }: { status: CellStatus }) {
  return (
    <span className={cn("flex aspect-square items-center justify-center rounded-[3px] border", CELL_STYLES[status])}>
      {status === "higher" && <ArrowUp className="h-2.5 w-2.5 text-primary" aria-hidden />}
      {status === "lower" && <ArrowDown className="h-2.5 w-2.5 text-primary" aria-hidden />}
    </span>
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

/** The opponent's progress in a live round: one row of colours per guess, and the hints they bought. */
function OpponentBoard({ name, seat, board, quiet }: { name: string; seat: number; board: DleDuelBoard; quiet?: boolean }) {
  return (
    <Card className={cn(board.solved && "border-success/50")}>
      <CardContent className="space-y-3 p-4">
        <p className="hud-label flex items-center gap-1.5">
          <SeatDot seat={seat} /> <span className="truncate">{name}</span>
          {quiet && <WifiOff className="h-3.5 w-3.5 shrink-0 text-warning" aria-label="Connection lost" />}
        </p>
        <div className="space-y-1" aria-label={`${name}: ${progressText(board)}`}>
          {Array.from({ length: DLE_MAX_GUESSES }).map((_, r) => {
            const row = board.colours[r];
            return (
              <div key={r} className="grid grid-cols-7 gap-1">
                {row
                  ? row.map((status, i) => <Square key={i} status={status} />)
                  : Array.from({ length: 7 }).map((_, i) => <span key={i} className="aspect-square rounded-[3px] border border-dashed border-foreground/10" />)}
              </div>
            );
          })}
        </div>
        <HintBadges hints={board.hints} />
        <p className={cn("text-center font-display text-sm font-semibold uppercase tracking-wider", board.solved ? "text-success" : "text-muted-foreground")}>{progressText(board)}</p>
      </CardContent>
    </Card>
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

      <Card>
        <CardContent className="space-y-5 p-5">
          {view.revealed.length > 0 && (
            <div className="space-y-3">
              {view.revealed.map((r) => (
                <div key={r.index} className="grid gap-3 rounded-md border bg-shade/20 p-3 sm:grid-cols-[10rem_1fr_1fr]">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="font-pixel text-xs text-muted-foreground">R{r.index + 1}</span>
                    <img src={spriteUrl(r.answer.id)} alt="" width={32} height={32} className="h-8 w-8 shrink-0" />
                    <span className="truncate font-semibold">{r.answer.name}</span>
                  </span>
                  {r.scores.map((score, seat) => (
                    <div key={seat} className="space-y-1">
                      <p className="hud-label flex items-center gap-1.5">
                        <SeatDot seat={seat} /> {view.players[seat]?.name}
                      </p>
                      <Breakdown score={score} />
                    </div>
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
            <Link href={HOME} className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
              <Swords className="h-4 w-4" aria-hidden /> Back to Pokédle
            </Link>
          </div>
          <p className="text-center text-xs text-muted-foreground">A rematch keeps the trainers and generations, with new mystery Pokémon. It starts when you both press it.</p>
        </CardContent>
      </Card>
    </div>
  );
}
