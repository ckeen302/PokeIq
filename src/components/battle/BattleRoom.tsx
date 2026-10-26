"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Eye, Flag, History, Loader2, RotateCcw, Settings2, Swords, WifiOff } from "lucide-react";
import { BATTLE_AWAY_MS, BATTLE_QUIET_MS, BATTLE_TIMER, PLAY_FORMAT_INFO, battleHref, type BattleView } from "@/lib/battle/play";
import { DuelLobby, MatchedNote } from "@/components/duel/DuelParts";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { lastCpuSetup, startBattle } from "./BattleSetup";
import { TeamPick, type TeamSource } from "./TeamPick";
import { FrontierAfter } from "./Frontier";
import { builderFormatFor, customName, describeRules } from "@/lib/battle/custom-rules";
import { useBattle, type BattleHandle } from "./use-battle";
import { ChatBox } from "@/components/chat/ChatBox";
import { BattleAfter } from "./BattleAfter";
import { AddFriendAfterGame } from "@/components/community/AddFriend";
import { lastTurn, type ReplayData } from "@/lib/battle/replay";
import { downloadReplay } from "./replay-download";

/** A live battle's chat: the two players talk; anyone else watching reads along. */
const IGNORE_KEY = "pokeiq:battle:ignored";

function readIgnored(): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(IGNORE_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((n): n is string => typeof n === "string").slice(-200) : [];
  } catch {
    return [];
  }
}

/**
 * The battle's chat, with Showdown's /ignore: a spectator can ignore either
 * trainer (remembered on this device, by name); players mute the opponent in
 * the chat box.
 * The game's own lines always show.
 */
function BattleChat({ view, battle, collapsible, className }: { view: BattleView; battle: BattleHandle; collapsible?: boolean; className?: string }) {
  const [ignored, setIgnored] = useState<string[]>([]);
  useEffect(() => setIgnored(readIgnored()), []);
  const toggle = (name: string) => {
    const next = ignored.includes(name) ? ignored.filter((n) => n !== name) : [...ignored, name];
    setIgnored(next);
    try {
      window.localStorage.setItem(IGNORE_KEY, JSON.stringify(next));
    } catch {
      // not remembered
    }
  };
  // Players mute the opponent from the chat box itself; spectators can ignore either trainer here.
  const others = view.you === null ? view.players.map((p) => p.name) : [];
  const lines = view.chat?.filter((l) => l.seat === null || !l.name || !ignored.includes(l.name) || l.seat === view.you);
  const hidden = (view.chat?.length ?? 0) - (lines?.length ?? 0);
  return (
    <div className="space-y-1.5">
      {others.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-1.5 text-[11px] text-muted-foreground" data-testid="chat-ignore">
          {others.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => toggle(name)}
              aria-pressed={ignored.includes(name)}
              className={cn("rounded-sm border px-1.5 py-0.5 hover:text-foreground", ignored.includes(name) ? "border-warning/60 text-warning" : "border-border")}
              title={ignored.includes(name) ? `Show ${name}'s messages again` : `Hide ${name}'s messages (Showdown's /ignore)`}
            >
              {ignored.includes(name) ? `Unignore ${name}` : `Ignore ${name}`}
            </button>
          ))}
          {hidden > 0 && <span>({hidden} hidden)</span>}
        </div>
      )}
      <ChatBox
        lines={lines}
        you={view.you}
        players={view.players}
        code={view.code}
        game="Live battle"
        onSend={battle.chat}
        closed={view.rematch ? "A rematch is open: press Rematch to keep chatting there." : undefined}
        collapsible={collapsible}
        className={className}
      />
    </div>
  );
}

/**
 * A battle's page: keeps the battle fresh (useBattle) and draws it: the
 * lobby of a live battle (the invite link, Ready, joining with a name and,
 * in team formats, a team), then the battle itself. The battle screen and
 * the simulator's client libraries load only here, on demand, so the rest
 * of the site stays light.
 */

const BattleScreen = dynamic(() => import("./play/BattleScreen"), {
  ssr: false,
  loading: () => <ScreenLoading />,
});

const ReplayViewer = dynamic(() => import("./ReplayViewer").then((m) => m.ReplayViewer), {
  ssr: false,
  loading: () => <ScreenLoading />,
});

/** The battle so far as a replay (your own view of it): Showdown's instant replay, and the file to download. */
function replayOf(view: BattleView, log: readonly string[]): ReplayData {
  const players = [view.players[0]?.name ?? "Player 1", view.players[1]?.name ?? "Player 2"] as [string, string];
  return {
    id: view.code,
    format: view.format,
    formatName: view.formatName ?? PLAY_FORMAT_INFO[view.format].name,
    players,
    winner: view.end?.winner ?? null,
    reason: view.end?.reason ?? "normal",
    turns: lastTurn(log),
    ranked: !!view.ranked,
    public: false,
    uploadedAt: 0,
    log: [...log],
  };
}

function ScreenLoading() {
  return (
    <div className="flex aspect-[16/9] w-full items-center justify-center rounded-lg border bg-card">
      <Loader2 className="h-6 w-6 animate-spin text-screen" aria-label="Loading the battle" />
    </div>
  );
}

export function BattleGone({ message }: { message: string }) {
  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="space-y-4 p-6 text-center">
        <p className="font-display text-xl font-bold uppercase">Battle not found</p>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Link href="/battle/play" className={buttonVariants()}>
          Start a battle
        </Link>
      </CardContent>
    </Card>
  );
}

/** Forfeit, after a second press. */
function ForfeitButton({ busy, onForfeit }: { busy: boolean; onForfeit: () => void }) {
  const [sure, setSure] = useState(false);
  return (
    <div className="flex items-center justify-end gap-2">
      {sure ? (
        <>
          <span className="text-sm text-muted-foreground">Forfeit this battle?</span>
          <Button size="sm" variant="destructive" disabled={busy} onClick={onForfeit}>
            Forfeit
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSure(false)}>
            Keep battling
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setSure(true)}>
          <Flag className="h-3.5 w-3.5" aria-hidden /> Forfeit
        </Button>
      )}
    </div>
  );
}

/** After a battle against the computer: the same battle again, or new settings. */
function CpuAgain() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function again() {
    const setup = lastCpuSetup();
    if (!setup) return router.push("/battle/play");
    setBusy(true);
    setError(null);
    try {
      router.push(await startBattle({ mode: "cpu", ...setup }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start a battle.");
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => void again()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />} Play again
        </Button>
        <Link href="/battle/play" className={buttonVariants({ variant: "outline" })}>
          <Settings2 className="h-4 w-4" aria-hidden /> New battle
        </Link>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** After a live battle: a rematch with the same trainers (and teams), once both press it. */
function LiveAgain({ view, battle }: { view: BattleView; battle: BattleHandle }) {
  const router = useRouter();
  async function rematch() {
    const next = await battle.rematch();
    if (next) router.push(battleHref("pvp", next));
  }
  // A tournament match: the next one is the bracket's to decide.
  if (view.tournament) {
    return (
      <div className="flex flex-wrap justify-center gap-2">
        <Link href={`/battle/tournaments/${view.tournament}`} className={buttonVariants({ variant: "success" })} data-testid="back-to-tournament">
          <Swords className="h-4 w-4" aria-hidden /> Back to the tournament
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {view.rematch && (
        <p role="status" className="font-display text-sm font-semibold uppercase tracking-wider text-warning">
          Rematch requested!
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="success" disabled={battle.busy} onClick={() => void rematch()}>
          {battle.busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
          {view.rematch ? "Accept rematch" : "Rematch"}
        </Button>
        <Link href="/battle/play" className={buttonVariants({ variant: "outline" })}>
          <Swords className="h-4 w-4" aria-hidden /> New battle
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">A rematch keeps the trainers, the format and any teams you brought. It starts when you both press it.</p>
    </div>
  );
}

function LiveLobby({ code, view, battle }: { code: string; view: BattleView; battle: BattleHandle }) {
  const router = useRouter();
  const base = PLAY_FORMAT_INFO[view.format];
  const info = { ...base, name: view.formatName ?? base.name };
  const [team, setTeam] = useState("");
  const onTeam = useCallback((t: string) => setTeam(t), []);
  const timer = view.timer === undefined ? BATTLE_TIMER[info.gameType] : view.timer;
  const rules = view.rules;
  const source = useMemo<TeamSource | undefined>(
    () =>
      rules
        ? { name: customName(rules), short: `Gen ${rules.gen}`, saved: builderFormatFor(rules.gen), quick: { rules }, quickNote: `Random-battle sets from Gen ${rules.gen}, checked against these rules.` }
        : undefined,
    [rules]
  );
  const joining = view.you === null && view.players.length < 2;
  const host = view.players[0]?.name;

  return (
    <div className="space-y-3">
      {(battle.error || battle.offline) && (
        <p role="alert" className="text-center text-sm text-destructive">
          {battle.error ?? "Connection lost. Reconnecting…"}
        </p>
      )}
      <DuelLobby
        view={view}
        path={`/battle/live/${code}`}
        tag={`Live battle · ${info.name}`}
        title={
          view.players.length === 2 ? (
            <>
              {view.players[0].name} <span className="text-muted-foreground">vs</span> {view.players[1].name}
            </>
          ) : (
            <>
              Pokémon <span className="text-primary">battle</span>
            </>
          )
        }
        invite={(h) => `${h} challenges you to a ${info.name} battle. Pick a trainer name${info.random ? "" : " and a team"} to join.`}
        about={`Send the link to a friend. The battle starts when you're both ready.${info.random ? " Teams are random." : ""}`}
        shareText={`${host ?? "I"} challenge${host ? "s" : ""} you to a ${info.name} battle on PokéIQ!`}
        rules={[
          { label: "Format", text: <>{info.name}: {info.random ? info.blurb : "each of you brings a team, checked against Pokémon Showdown's rules."}</> },
          ...(rules ? describeRules(rules).map((r) => ({ label: r.label, text: <>{r.text}</> })) : []),
          {
            label: "Turn timer",
            text: timer ? (
              <>
                Showdown&apos;s timer: {(timer.refill ?? timer.bank) / 1000} s{timer.refill && timer.refill < timer.bank ? ` plus ${(timer.bank - timer.refill) / 1000} s grace` : ""}
                {timer.perTurn ? `, +${timer.perTurn / 1000} s a turn` : ""}, {timer.cap / 1000} s at most per turn.{" "}
                {view.timeoutLoses
                  ? timer.autoChoose
                    ? "Run out on a turn and a default move is made; run out of time altogether and you lose."
                    : "Run out and you lose."
                  : "Run out and the timer picks a move for you; a second time in a row loses."}
              </>
            ) : (
              <>Off: take your time. Either of you can start it mid-battle.</>
            ),
          },
          {
            label: "Spectators",
            text: view.public ? <>Listed in Watch live: anyone can watch.</> : <>Private: only people with the link can watch.</>,
          },
          {
            label: "Fair play",
            text: (
              <>
                You see only your own team and what your opponent reveals. Leaving forfeits after {Math.round((BATTLE_AWAY_MS - BATTLE_QUIET_MS) / 1000)} s
                away.
              </>
            ),
          },
        ]}
        settings={joining && !info.random ? <TeamPick format={view.format} onChange={onTeam} idPrefix={`join-${code}`} source={source} /> : undefined}
        home="/battle/play?vs=friend"
        noun="battle"
        chat={<BattleChat view={view} battle={battle} />}
        busy={battle.busy}
        onJoin={(name) => {
          if (!info.random && !team) {
            battle.setError("Pick or paste a team first.");
            return;
          }
          void battle.join(name, info.random ? undefined : team);
        }}
        onReady={(ready) => void battle.act({ action: "ready", ready })}
        onLeave={async () => {
          if (await battle.act({ action: "forfeit" })) router.push("/battle");
        }}
      />
    </div>
  );
}

export function BattleRoom({ code }: { code: string }) {
  const battle = useBattle(code);
  const { view, gone, offline } = battle;
  /** Showdown's instant replay: the battle so far, from the start, while it goes on. */
  const [instant, setInstant] = useState(false);

  if (gone) return <BattleGone message={gone} />;
  if (!view) return <ScreenLoading />;
  if (view.status === "lobby") return <LiveLobby code={code} view={view} battle={battle} />;

  // Spectators of a live battle see what Showdown's spectators see: the spectator channel, no request.
  if (view.you === null && view.kind === "pvp") {
    return (
      <div className="space-y-3">
        <p className="hud-label flex items-center justify-center gap-1.5 text-screen" data-testid="spectating">
          <Eye className="h-3.5 w-3.5" aria-hidden /> You&apos;re watching {view.players.map((p) => p.name).join(" vs ")}
        </p>
        {offline && (
          <p role="alert" className="flex items-center justify-center gap-1.5 text-sm text-destructive">
            <WifiOff className="h-4 w-4" aria-hidden /> Connection lost. Reconnecting…
          </p>
        )}
        <BattleScreen
          view={view}
          log={battle.log}
          offset={battle.offset}
          busy={false}
          error={null}
          onChoose={() => {}}
          endActions={
            <div className="flex flex-wrap justify-center gap-2">
              <Link href="/battle/watch" className={buttonVariants()}>
                <Eye className="h-4 w-4" aria-hidden /> Watch another
              </Link>
              <Link href="/battle/play" className={buttonVariants({ variant: "outline" })}>
                <Swords className="h-4 w-4" aria-hidden /> Battle yourself
              </Link>
            </div>
          }
          side={<BattleChat view={view} battle={battle} collapsible />}
        />
      </div>
    );
  }

  if (view.you === null) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="space-y-3 p-6 text-center">
          <p className="hud-label text-screen">{view.status === "finished" ? "Battle over" : "Battle in progress"}</p>
          <p className="font-display text-2xl font-bold uppercase">{view.players.map((p) => p.name).join(" vs ")}</p>
          <p className="text-sm text-muted-foreground">This battle is between two other trainers.</p>
          <Link href="/battle/play" className={cn(buttonVariants({ size: "lg" }), "w-full")}>
            Start your own
          </Link>
          {view.kind === "pvp" && <BattleChat view={view} battle={battle} />}
        </CardContent>
      </Card>
    );
  }

  const foe = view.players[view.you === 0 ? 1 : 0];
  if (instant) {
    return <ReplayViewer replay={replayOf(view, battle.log.lines)} instant={{ onClose: () => setInstant(false) }} />;
  }
  const canReplay = view.turn >= 2 || view.status === "finished";
  return (
    <div className="space-y-3">
      {/* Matchmaking opened this battle (its link carries ?matched): "Matched! You vs Blue" for a few seconds. */}
      {view.kind === "pvp" && <MatchedNote view={view} />}
      {offline && (
        <p role="alert" className="flex items-center justify-center gap-1.5 text-sm text-destructive">
          <WifiOff className="h-4 w-4" aria-hidden /> Connection lost. Reconnecting…
        </p>
      )}
      {view.kind === "pvp" && view.status === "playing" && foe?.quiet && (
        <p role="status" className="flex items-center justify-center gap-1.5 text-sm text-warning" data-testid="foe-disconnected">
          <WifiOff className="h-4 w-4" aria-hidden /> {foe.name} lost their connection. If they don&apos;t come back within a minute, they forfeit.
        </p>
      )}
      <BattleScreen
        view={view}
        log={battle.log}
        offset={battle.offset}
        busy={battle.busy}
        error={battle.error}
        onChoose={(rqid, choice) => void battle.choose(rqid, choice)}
        onStartTimer={() => void battle.startTimer()}
        onStopTimer={() => void battle.startTimer(false)}
        onUndo={(rqid) => void battle.undo(rqid)}
        endActions={
          view.frontier ? (
            <FrontierAfter view={view} />
          ) : (
            <div className="space-y-3">
              <BattleAfter view={view} battle={battle} />
              {view.kind === "pvp" && view.you !== null && <AddFriendAfterGame kind="battle" code={view.code} />}
              {view.kind === "cpu" ? <CpuAgain /> : <LiveAgain view={view} battle={battle} />}
            </div>
          )
        }
        side={view.kind === "pvp" ? <BattleChat view={view} battle={battle} collapsible /> : undefined}
      />
      <div className="flex flex-wrap items-center justify-end gap-1">
        {canReplay && (
          <Button size="sm" variant="ghost" onClick={() => setInstant(true)} title="Watch the battle so far from the start (Showdown's instant replay)" data-testid="instant-replay-open">
            <History className="h-3.5 w-3.5" aria-hidden /> Instant replay
          </Button>
        )}
        {view.status === "finished" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void downloadReplay({ ...replayOf(view, battle.log.lines) })}
            title="Showdown's replay file: opens in any browser and plays in Showdown's replay player"
            data-testid="battle-download-replay"
          >
            <Download className="h-3.5 w-3.5" aria-hidden /> Download replay
          </Button>
        )}
        {view.status === "playing" && <ForfeitButton busy={battle.busy} onForfeit={() => void battle.act({ action: "forfeit" })} />}
      </div>
    </div>
  );
}
