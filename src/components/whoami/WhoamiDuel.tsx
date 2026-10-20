"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Crown, Eye, Gavel, Hand, Package, RotateCcw, Search, Swords, Trophy } from "lucide-react";
import {
  ABILITY_INFO,
  CLUE_LABEL,
  WHOAMI_BID_MS,
  WHOAMI_DROP_EVERY_MS,
  WHOAMI_LOCK_MS,
  WHOAMI_MAX_BID,
  WHOAMI_PP,
  WHOAMI_PP_POINTS,
  WHOAMI_ROUND_MS,
  WHOAMI_SOLVE_POINTS,
  parseQuestion,
  poolSettingsText,
  questionText,
  type WhoamiAbility,
  type WhoamiBoard,
  type WhoamiDropView,
  type WhoamiDuelView,
  type WhoamiRoundResult,
} from "@/lib/whoami";
import { pvpHref, type DuelEmote } from "@/lib/pvp-types";
import { unlockAudio } from "@/lib/sound";
import { sfx } from "@/lib/duel-sfx";
import { useDuel } from "@/components/duel/use-duel";
import { SeriesScore, seriesTag } from "@/components/duel/DuelSeries";
import { DuelGone, DuelLoading, DuelLobby, DuelNotice, DuelVisitor, LeaveButton, MatchedNote, SeatDot, seconds } from "@/components/duel/DuelParts";
import { DuelChat, DuelTools, EmoteFeed } from "@/components/duel/DuelReactions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PlayArea } from "./PlayArea";
import { AbilityPicker, PPBar, PoolPicker, artUrl, fmt, type WhoamiDexEntry } from "./parts";
import { cn } from "@/lib/utils";

const HOME = "/whoami";

/** A server time worth polling right on: the clue drop opening or closing. */
function wakeAt(view: WhoamiDuelView): number | undefined {
  const r = view.round;
  if (!r) return undefined;
  if (r.drop && !r.drop.result) return r.drop.closesAt;
  return r.startsAt + WHOAMI_DROP_EVERY_MS * ((r.drop?.index ?? -1) + 2);
}

export function WhoamiDuel({ code, dex }: { code: string; dex: WhoamiDexEntry[] }) {
  const router = useRouter();
  const byId = useMemo(() => new Map(dex.map((e) => [e[0], e])), [dex]);
  const { view, now, gone, offline, error, busy, sawPlay, act, send, join, rematch } = useDuel<WhoamiDuelView>(`/api/duel/${code}`, code, wakeAt);
  const [summary, setSummary] = useState(false);
  const heard = useRef({ drop: -1, settled: -1, rivalSolved: false, revealed: -1 });

  // Sounds: a clue dropping, a clue settled, the rival solving, each round's result.
  useEffect(() => {
    if (!view || view.you === null) return;
    const h = heard.current;
    const r = view.round;
    const key = r ? r.index * 10 + (r.drop?.index ?? -1) : -1;
    if (r?.drop && key !== h.drop) {
      if (h.drop !== -1 || r.drop.index >= 0) sfx("ping");
      h.drop = key;
    }
    if (r?.drop?.result && h.settled !== key) {
      sfx(r.drop.result.winner === view.you ? "correct" : "click");
      h.settled = key;
    }
    const rivalSolved = r?.boards[1 - view.you]?.solvedMs !== undefined;
    if (rivalSolved && !h.rivalSolved) sfx("ping");
    h.rivalSolved = rivalSolved;
    if (h.revealed >= 0 && view.revealed.length > h.revealed) {
      const w = view.revealed.at(-1)!.winner;
      sfx(w === view.you ? "fanfare" : w === null ? "streak" : "wrong");
    }
    h.revealed = view.revealed.length;
  }, [view]);

  const move = (m: Record<string, unknown>) => {
    unlockAudio();
    return act({ action: "whoami", move: m });
  };
  const emote = async (e: DuelEmote) => {
    unlockAudio();
    return send({ action: "emote", emote: e });
  };

  async function leave() {
    if (await act({ action: "leave" })) router.push(HOME);
  }
  async function startRematch() {
    const next = await rematch();
    if (next) router.push(pvpHref("whoami", next));
  }

  if (gone) return <DuelGone message={gone} href={HOME} label="Back to Who Am I?" />;
  if (!view) return <DuelLoading />;

  const notice = (
    <>
      <MatchedNote view={view} />
      <DuelNotice error={error} offline={offline} />
      <EmoteFeed view={view} />
    </>
  );
  const tools = view.you !== null && <DuelTools onEmote={emote} />;
  const chat = <DuelChat view={view} game="Who Am I? duel" onSend={(text) => send({ action: "chat", text })} />;

  if (view.status === "lobby") {
    const mine: WhoamiAbility | undefined = view.you !== null ? view.abilities[view.you] : undefined;
    return (
      <>
        {notice}
        <DuelLobby
          view={view}
          path={pvpHref("whoami", view.code)}
          tag="Who Am I? duel"
          title={
            <>
              Who Am <span className="text-primary">I?</span> Duel
            </>
          }
          invite={(host) => `${host} challenges you! The same secret Pokémon for both of you: ask yes/no questions, strike the grid, name it first.`}
          about="The same secret Pokémon for both of you, best of three rounds. Ask yes/no questions with your PP, bid on sealed clues, and name it first."
          shareText="Race me in Who Am I? Same secret Pokémon, first to name it wins."
          settings={
            <div className="space-y-4">
              <PoolPicker value={view.settings} size={view.pool.length} disabled={busy} onChange={view.you === 0 ? (settings) => void move({ type: "settings", settings }) : undefined} />
              {mine && <AbilityPicker value={mine} disabled={busy} onChange={(ability) => void move({ type: "pick", ability })} />}
              {view.players.length === 2 && view.you !== null && (
                <p className="text-sm text-muted-foreground">
                  {view.players[1 - view.you].name} brings <b>{ABILITY_INFO[view.abilities[1 - view.you]].label}</b>.
                </p>
              )}
            </div>
          }
          rules={[
            {
              label: "Ask",
              text: `${WHOAMI_PP} PP a round. Broad questions cost 10, sharp ones 20 to 25. Every answer strikes the grid. A wrong guess costs no PP but locks you out for ${WHOAMI_LOCK_MS / 1000} s.`,
            },
            {
              label: "Bid",
              text: `Every ${WHOAMI_DROP_EVERY_MS / 1000} s a sealed clue drops. Bid up to ${WHOAMI_MAX_BID} PP in ${WHOAMI_BID_MS / 1000} s: the higher bid wins it, the loser gets half back. A tie goes to nobody.`,
            },
            {
              label: "Win",
              text: `First to name it takes the round, scoring ${fmt(WHOAMI_SOLVE_POINTS)} + ${WHOAMI_PP_POINTS} per PP left; the other gets 30 s to score too. Best of three, ${WHOAMI_ROUND_MS / 60_000} minutes a round.`,
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

  if (view.you === null) {
    const winner = view.end?.winner;
    return (
      <DuelVisitor
        tag="Who Am I? duel"
        players={view.players}
        status={
          view.status === "finished"
            ? winner === null || winner === undefined
              ? "It ended in a draw."
              : `${view.players[winner]?.name} won.`
            : `Under way: round ${view.revealed.length + 1}. Rounds ${view.wins[0]}–${view.wins[1]}.`
        }
        home={HOME}
        label="Start your own duel"
      />
    );
  }

  const me = view.you;
  const them = view.players[1 - me]?.name ?? "your opponent";
  const last = view.revealed.at(-1);

  if (view.status === "finished" && (summary || !sawPlay || view.end?.reason === "left" || !last)) {
    return (
      <>
        {notice}
        <Summary view={view} busy={busy} onRematch={() => void startRematch()} />
        <div className="mx-auto mt-4 max-w-3xl space-y-4">
          {tools}
          {chat}
        </div>
      </>
    );
  }

  const leaveButton = <LeaveButton busy={busy} onLeave={() => void leave()} />;
  const live = view.round && now >= view.round.startsAt ? view.round : undefined;

  if (view.round && !live) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        {notice}
        <Hud view={view} />
        <Card>
          <CardContent className="space-y-3 p-10 text-center">
            <p className="hud-label text-screen">
              Round {view.round.index + 1} · first to {Math.ceil(view.rounds / 2)}
            </p>
            <motion.p key={seconds(view.round.startsAt - now)} initial={{ scale: 1.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="font-display text-7xl font-bold tabular-nums">
              {Math.max(1, seconds(view.round.startsAt - now))}
            </motion.p>
            <p className="text-sm text-muted-foreground">A new secret Pokémon, {WHOAMI_PP} PP each. You bring {ABILITY_INFO[view.abilities[me]].label}.</p>
          </CardContent>
        </Card>
        {leaveButton}
      </div>
    );
  }

  if (live && live.mine) {
    const mine = live.boards[me];
    const theirs = live.boards[1 - me];
    const solved = mine.solvedMs !== undefined;
    const banner = solved
      ? theirs.solvedMs !== undefined
        ? null
        : `Solved! ${them} has until the bell to solve too.`
      : theirs.solvedMs !== undefined
        ? `${them} named it! Last call: solve before the bell to score.`
        : null;
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        {notice}
        <Hud view={view} />
        {banner && (
          <motion.p initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} role="status" className="rounded-md border border-warning/50 bg-warning/[0.08] px-4 py-2 text-center font-display text-sm font-semibold uppercase tracking-wider text-warning">
            {banner}
          </motion.p>
        )}
        <PlayArea
          pool={view.pool}
          mine={live.mine}
          dex={byId}
          now={now}
          endsAt={live.endsAt}
          done={solved}
          tauntUntil={mine.tauntUntil}
          busy={busy}
          onAsk={(q) => void move({ type: "ask", round: live.index, q })}
          onGuess={(pokemon) => void move({ type: "guess", round: live.index, pokemon }).then((ok) => ok && sfx("click"))}
          side={
            <>
              {live.drop && <DropCard drop={live.drop} now={now} pp={mine.pp} me={me} them={them} busy={busy} solved={solved} onBid={(amount) => void move({ type: "bid", round: live.index, amount })} />}
              <AbilityCard
                ability={view.abilities[me]}
                used={mine.abilityUsed}
                traced={live.traced}
                frisked={live.frisked}
                them={them}
                busy={busy}
                onUse={() => void move({ type: "ability", round: live.index })}
              />
            </>
          }
        />
        {tools}
        {leaveButton}
      </div>
    );
  }

  if (last) {
    const final = view.status === "finished";
    const pressed = view.next?.pressed[me] ?? false;
    const nextIn = view.next ? seconds(view.next.at - now) : 0;
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        {notice}
        <Hud view={view} />
        <Reveal view={view} result={last} />
        <Button
          size="lg"
          className="w-full"
          disabled={!final && (pressed || busy)}
          data-testid="whoami-next"
          onClick={() => (final ? setSummary(true) : void act({ action: "next", round: last.index }))}
        >
          {final ? "See results ▶" : pressed ? `Waiting for ${them}… (${nextIn})` : `Next round (${nextIn}) ▶`}
        </Button>
        {tools}
        {!final && leaveButton}
      </div>
    );
  }

  return <DuelLoading />;
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** Both trainers: rounds won, PP, questions asked, wrong guesses, solved. Never their questions. */
function Hud({ view }: { view: WhoamiDuelView }) {
  const r = view.round;
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-md border bg-card p-3" data-testid="whoami-hud">
      {[0, 1].map((seat) => {
        const b: WhoamiBoard | undefined = r?.boards[seat];
        const p = view.players[seat];
        const side = (
          <div key={seat} className={cn("min-w-0 space-y-1", seat === 1 && "col-start-3 text-right")}>
            <p className={cn("flex items-center gap-2 truncate font-display text-lg font-bold uppercase", seat === 1 && "justify-end")}>
              <SeatDot seat={seat} /> {p?.name}
              {view.you === seat && <span className="hud-label">You</span>}
              {p?.quiet && <span className="hud-label text-warning">Away</span>}
            </p>
            {b && (
              <>
                <PPBar pp={b.pp} compact />
                <p className="text-xs text-muted-foreground">
                  {b.asked} asked · {b.wrong} wrong · {ABILITY_INFO[view.abilities[seat]].label}
                  {b.abilityUsed ? " (used)" : ""}
                  {b.solvedMs !== undefined && <b className="text-success"> · solved in {Math.round(b.solvedMs / 1000)}s</b>}
                </p>
              </>
            )}
          </div>
        );
        return side;
      })}
      <div className="col-start-2 row-start-1 text-center">
        <p className="hud-label">Rounds</p>
        <p className="font-display text-3xl font-bold tabular-nums">
          {view.wins[0]}–{view.wins[1]}
        </p>
        {seriesTag(view.series) && <p className="hud-label">{seriesTag(view.series)}</p>}
      </div>
    </div>
  );
}

function DropCard({ drop, now, pp, me, them, busy, solved, onBid }: { drop: WhoamiDropView; now: number; pp: number; me: number; them: string; busy: boolean; solved: boolean; onBid: (n: number) => void }) {
  const max = Math.min(WHOAMI_MAX_BID, pp);
  const [bid, setBid] = useState(Math.min(10, max));
  const open = !drop.result && now < drop.closesAt;
  // Hide a settled clue's card after a while.
  if (drop.result && now > drop.closesAt + 12_000) return null;
  return (
    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={cn("space-y-2 rounded-md border-2 p-3", open ? "border-primary bg-primary/[0.07]" : "border-border bg-card")} data-testid="whoami-drop">
      <div className="flex items-center gap-2">
        <Package className="h-5 w-5 text-primary" aria-hidden />
        <p className="font-display font-bold uppercase">Sealed clue: {CLUE_LABEL[drop.kind]}</p>
        {open && <span className="ml-auto font-pixel text-sm tabular-nums text-primary">{seconds(drop.closesAt - now)}s</span>}
      </div>
      {drop.result ? (
        <p className="text-sm" role="status">
          {drop.result.winner === null
            ? `Tie at ${drop.result.bids[0]}: nobody wins it. Half your bid came back.`
            : drop.result.winner === me
              ? `You won it for ${drop.result.bids[me]} PP (${them} bid ${drop.result.bids[1 - me]}). It's in your list.`
              : `${them} won it with ${drop.result.bids[1 - me]} PP. You got ${Math.floor(drop.result.bids[me] / 2)} PP back.`}
        </p>
      ) : drop.bid !== null ? (
        <p className="text-sm text-muted-foreground">
          You bid {drop.bid} PP. {drop.rivalBid ? `${them} has bid too.` : `Waiting on ${them}…`}
        </p>
      ) : solved ? null : (
        <div className="flex items-center gap-2">
          <input type="range" min={0} max={max} value={Math.min(bid, max)} onChange={(e) => setBid(Number(e.target.value))} className="flex-1" aria-label="Your bid" disabled={!open} />
          <span className="w-12 text-right font-pixel text-sm tabular-nums">{Math.min(bid, max)}</span>
          <Button size="sm" disabled={!open || busy} onClick={() => onBid(Math.min(bid, max))} data-testid="whoami-bid">
            <Gavel className="h-3.5 w-3.5" aria-hidden /> Bid
          </Button>
        </div>
      )}
      {!drop.result && drop.bid === null && <p className="text-xs text-muted-foreground">Sealed bids. Higher wins; the loser gets half back.{drop.rivalBid ? ` ${them} has bid.` : ""}</p>}
    </motion.div>
  );
}

const ABILITY_ICON: Record<WhoamiAbility, typeof Hand> = { taunt: Hand, trace: Eye, frisk: Search };

function AbilityCard({
  ability,
  used,
  traced,
  frisked,
  them,
  busy,
  onUse,
}: {
  ability: WhoamiAbility;
  used: boolean;
  traced?: { q: string; yes: boolean } | null;
  frisked?: number;
  them: string;
  busy: boolean;
  onUse: () => void;
}) {
  const Icon = ABILITY_ICON[ability];
  return (
    <div className="flex items-center gap-3 rounded-md border bg-card p-3" data-testid="whoami-ability">
      <Icon className="h-5 w-5 shrink-0 text-screen" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-display font-bold uppercase">{ABILITY_INFO[ability].label}</p>
        {traced ? (
          <p>
            {them} asked “{questionText(parseQuestion(traced.q)!)}” <b>{traced.yes ? "Yes" : "No"}</b>
          </p>
        ) : frisked !== undefined ? (
          <p>
            {them} has <b>{fmt(frisked)}</b> Pokémon left.
          </p>
        ) : (
          <p className="text-muted-foreground">{used ? "Used this round." : ABILITY_INFO[ability].blurb}</p>
        )}
      </div>
      {!used && (
        <Button size="sm" variant="outline" disabled={busy} onClick={onUse} data-testid="whoami-use-ability">
          Use
        </Button>
      )}
    </div>
  );
}

function Reveal({ view, result }: { view: WhoamiDuelView; result: WhoamiRoundResult }) {
  const me = view.you!;
  return (
    <Card data-testid="whoami-reveal">
      <CardContent className="grid items-center gap-6 p-6 sm:grid-cols-[auto_1fr]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={artUrl(result.answer.id)} alt={result.answer.name} className="mx-auto h-40 w-40 object-contain" />
        <div className="space-y-3">
          <p className="hud-label text-screen">Round {result.index + 1}</p>
          <p className="font-display text-4xl font-bold uppercase">I&apos;m {result.answer.name}!</p>
          <p className="text-sm text-muted-foreground">The {result.answer.genus}</p>
          <p className="font-display text-lg font-bold uppercase">
            {result.winner === null ? "A draw" : result.winner === me ? "You take the round" : `${view.players[result.winner]?.name} takes the round`}
            {result.timedOut && result.winner !== null ? " (most PP left)" : ""}
          </p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {result.boards.map((b, k) => (
              <div key={k} className="rounded-md border bg-shade/20 p-2">
                <p className="flex items-center gap-1.5 font-semibold">
                  <SeatDot seat={k} /> {view.players[k]?.name}
                </p>
                <p className="font-display text-xl font-bold tabular-nums">{fmt(b.score)}</p>
                <p className="text-xs text-muted-foreground">
                  {b.solvedMs !== undefined ? `Solved in ${Math.round(b.solvedMs / 1000)}s` : "Not solved"} · {b.pp} PP left · {b.asked} asked
                </p>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Summary({ view, busy, onRematch }: { view: WhoamiDuelView; busy: boolean; onRematch: () => void }) {
  const me = view.you!;
  const winner = view.end?.winner;
  const title = winner === null || winner === undefined ? "A draw" : winner === me ? "You win!" : `${view.players[winner]?.name} wins`;
  return (
    <Card className="mx-auto max-w-3xl" data-testid="whoami-summary">
      <CardContent className="space-y-5 p-8 text-center">
        <p className="hud-label text-screen">Who Am I? duel · {poolSettingsText(view.settings)}</p>
        <p className="flex items-center justify-center gap-2 font-display text-5xl font-bold uppercase">
          {winner === me ? <Crown className="h-10 w-10 text-warning" aria-hidden /> : <Trophy className="h-9 w-9 text-muted-foreground" aria-hidden />} {title}
        </p>
        <p className="text-muted-foreground">
          {view.end?.reason === "left"
            ? "Your opponent left the duel."
            : view.end?.reason === "idle"
              ? "Sat out two rounds in a row."
              : `Rounds ${view.wins[me]}–${view.wins[1 - me]} · points ${fmt(view.totals[me])}–${fmt(view.totals[1 - me])}`}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {view.revealed.map((r) => (
            <div key={r.index} className="w-28 rounded-md border bg-shade/20 p-2 text-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={artUrl(r.answer.id)} alt="" className="mx-auto h-16 w-16 object-contain" />
              <p className="font-semibold">{r.answer.name}</p>
              <p className={cn(r.winner === me ? "text-success" : r.winner === null ? "text-muted-foreground" : "text-destructive")}>
                {r.winner === me ? "Won" : r.winner === null ? "Draw" : "Lost"}
              </p>
            </div>
          ))}
        </div>
        {view.series && <SeriesScore series={view.series} players={view.players} you={me} />}
        <div className="flex justify-center gap-2">
          <Button size="lg" disabled={busy} onClick={onRematch} data-testid="whoami-rematch">
            <RotateCcw className="h-4 w-4" aria-hidden /> {view.rematch ? "Accept rematch" : "Rematch"}
          </Button>
          <Link href={HOME} className="inline-flex items-center gap-2 rounded-md border px-4 text-sm font-semibold">
            <Swords className="h-4 w-4" aria-hidden /> New duel
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
