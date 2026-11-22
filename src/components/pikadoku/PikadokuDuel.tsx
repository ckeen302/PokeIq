"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { MotionConfig } from "framer-motion";
import { Crown, RotateCcw, Timer } from "lucide-react";
import { pvpHref, type PdkDuelView } from "@/lib/pvp-types";
import { PDK_FAMILIES, type PdkFamily, type PdkLocal } from "@/lib/pikadoku/types";
import { INTL_LOCALE } from "@/i18n/format";
import { useT } from "@/i18n/client";
import duelNs from "@/messages/pikadoku-duel";
import boardNs from "@/messages/pikadoku-board";
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
import { PdkBoard, PdkLocalProvider, PdkPicker, useCatLabel, useDex, type BoardCell, type DexName } from "./parts";
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
  const t = useT(duelNs);
  const tb = useT(boardNs);
  const body = useMemo(() => ({ kind: "pikadoku", turnSecs, families, ...(steals && { steals: true }) }), [turnSecs, families, steals]);
  return (
    <NewDuelCard
      body={body}
      href={(code) => pvpHref("pikadoku", code)}
      match={{ game: "pikadoku", ...(steals && { steals: true }) }}
      heading={t("card.heading")}
      blurb={t("card.blurb")}
      info={
        <>
          <p>{t("card.info1")}</p>
          <p>{t("card.info2")}</p>
          <p>{t("card.info3")}</p>
        </>
      }
    >
      <div className="space-y-2 text-left" data-testid="pdk-lobby-rules">
        <div className="flex flex-wrap items-center gap-2">
          <span className="hud-label">{t("card.mode")}</span>
          {[false, true].map((on) => (
            <button key={String(on)} type="button" aria-pressed={steals === on} data-testid={`pdk-steals-${on ? "on" : "off"}`} onClick={() => setSteals(on)} title={on ? t("card.stealsTitle") : t("card.classicTitle")} className={cn("rounded border px-2 py-0.5 text-xs font-semibold", steals === on ? "border-primary bg-primary/15" : "border-foreground/15 text-muted-foreground")}>
              {on ? t("card.steals") : t("card.classic")}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="hud-label flex items-center gap-1">
            <Timer className="h-3.5 w-3.5" aria-hidden /> {t("card.timer")}
          </span>
          {TURN_CHOICES.map((s) => (
            <button key={s} type="button" aria-pressed={turnSecs === s} onClick={() => setTurnSecs(s)} className={cn("rounded border px-2 py-0.5 text-xs font-semibold", turnSecs === s ? "border-primary bg-primary/15" : "border-foreground/15 text-muted-foreground")}>
              {t("card.secs", { s })}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("card.categoriesLabel")}>
          <span className="hud-label">{t("card.categories")}</span>
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
                {tb(`family.${f}`)}
              </button>
            );
          })}
        </div>
      </div>
    </NewDuelCard>
  );
}

/** The duel page, with its language's Pikadoku words (category labels, Pokémon names) when it isn't English. */
export function PikadokuDuel({ code, local }: { code: string; local?: PdkLocal }) {
  return (
    <PdkLocalProvider local={local}>
      <DuelGame code={code} />
    </PdkLocalProvider>
  );
}

function DuelGame({ code }: { code: string }) {
  const router = useRouter();
  const t = useT(duelNs);
  const tb = useT(boardNs);
  const labelOf = useCatLabel();
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

  if (gone) return <DuelGone message={gone} href={HOME} label={t("back")} />;
  if (!view) return <DuelLoading />;

  const series = seriesTag(view.series);
  const tag = series ? t("tagSeries", { series }) : t("tag");
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
  const chat = <DuelChat view={view} game={t("chat")} onSend={(text) => send({ action: "chat", text })} />;

  if (view.status === "lobby") {
    const families = view.settings.families.map((f) => ((PDK_FAMILIES as readonly string[]).includes(f) ? tb(`family.${f as PdkFamily}`) : f));
    const list = t.locale === "en" ? families.join(", ") : new Intl.ListFormat(INTL_LOCALE[t.locale], { type: "conjunction" }).format(families);
    return (
      <>
        {notice}
        <DuelLobby
          view={view}
          path={pvpHref("pikadoku", view.code)}
          tag={tag}
          title={
            <>
              {"Pikadoku "}
              <span className="whitespace-nowrap text-primary">{t("ttt")}</span>
            </>
          }
          invite={(host) => t("invite", { host })}
          about={t("about")}
          shareText={t("share")}
          rules={[
            { label: t("rules.game"), text: t("rules.gameText") },
            { label: t("rules.misses"), text: t("rules.missesText", { secs: view.settings.turnSecs }) },
            ...(view.settings.steals ? [{ label: t("rules.steals"), text: t("rules.stealsText") }] : []),
            { label: t("rules.categories"), text: t("rules.categoriesText", { list }) },
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
          {me === k && t("you")}
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
          status={view.status === "finished" ? (winner === null || winner === undefined ? t("draw") : t("won", { name: view.players[winner]?.name ?? "" })) : t("underWay")}
          home={HOME}
          label={t("startOwn")}
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
            {w === null || w === undefined ? t("outcomeDraw") : w === me ? (
              <>
                <Crown className="mr-2 inline h-6 w-6 text-warning" aria-hidden />
                {t("outcomeWin")}
              </>
            ) : (
              t("outcomeWins", { name: view.players[w]?.name ?? "" })
            )}
          </h1>
          {status}
          {board}
          {view.series && <SeriesScore series={view.series} players={view.players} you={me} />}
          <NewBadges badges={badges} />
          <Button type="button" onClick={() => void startRematch()} disabled={busy}>
            <RotateCcw className="h-4 w-4" aria-hidden /> {t("rematch")}
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
  const turnName = view.players[view.turn]?.name;
  const last = view.last;
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
            <p className="hud-label text-screen">{t("getReady")}</p>
            <p className="font-display text-7xl font-bold tabular-nums">{Math.max(1, seconds(startsAt - now))}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-center text-sm font-semibold" aria-live="polite" data-testid="pdkd-turn">
            {myTurn ? t("yourTurn") : turnName ? t("theirTurn", { name: turnName }) : t("opponentTurn")} · <span className="tabular-nums">{t("card.secs", { s: left })}</span>
          </p>
          {board}
          {last && (
            <p className="text-center text-xs text-muted-foreground">
              {t(last.outcome === "stolen" ? "last.stolen" : last.outcome === "notrarer" ? "last.notrarer" : last.hit ? "last.hit" : "last.missed", { player: view.players[last.seat]?.name ?? "", pokemon: names.get(last.id) ?? `#${last.id}` })}
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
          title={tb("board.cross", { row: labelOf(view.grid.rows[Math.floor(picking / 3)]), col: labelOf(view.grid.cols[picking % 3]) })}
          onPick={(p) => void claim(p)}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
