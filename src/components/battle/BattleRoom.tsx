"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "@/components/ui/Link";
import { useRouter } from "@/i18n/navigation";
import { Download, Eye, Flag, History, Loader2, RotateCcw, Settings2, Swords, WifiOff } from "lucide-react";
import { BATTLE_AWAY_MS, BATTLE_QUIET_MS, BATTLE_TIMER, PLAY_FORMAT_INFO, battleHref, playerCount, type BattleView } from "@/lib/battle/play";
import { GroupLobby } from "./GroupLobby";
import { DuelLobby, MatchedNote } from "@/components/duel/DuelParts";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { lastCpuSetup, startBattle } from "./BattleSetup";
import { TeamPick, type TeamSource } from "./TeamPick";
import { FrontierAfter } from "./Frontier";
import { builderFormatFor } from "@/lib/battle/custom-rules";
import { describeRulesIn } from "@/lib/battle/custom-rules-text";
import { customRulesName, formatBlurb, formatName } from "@/lib/battle/format-labels";
import { useT } from "@/i18n/client";
import roomNs from "@/messages/battle-room";
import formatsNs from "@/messages/battle-formats";
import rulesNs from "@/messages/battle-rules";
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
  const t = useT(roomNs);
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
  // Players mute the opponent from the chat box itself; spectators can ignore either trainer here (and with four trainers, everyone can ignore the others).
  const others = view.you === null ? view.players.filter((p) => !p.cpu).map((p) => p.name) : view.players.length === 4 ? view.players.filter((p, i) => i !== view.you && !p.cpu).map((p) => p.name) : [];
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
              title={ignored.includes(name) ? t("chat.showAgain", { name }) : t("chat.hideTitle", { name })}
            >
              {ignored.includes(name) ? t("chat.unignore", { name }) : t("chat.ignore", { name })}
            </button>
          ))}
          {hidden > 0 && <span>{t("chat.hidden", { n: hidden })}</span>}
        </div>
      )}
      <ChatBox
        lines={lines}
        you={view.you}
        players={view.players}
        code={view.code}
        game={t("liveBattle")}
        onSend={battle.chat}
        closed={view.rematch ? t("chat.rematchOpen") : undefined}
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
  const players = view.players.length === 4 ? view.players.map((p) => p.name) : [view.players[0]?.name ?? "Player 1", view.players[1]?.name ?? "Player 2"];
  return {
    id: view.code,
    format: view.format,
    formatName: view.formatName ?? PLAY_FORMAT_INFO[view.format].name,
    players,
    ...(view.gameType && view.gameType !== "singles" && view.gameType !== "doubles" ? { gameType: view.gameType } : {}),
    ...(view.end?.winners ? { winners: view.end.winners } : {}),
    ...(view.end?.standings ? { standings: view.end.standings } : {}),
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
  const t = useT(roomNs);
  return (
    <div className="flex aspect-[16/9] w-full items-center justify-center rounded-lg border bg-card">
      <Loader2 className="h-6 w-6 animate-spin text-screen" aria-label={t("loading")} />
    </div>
  );
}

export function BattleGone({ message }: { message: string }) {
  const t = useT(roomNs);
  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="space-y-4 p-6 text-center">
        <p className="font-display text-xl font-bold uppercase">{t("gone.title")}</p>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Link href="/battle/play" className={buttonVariants()}>
          {t("gone.start")}
        </Link>
      </CardContent>
    </Card>
  );
}

/** Forfeit, after a second press. */
function ForfeitButton({ busy, onForfeit }: { busy: boolean; onForfeit: () => void }) {
  const t = useT(roomNs);
  const [sure, setSure] = useState(false);
  return (
    <div className="flex items-center justify-end gap-2">
      {sure ? (
        <>
          <span className="text-sm text-muted-foreground">{t("forfeit.sure")}</span>
          <Button size="sm" variant="destructive" disabled={busy} onClick={onForfeit}>
            {t("forfeit.button")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSure(false)}>
            {t("forfeit.keep")}
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setSure(true)}>
          <Flag className="h-3.5 w-3.5" aria-hidden /> {t("forfeit.button")}
        </Button>
      )}
    </div>
  );
}

/** After a battle against the computer: the same battle again, or new settings. */
function CpuAgain() {
  const t = useT(roomNs);
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
      setError(err instanceof Error ? err.message : t("again.error"));
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => void again()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />} {t("again.play")}
        </Button>
        <Link href="/battle/play" className={buttonVariants({ variant: "outline" })}>
          <Settings2 className="h-4 w-4" aria-hidden /> {t("again.new")}
        </Link>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** After a live battle: a rematch with the same trainers (and teams), once both press it. */
function LiveAgain({ view, battle }: { view: BattleView; battle: BattleHandle }) {
  const t = useT(roomNs);
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
          <Swords className="h-4 w-4" aria-hidden /> {t("again.tournament")}
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {view.rematch && (
        <p role="status" className="font-display text-sm font-semibold uppercase tracking-wider text-warning">
          {t("again.requested")}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="success" disabled={battle.busy} onClick={() => void rematch()}>
          {battle.busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
          {view.rematch ? t("again.accept") : t("again.rematch")}
        </Button>
        <Link href="/battle/play" className={buttonVariants({ variant: "outline" })}>
          <Swords className="h-4 w-4" aria-hidden /> {t("again.new")}
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("again.keeps")}{" "}
        {view.players.length === 4 ? t("again.startsFour") : t("again.startsTwo")}
      </p>
    </div>
  );
}

function LiveLobby({ code, view, battle }: { code: string; view: BattleView; battle: BattleHandle }) {
  const t = useT(roomNs);
  const tf = useT(formatsNs);
  const tr = useT(rulesNs);
  const router = useRouter();
  const base = PLAY_FORMAT_INFO[view.format];
  const en = t.locale === "en";
  const info = {
    ...base,
    name: en ? (view.formatName ?? base.name) : view.rules ? customRulesName(tf, view.rules) : view.format === "custom" || view.format === "tower" || !view.formatName ? formatName(tf, view.format) : view.formatName,
    blurb: formatBlurb(tf, view.format),
  };
  const [team, setTeam] = useState("");
  const onTeam = useCallback((t: string) => setTeam(t), []);
  const timer = view.timer === undefined ? BATTLE_TIMER[info.gameType] : view.timer;
  const rules = view.rules;
  const source = useMemo<TeamSource | undefined>(
    () =>
      rules
        ? { name: customRulesName(tf, rules), short: t("lobby.gen", { gen: rules.gen }), saved: builderFormatFor(rules.gen), quick: { rules }, quickNote: t("lobby.quickNote", { gen: rules.gen }) }
        : undefined,
    [rules, tf, t]
  );
  const gameType = view.gameType ?? info.gameType;
  const four = playerCount(gameType) === 4;
  const joining = view.you === null && view.players.length < (four ? 4 : 2);
  const host = view.players[0]?.name;
  const formatRule = { label: t("lobby.format"), text: <>{info.name}: {info.random ? info.blurb : t("lobby.bring")}</> };
  const ruleRows = rules ? describeRulesIn(tr, rules).map((r) => ({ label: r.label, text: <>{r.text}</> })) : [];
  const timerText = (anyone: boolean) =>
    timer ? (
      <>
        {t("lobby.timer", { secs: (timer.refill ?? timer.bank) / 1000 })}
        {timer.refill && timer.refill < timer.bank ? t("lobby.grace", { secs: (timer.bank - timer.refill) / 1000 }) : ""}
        {timer.perTurn ? t("lobby.perTurn", { secs: timer.perTurn / 1000 }) : ""}
        {t("lobby.cap", { secs: timer.cap / 1000 })}{" "}
        {view.timeoutLoses ? (timer.autoChoose ? t("lobby.runOutDefault") : t("lobby.runOutLose")) : t("lobby.runOutPick")}
      </>
    ) : (
      <>{anyone ? t("lobby.timerOffAny") : t("lobby.timerOffEither")}</>
    );
  const spectatorRule = {
    label: t("lobby.spectators"),
    text: view.public ? <>{t("lobby.public")}</> : <>{t("lobby.private")}</>,
  };
  const away = Math.round((BATTLE_AWAY_MS - BATTLE_QUIET_MS) / 1000);
  const lobbyRules = [
    formatRule,
    ...ruleRows,
    { label: t("lobby.timerLabel"), text: timerText(true) },
    spectatorRule,
    {
      label: t("lobby.fairPlay"),
      text: <>{t(gameType === "multi" ? "lobby.fairFourMulti" : gameType === "freeforall" ? "lobby.fairFourFfa" : "lobby.fairFour", { secs: away })}</>,
    },
    ...(four ? [{ label: t("lobby.ladder"), text: <>{t(gameType === "multi" ? "lobby.unrankedMulti" : "lobby.unrankedFfa")}</> }] : []),
  ];

  if (four) {
    return (
      <div className="space-y-3">
        {(battle.error || battle.offline) && (
          <p role="alert" className="text-center text-sm text-destructive">
            {battle.error ?? t("reconnecting")}
          </p>
        )}
        <GroupLobby
          view={view}
          gameType={gameType}
          path={`/battle/live/${code}`}
          formatName={info.name}
          rules={lobbyRules}
          settings={joining && !info.random ? <TeamPick format={view.format} onChange={onTeam} idPrefix={`join-${code}`} source={source} /> : undefined}
          busy={battle.busy}
          chat={<BattleChat view={view} battle={battle} />}
          onJoin={(name) => {
            if (!info.random && !team) {
              battle.setError(t("lobby.teamFirst"));
              return;
            }
            void battle.join(name, info.random ? undefined : team);
          }}
          onReady={(ready) => void battle.act({ action: "ready", ready })}
          onFill={(level) => void battle.act({ action: "fill", level })}
          onLeave={async () => {
            if (await battle.act({ action: "forfeit" })) router.push("/battle");
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(battle.error || battle.offline) && (
        <p role="alert" className="text-center text-sm text-destructive">
          {battle.error ?? t("reconnecting")}
        </p>
      )}
      <DuelLobby
        view={view}
        path={`/battle/live/${code}`}
        tag={t("lobby.tag", { format: info.name })}
        title={
          view.players.length === 2 ? (
            <>
              {view.players[0].name} <span className="text-muted-foreground">{t("vs")}</span> {view.players[1].name}
            </>
          ) : (
            <>{t.rich("lobby.title", { b: (c) => <span className="text-primary">{c}</span> })}</>
          )
        }
        invite={(h) => t(info.random ? "lobby.invite" : "lobby.inviteTeam", { host: h, format: info.name })}
        about={`${t("lobby.about")}${info.random ? t("lobby.randomTeams") : ""}`}
        shareText={host ? t("lobby.shareHost", { host, format: info.name }) : t("lobby.shareMe", { format: info.name })}
        rules={[
          formatRule,
          ...ruleRows,
          { label: t("lobby.timerLabel"), text: timerText(false) },
          spectatorRule,
          {
            label: t("lobby.fairPlay"),
            text: <>{t("lobby.fairTwo", { secs: away })}</>,
          },
        ]}
        settings={joining && !info.random ? <TeamPick format={view.format} onChange={onTeam} idPrefix={`join-${code}`} source={source} /> : undefined}
        home="/battle/play?vs=friend"
        noun={t("lobby.noun")}
        chat={<BattleChat view={view} battle={battle} />}
        busy={battle.busy}
        onJoin={(name) => {
          if (!info.random && !team) {
            battle.setError(t("lobby.teamFirst"));
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
  const t = useT(roomNs);
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
          <Eye className="h-3.5 w-3.5" aria-hidden /> {t("watching", { players: view.players.length === 4 && view.gameType === "multi" ? t("multiVs", { a: view.players[0]?.name ?? "", c: view.players[2]?.name ?? "", b: view.players[1]?.name ?? "", d: view.players[3]?.name ?? "" }) : view.players.map((p) => p.name).join(t("vsSep")) })}
        </p>
        {offline && (
          <p role="alert" className="flex items-center justify-center gap-1.5 text-sm text-destructive">
            <WifiOff className="h-4 w-4" aria-hidden /> {t("reconnecting")}
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
                <Eye className="h-4 w-4" aria-hidden /> {t("watchAnother")}
              </Link>
              <Link href="/battle/play" className={buttonVariants({ variant: "outline" })}>
                <Swords className="h-4 w-4" aria-hidden /> {t("battleYourself")}
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
          <p className="hud-label text-screen">{view.status === "finished" ? t("visitor.over") : t("visitor.inProgress")}</p>
          <p className="font-display text-2xl font-bold uppercase">{view.players.map((p) => p.name).join(t("vsSep"))}</p>
          <p className="text-sm text-muted-foreground">{view.players.length === 4 ? t("visitor.four") : t("visitor.two")}</p>
          <Link href="/battle/play" className={cn(buttonVariants({ size: "lg" }), "w-full")}>
            {t("visitor.start")}
          </Link>
          {view.kind === "pvp" && <BattleChat view={view} battle={battle} />}
        </CardContent>
      </Card>
    );
  }

  const foe = view.players[view.you === 0 ? 1 : 0];
  // Four trainers: every other trainer (not the computer) who's lost their connection.
  const quietOthers = view.players.length === 4 ? view.players.filter((p, i) => i !== view.you && !p.cpu && p.quiet && p.out === undefined) : [];
  if (instant) {
    return <ReplayViewer replay={replayOf(view, battle.log.lines)} instant={{ onClose: () => setInstant(false), timed: !!view.clocks }} />;
  }
  const canReplay = view.turn >= 2 || view.status === "finished";
  const replayTools = (
    <>
        {canReplay && (
          <Button size="sm" variant="ghost" onClick={() => setInstant(true)} title={t("replay.instantTitle")} data-testid="instant-replay-open">
            <History className="h-3.5 w-3.5" aria-hidden /> {t("replay.instant")}
          </Button>
        )}
        {view.status === "finished" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void downloadReplay({ ...replayOf(view, battle.log.lines) })}
            title={t("replay.downloadTitle")}
            data-testid="battle-download-replay"
          >
            <Download className="h-3.5 w-3.5" aria-hidden /> {t("replay.download")}
          </Button>
        )}
    </>
  );
  return (
    <div className="space-y-3">
      {/* Matchmaking opened this battle (its link carries ?matched): "Matched! You vs Blue" for a few seconds. */}
      {view.kind === "pvp" && <MatchedNote view={view} />}
      {offline && (
        <p role="alert" className="flex items-center justify-center gap-1.5 text-sm text-destructive">
          <WifiOff className="h-4 w-4" aria-hidden /> {t("reconnecting")}
        </p>
      )}
      {view.kind === "pvp" && view.status === "playing" && quietOthers.length > 0 && (
        <p role="status" className="flex items-center justify-center gap-1.5 text-sm text-warning" data-testid="foe-disconnected">
          <WifiOff className="h-4 w-4" aria-hidden /> {t("quiet.lost", { names: quietOthers.map((p) => p.name).join(t("and")) })}{" "}
          {view.gameType === "multi" ? t("quiet.teamForfeits") : t("quiet.forfeit")}
        </p>
      )}
      {view.kind === "pvp" && view.status === "playing" && view.players.length !== 4 && foe?.quiet && (
        <p role="status" className="flex items-center justify-center gap-1.5 text-sm text-warning" data-testid="foe-disconnected">
          <WifiOff className="h-4 w-4" aria-hidden /> {t("quiet.lost", { names: foe.name })} {t("quiet.forfeit")}
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
            <div className="space-y-3">
              <FrontierAfter view={view} />
              <div className="flex flex-wrap justify-center gap-1">{replayTools}</div>
            </div>
          ) : (
            <div className="space-y-3">
              <BattleAfter view={view} battle={battle} />
              <div className="flex flex-wrap justify-center gap-1">{replayTools}</div>
              {view.kind === "pvp" && view.you !== null && <AddFriendAfterGame kind="battle" code={view.code} />}
              {view.kind === "cpu" ? <CpuAgain /> : <LiveAgain view={view} battle={battle} />}
            </div>
          )
        }
        side={view.kind === "pvp" ? <BattleChat view={view} battle={battle} collapsible /> : undefined}
      />
      <div className="flex flex-wrap items-center justify-end gap-1">
        {view.status !== "finished" && replayTools}
        {view.status === "playing" && <ForfeitButton busy={battle.busy} onForfeit={() => void battle.act({ action: "forfeit" })} />}
      </div>
    </div>
  );
}
