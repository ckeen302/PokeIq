"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MotionConfig } from "framer-motion";
import { Crown, RotateCcw, Timer } from "lucide-react";
import { pvpHref, type PdkDuelView } from "@/lib/pvp-types";
import { PDK_FAMILIES, PDK_FAMILY_LABELS } from "@/lib/pikadoku/types";
import { recordPdkDuel, type BadgeDef } from "@/lib/progress";
import { play, unlockAudio } from "@/lib/sound";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useDuel } from "@/components/duel/use-duel";
import { DuelGone, DuelLoading, DuelLobby, DuelNotice, DuelVisitor, LeaveButton, MatchedNote, seconds } from "@/components/duel/DuelParts";
import { DuelChat, DuelTools, EmoteFeed } from "@/components/duel/DuelReactions";
import { SeriesScore, seriesTag } from "@/components/duel/DuelSeries";
import { NewDuelCard } from "@/components/duel/NewDuelCard";
import { AddFriendAfterGame } from "@/components/community/AddFriend";
import { NewBadges } from "@/components/connections/results";
import { PdkBoard, PdkPicker, useDex, type BoardCell, type DexName } from "./parts";
import { cn } from "@/lib/utils";

/**
 * A Pikadoku Tic Tac Toe duel at /pikadoku/duel/<code>: the lobby, the game
 * and the result. The server checks every claim; this polls it and sends the
 * trainer's Pokémon for a cell. A wrong guess or a timeout passes the turn.
 */

const HOME = "/pikadoku";
const TURN_CHOICES = [15, 30, 45, 60];

/** "Duel a friend" on /pikadoku, with the lobby's custom rules: the turn timer and the categories. */
export function PikadokuDuelCard() {
  const [turnSecs, setTurnSecs] = useState(30);
  const [families, setFamilies] = useState<string[]>([...PDK_FAMILIES]);
  const [steals, setSteals] = useState(false);
  const body = useMemo(() => ({ kind: "pikadoku", turnSecs, families, ...(steals && { steals: true }) }), [turnSecs, families, steals]);
  return (
    <NewDuelCard
      body={body}
      href={(code) => pvpHref("pikadoku", code)}
      match={{ game: "pikadoku", ...(steals && { steals: true }) }}
      heading="Head to head · Tic Tac Toe"
      blurb="One grid, two trainers. Take turns claiming a cell with a Pokémon that fits; three in a row wins."
      info={
        <>
          <p>A wrong guess, or running out of time, passes the turn. Each Pokémon can be used once. Your opponent sees only which cells you have claimed.</p>
          <p>Steals: claim a cell your opponent holds by naming a different Pokémon that fits it and is rarer (a lower pick %). A stolen cell can be stolen back.</p>
          <p>Turn timer and categories apply to a game you send to a friend; finding an opponent uses 30-second turns and every category. Steals applies to both.</p>
        </>
      }
    >
      <div className="space-y-2 text-left" data-testid="pdk-lobby-rules">
        <div className="flex flex-wrap items-center gap-2">
          <span className="hud-label">Mode</span>
          {[false, true].map((on) => (
            <button key={String(on)} type="button" aria-pressed={steals === on} data-testid={`pdk-steals-${on ? "on" : "off"}`} onClick={() => setSteals(on)} title={on ? "Take cells from your opponent with a rarer Pokémon" : "Classic: a claimed cell stays claimed"} className={cn("rounded border px-2 py-0.5 text-xs font-semibold", steals === on ? "border-primary bg-primary/15" : "border-foreground/15 text-muted-foreground")}>
              {on ? "Steals" : "Classic"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="hud-label flex items-center gap-1">
            <Timer className="h-3.5 w-3.5" aria-hidden /> Turn timer
          </span>
          {TURN_CHOICES.map((s) => (
            <button key={s} type="button" aria-pressed={turnSecs === s} onClick={() => setTurnSecs(s)} className={cn("rounded border px-2 py-0.5 text-xs font-semibold", turnSecs === s ? "border-primary bg-primary/15" : "border-foreground/15 text-muted-foreground")}>
              {s}s
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Duel categories">
          <span className="hud-label">Categories</span>
          {PDK_FAMILIES.map((f) => {
            const on = families.includes(f);
            return (
              <button
                key={f}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = on ? families.filter((x) => x !== f) : [...families, f];
                  if (next.length) setFamilies(next);
                }}
                className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", on ? "border-primary bg-primary/15" : "border-foreground/15 text-muted-foreground")}
              >
                {PDK_FAMILY_LABELS[f]}
              </button>
            );
          })}
        </div>
      </div>
    </NewDuelCard>
  );
}

export function PikadokuDuel({ code }: { code: string }) {
  const router = useRouter();
  const dex = useDex();
  const names = useMemo(() => new Map(dex.map((p) => [p.id, p.name])), [dex]);
  const { view, now, gone, offline, error, busy, sawPlay, act, send, join, rematch } = useDuel<PdkDuelView>(`/api/duel/${code}`, code);
  const [picking, setPicking] = useState<number | null>(null);
  const [badges, setBadges] = useState<BadgeDef[]>([]);

  const endedAs = view?.status === "finished" && view.you !== null && view.end ? (view.end.winner === null ? "draw" : view.end.winner === view.you ? "win" : "loss") : null;
  useEffect(() => {
    if (!endedAs || !view) return;
    const fresh = recordPdkDuel(view.code, endedAs);
    if (fresh.length) setBadges(fresh);
    if (sawPlay) play(endedAs === "win" ? "fanfare" : endedAs === "draw" ? "streak" : "wrong");
    // Once per duel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endedAs, view?.code]);

  const lastAt = view?.last?.at;
  useEffect(() => {
    if (lastAt) play(view?.last?.hit ? "ping" : "wrong");
    // A sound for each move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAt]);

  const me = view?.you ?? null;
  const myTurn = !!view && me !== null && view.status === "playing" && view.turn === me;
  const playing = !!view && view.status === "playing" && !!view.round && now >= view.round.startsAt && !!view.grid;

  async function claim(p: DexName) {
    if (picking === null) return;
    const cell = picking;
    setPicking(null);
    await act({ action: "claim", cell, pokemon: p.id });
  }

  async function leave() {
    if (await act({ action: "leave" })) router.push(HOME);
  }

  async function startRematch() {
    const next = await rematch();
    if (next) router.push(pvpHref("pikadoku", next));
  }

  if (gone) return <DuelGone message={gone} href={HOME} label="Back to Pikadoku" />;
  if (!view) return <DuelLoading />;

  const tag = `Pikadoku Tic Tac Toe${seriesTag(view.series) ? ` · ${seriesTag(view.series)}` : ""}`;
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
  const chat = <DuelChat view={view} game="Pikadoku duel" onSend={(text) => send({ action: "chat", text })} />;

  if (view.status === "lobby") {
    return (
      <>
        {notice}
        <DuelLobby
          view={view}
          path={pvpHref("pikadoku", view.code)}
          tag={tag}
          title={
            <>
              Pikadoku <span className="text-primary">Tic Tac Toe</span>
            </>
          }
          invite={(host) => `${host} challenges you to Pikadoku Tic Tac Toe! Take turns claiming cells with a Pokémon that fits: three in a row wins.`}
          about="One Pikadoku grid, two trainers. Take turns claiming cells with a Pokémon that fits both its row and column."
          shareText="Play me at Pikadoku Tic Tac Toe! Claim cells with Pokémon that fit: three in a row wins."
          rules={[
            { label: "The game", text: "One 3×3 grid. Take turns naming a Pokémon that fits a cell's row and column to claim it. Three in a row wins." },
            { label: "Misses", text: `A wrong guess, or running out of the ${view.settings.turnSecs}-second turn, passes the turn. A Pokémon can be used once (a form and its species count as one).` },
            ...(view.settings.steals ? [{ label: "Steals", text: "You can claim a cell your opponent holds by naming a different Pokémon that fits and is rarer (a lower pick %; without rarity data, any different Pokémon). A failed steal passes the turn. A stolen cell can be stolen back." }] : []),
            { label: "Categories", text: `This game draws on: ${view.settings.families.map((f) => PDK_FAMILY_LABELS[f as keyof typeof PDK_FAMILY_LABELS] ?? f).join(", ")}.` },
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

  const cells: BoardCell[] = view.owners.map((o, i) => ({ id: view.picks[i], owner: o, highlight: !!view.line?.includes(i) }));
  const board = <PdkBoard grid={view.grid ?? null} cells={cells} names={names} onCell={myTurn && playing ? (c) => setPicking(c) : undefined} disabled={!myTurn || busy} stealable={view.settings.steals && me !== null ? (c) => view.owners[c] === 1 - me : undefined} testPrefix="pdkd" />;
  const status = (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-sm">
      {view.players.map((p, k) => (
        <span key={k} className={cn("font-semibold", view.status === "playing" && view.turn === k && "text-primary")}>
          {k === 0 ? "X" : "O"} · {p.name}
          {me === k && " (you)"}
        </span>
      ))}
    </div>
  );

  if (me === null) {
    const winner = view.end?.winner;
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {board}
        <DuelVisitor
          tag={tag}
          players={view.players}
          status={view.status === "finished" ? (winner === null || winner === undefined ? "It ended in a draw." : `${view.players[winner]?.name} won.`) : "Under way."}
          home={HOME}
          label="Start your own game"
        />
      </div>
    );
  }

  if (view.status === "finished") {
    const w = view.end?.winner;
    return (
      <MotionConfig reducedMotion="user">
        {notice}
        <div className="mx-auto max-w-3xl space-y-4 text-center">
          <p className="hud-label text-screen">{tag}</p>
          <h1 className="font-display text-3xl font-bold uppercase" data-testid="pdkd-outcome">
            {w === null || w === undefined ? "Draw" : w === me ? (
              <>
                <Crown className="mr-2 inline h-6 w-6 text-warning" aria-hidden />
                You win
              </>
            ) : (
              `${view.players[w]?.name} wins`
            )}
          </h1>
          {status}
          {board}
          {view.series && <SeriesScore series={view.series} players={view.players} you={me} />}
          <NewBadges badges={badges} />
          <Button type="button" onClick={() => void startRematch()} disabled={busy}>
            <RotateCcw className="h-4 w-4" aria-hidden /> Rematch
          </Button>
          <AddFriendAfterGame kind="pikadoku" code={view.code} />
          {tools}
          {chat}
        </div>
      </MotionConfig>
    );
  }

  const startsAt = view.round?.startsAt ?? now;
  const left = view.turnEndsAt ? Math.max(0, seconds(view.turnEndsAt - now)) : 0;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {notice}
      <div className="space-y-1 text-center">
        <p className="hud-label text-screen">{tag}</p>
        {status}
      </div>
      {!playing ? (
        <Card>
          <CardContent className="space-y-3 p-10 text-center">
            <p className="hud-label text-screen">Get ready</p>
            <p className="font-display text-7xl font-bold tabular-nums">{Math.max(1, seconds(startsAt - now))}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-center text-sm font-semibold" aria-live="polite" data-testid="pdkd-turn">
            {myTurn ? "Your turn: pick a cell" : `${view.players[view.turn]?.name ?? "Your opponent"}'s turn`} · <span className="tabular-nums">{left}s</span>
          </p>
          {board}
          {view.last && (
            <p className="text-center text-xs text-muted-foreground">
              {view.players[view.last.seat]?.name}: {names.get(view.last.id) ?? `#${view.last.id}`} {view.last.outcome === "stolen" ? "stole a cell." : view.last.outcome === "notrarer" ? "fits, but isn't rarer than the Pokémon there." : view.last.hit ? "claimed a cell." : "missed."}
            </p>
          )}
        </>
      )}
      {tools}
      <LeaveButton busy={busy} onLeave={() => void leave()} />
      {picking !== null && view.grid && (
        <PdkPicker
          dex={dex}
          used={new Set([...view.picks.filter((x): x is number => x !== null), ...(view.used ?? [])])}
          busy={busy}
          title={`${view.grid.rows[Math.floor(picking / 3)].label} × ${view.grid.cols[picking % 3].label}`}
          onPick={(p) => void claim(p)}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
